/* tchadiaPdf : Scanner PDF
   Transforme des photos de documents en PDF : correction de perspective (homographie 4 points)
   calculée à la main (sans bibliothèque de vision par ordinateur), puis filtre "scanner". */

const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25 Mo par photo
const MAX_PAGES = 300;                    // limite raisonnable de pages
const DISPLAY_MAX_W = 500;                // largeur d'affichage de l'atelier de correction
const OUTPUT_MAX_W = 1600;                // largeur maximale de la page redressée (fluidité)
const PT_PER_PX = 72 / 150;               // conversion pixels -> points PDF (résolution supposée 150 dpi)

// État de l'atelier de correction (photo en cours d'ajustement)
let workshopImage = null;   // HTMLImageElement de la photo en cours
let workshopImageURL = null; // URL objet à révoquer quand on passe à la photo suivante
let displayW = 0, displayH = 0; // résolution interne du canvas d'aperçu
let scaleToReal = 1;        // facteur pour passer des coordonnées d'affichage aux pixels réels
let corners = null;         // { tl, tr, br, bl } en coordonnées d'affichage (0..displayW / 0..displayH)
let filterMode = "couleur"; // couleur | contraste | nb
let activeHandle = null;    // coin actuellement déplacé au pointeur

// Pages déjà validées, dans l'ordre du futur PDF
let pages = []; // { id, blobUrl, blob, width, height }
let nextPageId = 1;

const dropzoneEl = document.getElementById("dropzone");
const workshopEl = document.getElementById("workshop");
const canvasWrapEl = document.getElementById("canvasWrap");
const canvas = document.getElementById("editCanvas");
const svgOverlay = document.getElementById("handleOverlay");
const polygonEl = document.getElementById("cornerPolygon");
const handles = Array.from(document.querySelectorAll(".scan-handle"));
const addPageBtn = document.getElementById("addPageBtn");
const pagesSection = document.getElementById("pagesSection");
const pagesGrid = document.getElementById("pagesGrid");
const pageCountLabel = document.getElementById("pageCountLabel");
const createBtn = document.getElementById("createBtn");
const resultEl = document.getElementById("result");

initDropzone("dropzone", "fileInput", (files) => {
  const file = files[0];
  if (file) loadPhoto(file);
});

/** Valide puis charge une photo dans l'atelier de correction. */
function loadPhoto(file) {
  hideMsg();
  resultEl.classList.remove("visible");

  if (!file.type || !file.type.startsWith("image/")) {
    showMsg("Format non supporté : choisissez une photo au format JPG, PNG ou similaire.");
    return;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    showMsg("Cette photo est trop volumineuse (limite : 25 Mo par photo). Choisissez une image plus légère.");
    return;
  }
  if (pages.length >= MAX_PAGES) {
    showMsg("Nombre maximal de pages atteint (" + MAX_PAGES + "). Créez le PDF avant d'ajouter d'autres pages.");
    return;
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url);
      showMsg("Cette image est illisible ou corrompue. Essayez une autre photo.");
      return;
    }
    if (workshopImageURL) URL.revokeObjectURL(workshopImageURL);
    workshopImage = img;
    workshopImageURL = url;
    setupWorkshop(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    showMsg("Impossible de lire cette image. Elle est peut-être corrompue ou dans un format non supporté.");
  };
  img.src = url;
}

/** Prépare l'atelier de correction : dessine l'aperçu et place les 4 poignées. */
function setupWorkshop(img) {
  displayW = Math.min(DISPLAY_MAX_W, img.naturalWidth);
  displayH = Math.round(img.naturalHeight * (displayW / img.naturalWidth));
  scaleToReal = img.naturalWidth / displayW;

  canvas.width = displayW;
  canvas.height = displayH;
  canvas.getContext("2d").drawImage(img, 0, 0, displayW, displayH);

  svgOverlay.setAttribute("viewBox", "0 0 " + displayW + " " + displayH);

  const m = 0.06; // marge initiale de 6% par rapport aux bords de l'image
  corners = {
    tl: { x: displayW * m, y: displayH * m },
    tr: { x: displayW * (1 - m), y: displayH * m },
    br: { x: displayW * (1 - m), y: displayH * (1 - m) },
    bl: { x: displayW * m, y: displayH * (1 - m) },
  };
  updateHandleVisuals();

  filterMode = "couleur";
  document.querySelectorAll("#filterSeg button").forEach((b) => b.classList.toggle("active", b.dataset.f === "couleur"));

  workshopEl.style.display = "block";
  workshopEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Repositionne les poignées et le contour SVG selon l'état courant de "corners". */
function updateHandleVisuals() {
  handles.forEach((el) => {
    const key = el.dataset.corner;
    const p = corners[key];
    el.style.left = (p.x / displayW * 100) + "%";
    el.style.top = (p.y / displayH * 100) + "%";
  });
  polygonEl.setAttribute(
    "points",
    [corners.tl, corners.tr, corners.br, corners.bl].map((p) => p.x + "," + p.y).join(" ")
  );
}

/** Déplace un coin à partir d'un événement pointeur, borné à l'intérieur du canvas. */
function moveHandle(key, clientX, clientY) {
  const rect = canvasWrapEl.getBoundingClientRect();
  let fx = (clientX - rect.left) / rect.width;
  let fy = (clientY - rect.top) / rect.height;
  fx = Math.min(1, Math.max(0, fx));
  fy = Math.min(1, Math.max(0, fy));
  corners[key] = { x: fx * displayW, y: fy * displayH };
  updateHandleVisuals();
}

handles.forEach((el) => {
  const key = el.dataset.corner;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    activeHandle = key;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
  });
  el.addEventListener("pointermove", (e) => {
    if (activeHandle !== key) return;
    e.preventDefault();
    moveHandle(key, e.clientX, e.clientY);
  });
  const release = (e) => {
    if (activeHandle !== key) return;
    activeHandle = null;
    try { el.releasePointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);

  // Déplacement au clavier pour l'accessibilité (flèches directionnelles).
  el.addEventListener("keydown", (e) => {
    if (!corners) return;
    const step = 4; // pas fixe en pixels d'affichage
    const p = corners[key];
    let handled = true;
    if (e.key === "ArrowLeft") p.x -= step;
    else if (e.key === "ArrowRight") p.x += step;
    else if (e.key === "ArrowUp") p.y -= step;
    else if (e.key === "ArrowDown") p.y += step;
    else handled = false;
    if (handled) {
      e.preventDefault();
      p.x = Math.min(displayW, Math.max(0, p.x));
      p.y = Math.min(displayH, Math.max(0, p.y));
      updateHandleVisuals();
    }
  });
});

document.querySelectorAll("#filterSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#filterSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    filterMode = btn.dataset.f;
  });
});

/** Distance euclidienne entre deux points. */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Résout un système linéaire carré (matrice n x n, vecteur n) par élimination de Gauss-Jordan
 * avec pivot partiel. Renvoie le vecteur solution (longueur n).
 */
function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const A = matrix.map((row, i) => row.concat([vector[i]]));

  for (let col = 0; col < n; col++) {
    // Pivot partiel : on choisit la ligne au plus grand coefficient absolu dans cette colonne.
    let pivotRow = col;
    let maxAbs = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > maxAbs) {
        maxAbs = Math.abs(A[r][col]);
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmp = A[col];
      A[col] = A[pivotRow];
      A[pivotRow] = tmp;
    }
    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-10) continue; // quadrilatère dégénéré, on ignore cette ligne

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = A[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        A[r][c] -= factor * A[col][c];
      }
    }
  }

  const result = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    result[i] = Math.abs(A[i][i]) < 1e-10 ? 0 : A[i][n] / A[i][i];
  }
  return result;
}

/**
 * Calcule les 8 coefficients a..h de l'homographie "destination vers source" :
 *   xs = (a*xd + b*yd + c) / (g*xd + h*yd + 1)
 *   ys = (d*xd + e*yd + f) / (g*xd + h*yd + 1)
 * srcPts et dstPts sont des tableaux de 4 points { x, y }, dans le même ordre
 * (haut-gauche, haut-droite, bas-droite, bas-gauche).
 */
function solveHomography(srcPts, dstPts) {
  const M = [];
  const v = [];
  for (let i = 0; i < 4; i++) {
    const xd = dstPts[i].x, yd = dstPts[i].y;
    const xs = srcPts[i].x, ys = srcPts[i].y;
    M.push([xd, yd, 1, 0, 0, 0, -xd * xs, -yd * xs]);
    v.push(xs);
    M.push([0, 0, 0, xd, yd, 1, -xd * ys, -yd * ys]);
    v.push(ys);
  }
  const sol = solveLinearSystem(M, v);
  return { a: sol[0], b: sol[1], c: sol[2], d: sol[3], e: sol[4], f: sol[5], g: sol[6], h: sol[7] };
}

/**
 * Redresse la perspective de l'image source selon les 4 coins choisis (en pixels réels de
 * l'image), puis applique le filtre demandé. Renvoie { canvas, width, height }.
 */
function warpAndFilter(img, realCorners, filter) {
  const srcW = img.naturalWidth, srcH = img.naturalHeight;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const largeurHaut = distance(realCorners.tl, realCorners.tr);
  const largeurBas = distance(realCorners.bl, realCorners.br);
  let outW = Math.round(Math.max(largeurHaut, largeurBas));

  const hauteurGauche = distance(realCorners.tl, realCorners.bl);
  const hauteurDroite = distance(realCorners.tr, realCorners.br);
  let outH = Math.round(Math.max(hauteurGauche, hauteurDroite));

  if (!outW || !outH || !isFinite(outW) || !isFinite(outH)) {
    throw new Error("Les 4 coins doivent former un quadrilatère valide. Ajustez les poignées et réessayez.");
  }

  // Limite la taille de sortie pour rester fluide en JavaScript pur.
  if (outW > OUTPUT_MAX_W) {
    const ratio = OUTPUT_MAX_W / outW;
    outW = Math.round(outW * ratio);
    outH = Math.round(outH * ratio);
  }
  outW = Math.max(1, outW);
  outH = Math.max(1, outH);

  const srcPts = [realCorners.tl, realCorners.tr, realCorners.br, realCorners.bl];
  const dstPts = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const H = solveHomography(srcPts, dstPts);

  const warpedCanvas = document.createElement("canvas");
  warpedCanvas.width = outW;
  warpedCanvas.height = outH;
  const warpedCtx = warpedCanvas.getContext("2d");
  const outImageData = warpedCtx.createImageData(outW, outH);
  const outData = outImageData.data;

  for (let yd = 0; yd < outH; yd++) {
    for (let xd = 0; xd < outW; xd++) {
      const denom = H.g * xd + H.h * yd + 1;
      const xs = (H.a * xd + H.b * yd + H.c) / denom;
      const ys = (H.d * xd + H.e * yd + H.f) / denom;
      const outIdx = (yd * outW + xd) * 4;

      const sxi = Math.round(xs);
      const syi = Math.round(ys);
      if (sxi >= 0 && sxi < srcW && syi >= 0 && syi < srcH) {
        const srcIdx = (syi * srcW + sxi) * 4;
        outData[outIdx] = srcData[srcIdx];
        outData[outIdx + 1] = srcData[srcIdx + 1];
        outData[outIdx + 2] = srcData[srcIdx + 2];
        outData[outIdx + 3] = 255;
      } else {
        // Hors de l'image source : pixel blanc (bord de page).
        outData[outIdx] = 255;
        outData[outIdx + 1] = 255;
        outData[outIdx + 2] = 255;
        outData[outIdx + 3] = 255;
      }
    }
  }
  warpedCtx.putImageData(outImageData, 0, 0);

  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = outW;
  finalCanvas.height = outH;
  const finalCtx = finalCanvas.getContext("2d");

  if (filter === "contraste") {
    finalCtx.filter = "contrast(1.35) brightness(1.08)";
    finalCtx.drawImage(warpedCanvas, 0, 0);
    finalCtx.filter = "none";
  } else {
    finalCtx.drawImage(warpedCanvas, 0, 0);
  }

  if (filter === "nb") {
    const imgData = finalCtx.getImageData(0, 0, outW, outH);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let val = (gray - 128) * 1.6 + 128 + 20;
      val = Math.min(255, Math.max(0, val));
      d[i] = val;
      d[i + 1] = val;
      d[i + 2] = val;
    }
    finalCtx.putImageData(imgData, 0, 0);
  }

  return { canvas: finalCanvas, width: outW, height: outH };
}

addPageBtn.addEventListener("click", async () => {
  hideMsg();
  if (!workshopImage || !corners) return;

  addPageBtn.disabled = true;
  try {
    setProgress(10, "Redressement de l'image…");

    const realCorners = {
      tl: { x: corners.tl.x * scaleToReal, y: corners.tl.y * scaleToReal },
      tr: { x: corners.tr.x * scaleToReal, y: corners.tr.y * scaleToReal },
      br: { x: corners.br.x * scaleToReal, y: corners.br.y * scaleToReal },
      bl: { x: corners.bl.x * scaleToReal, y: corners.bl.y * scaleToReal },
    };

    const { canvas: finalCanvas, width, height } = warpAndFilter(workshopImage, realCorners, filterMode);

    setProgress(70, "Compression de la page…");
    const blob = await new Promise((resolve, reject) => {
      finalCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("La conversion de cette page a échoué."))),
        "image/jpeg",
        0.9
      );
    });

    const blobUrl = URL.createObjectURL(blob);
    pages.push({ id: nextPageId++, blobUrl, blob, width, height });

    setProgress(100, "Page ajoutée");
    hideProgress();
    renderPages();

    // Réinitialise l'atelier : on redemande une nouvelle photo.
    if (workshopImageURL) URL.revokeObjectURL(workshopImageURL);
    workshopImage = null;
    workshopImageURL = null;
    corners = null;
    workshopEl.style.display = "none";
  } catch (err) {
    hideProgress();
    showMsg(err.message || "Le redressement de cette page a échoué. Ajustez les coins et réessayez.");
  } finally {
    addPageBtn.disabled = false;
  }
});

/** Reconstruit la grille des miniatures de pages déjà ajoutées. */
function renderPages() {
  pagesGrid.innerHTML = "";
  pagesSection.style.display = pages.length ? "block" : "none";
  pageCountLabel.textContent = pages.length + (pages.length > 1 ? " pages ajoutées" : " page ajoutée");
  createBtn.disabled = pages.length === 0;

  pages.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "thumb";

    const img = document.createElement("img");
    img.src = p.blobUrl;
    img.alt = "Page " + (idx + 1);
    div.appendChild(img);

    const num = document.createElement("div");
    num.className = "t-num";
    num.textContent = "Page " + (idx + 1);
    div.appendChild(num);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";
    actions.innerHTML =
      '<button type="button" class="icon-btn" data-a="up" title="Monter" aria-label="Monter la page ' + (idx + 1) + '">↑</button>' +
      '<button type="button" class="icon-btn" data-a="down" title="Descendre" aria-label="Descendre la page ' + (idx + 1) + '">↓</button>' +
      '<button type="button" class="icon-btn" data-a="del" title="Supprimer" aria-label="Supprimer la page ' + (idx + 1) + '">✕</button>';
    div.appendChild(actions);

    const upBtn = actions.querySelector('[data-a="up"]');
    const downBtn = actions.querySelector('[data-a="down"]');
    const delBtn = actions.querySelector('[data-a="del"]');
    upBtn.disabled = idx === 0;
    downBtn.disabled = idx === pages.length - 1;

    upBtn.addEventListener("click", () => {
      if (idx === 0) return;
      [pages[idx - 1], pages[idx]] = [pages[idx], pages[idx - 1]];
      renderPages();
    });
    downBtn.addEventListener("click", () => {
      if (idx === pages.length - 1) return;
      [pages[idx + 1], pages[idx]] = [pages[idx], pages[idx + 1]];
      renderPages();
    });
    delBtn.addEventListener("click", () => {
      URL.revokeObjectURL(pages[idx].blobUrl);
      pages.splice(idx, 1);
      renderPages();
    });

    pagesGrid.appendChild(div);
  });
}

createBtn.addEventListener("click", async () => {
  hideMsg();
  resultEl.classList.remove("visible");

  if (pages.length === 0) {
    showMsg("Ajoutez au moins une page avant de créer le PDF.");
    return;
  }

  createBtn.disabled = true;
  try {
    const { PDFDocument } = PDFLib;
    const doc = await PDFDocument.create();

    for (let i = 0; i < pages.length; i++) {
      setProgress(Math.round((i / pages.length) * 90), "Ajout de la page " + (i + 1) + " / " + pages.length + "…");
      const p = pages[i];

      let bytes;
      try {
        bytes = await p.blob.arrayBuffer();
      } catch (e) {
        throw new Error("Impossible de lire la page " + (i + 1) + ". Réessayez de l'ajouter.");
      }

      let img;
      try {
        img = await doc.embedJpg(bytes);
      } catch (e) {
        throw new Error("La page " + (i + 1) + " n'a pas pu être intégrée au PDF. Réessayez de l'ajouter.");
      }

      const pageW = p.width * PT_PER_PX;
      const pageH = p.height * PT_PER_PX;
      const page = doc.addPage([pageW, pageH]);
      page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
    }

    setProgress(95, "Génération du fichier final…");
    const bytes = await doc.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, "tchadiapdf-scanne.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "La génération du PDF a échoué. Réessayez.");
  } finally {
    createBtn.disabled = pages.length === 0;
  }
});
