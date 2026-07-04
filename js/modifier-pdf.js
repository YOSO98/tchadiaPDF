/* tchadiaPdf : Modifier un PDF (texte, surlignage, formes, dessin libre) */

const TAILLE_MAX_OCTETS = 100 * 1024 * 1024; // 100 Mo
const SEUIL_CLIC_PX = 6;   // en dessous de cette distance, un glisser est traité comme un simple clic
const TAILLE_MIN_FORME_PX = 3; // taille minimale pour garder une forme dessinée

const COULEUR_BLEU = "#2563EB";
const COULEUR_SURLIGNAGE = "rgba(37, 99, 235, 0.35)";
const COULEUR_ENCRE = "#1E293B";

let srcBytes = null;       // ArrayBuffer du PDF d'origine
let pdfDocJs = null;       // document pdf.js (aperçu et dimensions de page)
let pageCount = 0;
let currentPageIndex = 0;  // 0-based
let currentPageWidthPt = 0;
let currentPageHeightPt = 0;
let currentTool = "text";
let dragState = null;      // état du geste pointeur en cours
let activeTextInput = null;

// annotationsByPage[indexPage0Based] = tableau d'annotations
let annotationsByPage = {};

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const pageOptions = document.getElementById("pageOptions");
const pageSelect = document.getElementById("pageSelect");
const editorToolbar = document.getElementById("editorToolbar");
const toolSeg = document.getElementById("toolSeg");
const previewSection = document.getElementById("previewSection");
const previewWrap = document.getElementById("previewWrap");
const pageCanvas = document.getElementById("pageCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const undoBtn = document.getElementById("undoBtn");
const saveBtn = document.getElementById("saveBtn");

const overlayCtx = overlayCanvas.getContext("2d");

/* ---------- Chargement du fichier ---------- */

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  resetOutil();

  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > TAILLE_MAX_OCTETS) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo).");
    return;
  }

  try {
    setProgress(20, "Lecture du fichier…");
    const buffer = await readAsArrayBuffer(file);

    // Vérifie que le PDF peut être ouvert (protection ou corruption)
    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(buffer);
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      return;
    }

    setProgress(55, "Préparation de l'aperçu…");
    let jsDoc;
    try {
      jsDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'afficher l'aperçu de ce PDF.");
      return;
    }

    srcBytes = buffer;
    pdfDocJs = jsDoc;
    pageCount = doc.getPageCount();
    annotationsByPage = {};

    if (pageCount < 1) {
      hideProgress();
      showMsg("Ce PDF ne contient aucune page.");
      return;
    }

    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + pageCount + " page" + (pageCount > 1 ? "s" : "");
    fileInfo.style.display = "flex";

    pageSelect.innerHTML = "";
    for (let i = 1; i <= pageCount; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = "Page " + i;
      pageSelect.appendChild(opt);
    }
    pageSelect.value = "1";
    currentPageIndex = 0;

    pageOptions.style.display = "flex";
    editorToolbar.style.display = "flex";
    previewSection.style.display = "block";
    saveBtn.disabled = false;

    await renderCurrentPage();

    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
});

/** Remet l'outil à zéro avant le chargement d'un nouveau fichier. */
function resetOutil() {
  fermerInputTexte(false);
  srcBytes = null;
  pdfDocJs = null;
  pageCount = 0;
  currentPageIndex = 0;
  currentPageWidthPt = 0;
  currentPageHeightPt = 0;
  annotationsByPage = {};
  dragState = null;

  fileInfo.style.display = "none";
  pageOptions.style.display = "none";
  editorToolbar.style.display = "none";
  previewSection.style.display = "none";

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  saveBtn.disabled = true;
}

/* ---------- Sélection de l'outil ---------- */

toolSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tool]");
  if (!btn) return;
  toolSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentTool = btn.dataset.tool;
  overlayCanvas.classList.toggle("tool-text", currentTool === "text");
  fermerInputTexte(false);
});

/* ---------- Aperçu de la page choisie ---------- */

pageSelect.addEventListener("change", async () => {
  fermerInputTexte(false);
  currentPageIndex = parseInt(pageSelect.value, 10) - 1;
  await renderCurrentPage();
});

/** Calcule une largeur d'aperçu adaptée à l'espace disponible. */
function calculerLargeurApercu() {
  const disponible = previewSection.clientWidth || 480;
  return Math.max(240, Math.min(720, disponible));
}

async function renderCurrentPage() {
  if (!pdfDocJs) return;
  const pageNum = currentPageIndex + 1;
  const largeur = calculerLargeurApercu();

  await renderPdfPage(pdfDocJs, pageNum, pageCanvas, largeur);

  const jsPage = await pdfDocJs.getPage(pageNum);
  const viewport = jsPage.getViewport({ scale: 1 });
  currentPageWidthPt = viewport.width;
  currentPageHeightPt = viewport.height;

  overlayCanvas.width = pageCanvas.width;
  overlayCanvas.height = pageCanvas.height;

  redessinerOverlay();
}

/* ---------- Conversion position pointeur -> pixels du canevas ---------- */

function positionSurCanevas(evt) {
  const rect = overlayCanvas.getBoundingClientRect();
  const scaleX = overlayCanvas.width / rect.width;
  const scaleY = overlayCanvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY
  };
}

/* ---------- Stockage et rendu des annotations ---------- */

function ajouterAnnotation(partielle) {
  const ann = Object.assign({}, partielle, {
    pageWidthPt: currentPageWidthPt,
    pageHeightPt: currentPageHeightPt,
    canvasWidthPx: pageCanvas.width,
    canvasHeightPx: pageCanvas.height
  });
  if (!annotationsByPage[currentPageIndex]) annotationsByPage[currentPageIndex] = [];
  annotationsByPage[currentPageIndex].push(ann);
}

/** Redessine tout l'overlay de la page courante à partir du tableau d'annotations. */
function redessinerOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const liste = annotationsByPage[currentPageIndex] || [];
  liste.forEach((ann) => dessinerAnnotationMiseAEchelle(ann));
}

/** Adapte les coordonnées stockées à la résolution actuelle de l'overlay, puis dessine. */
function dessinerAnnotationMiseAEchelle(ann) {
  const f = ann.canvasWidthPx ? (overlayCanvas.width / ann.canvasWidthPx) : 1;
  let a;
  if (ann.type === "text") {
    a = { type: "text", xPx: ann.xPx * f, yPx: ann.yPx * f, text: ann.text, size: ann.size * f };
  } else if (ann.type === "freehand") {
    a = { type: "freehand", points: ann.points.map((p) => ({ x: p.x * f, y: p.y * f })) };
  } else if (ann.type === "line") {
    a = { type: "line", x1Px: ann.x1Px * f, y1Px: ann.y1Px * f, x2Px: ann.x2Px * f, y2Px: ann.y2Px * f };
  } else {
    a = { type: ann.type, xPx: ann.xPx * f, yPx: ann.yPx * f, wPx: ann.wPx * f, hPx: ann.hPx * f };
  }
  dessinerFormeBrute(a);
}

/** Dessine une forme directement dans l'espace pixels courant de l'overlay (sans mise à l'échelle). */
function dessinerFormeBrute(a) {
  switch (a.type) {
    case "text":
      overlayCtx.fillStyle = COULEUR_ENCRE;
      overlayCtx.font = Math.max(1, a.size) + "px Inter, sans-serif";
      overlayCtx.textBaseline = "alphabetic";
      overlayCtx.fillText(a.text, a.xPx, a.yPx);
      break;
    case "highlight":
      overlayCtx.fillStyle = COULEUR_SURLIGNAGE;
      overlayCtx.fillRect(a.xPx, a.yPx, a.wPx, a.hPx);
      break;
    case "rect":
      overlayCtx.strokeStyle = COULEUR_BLEU;
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeRect(a.xPx, a.yPx, a.wPx, a.hPx);
      break;
    case "circle":
      overlayCtx.strokeStyle = COULEUR_BLEU;
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.ellipse(a.xPx + a.wPx / 2, a.yPx + a.hPx / 2, Math.abs(a.wPx / 2), Math.abs(a.hPx / 2), 0, 0, Math.PI * 2);
      overlayCtx.stroke();
      break;
    case "line":
      overlayCtx.strokeStyle = COULEUR_BLEU;
      overlayCtx.lineWidth = 2;
      overlayCtx.lineCap = "round";
      overlayCtx.beginPath();
      overlayCtx.moveTo(a.x1Px, a.y1Px);
      overlayCtx.lineTo(a.x2Px, a.y2Px);
      overlayCtx.stroke();
      break;
    case "freehand":
      if (!a.points || a.points.length < 2) return;
      overlayCtx.strokeStyle = COULEUR_BLEU;
      overlayCtx.lineWidth = 2.5;
      overlayCtx.lineCap = "round";
      overlayCtx.lineJoin = "round";
      overlayCtx.beginPath();
      a.points.forEach((p, i) => {
        if (i === 0) overlayCtx.moveTo(p.x, p.y);
        else overlayCtx.lineTo(p.x, p.y);
      });
      overlayCtx.stroke();
      break;
  }
}

/* ---------- Champ de saisie pour l'outil Texte ---------- */

function ouvrirInputTexte(xPx, yPx) {
  fermerInputTexte(false);

  const ratioX = overlayCanvas.clientWidth / overlayCanvas.width;
  const ratioY = overlayCanvas.clientHeight / overlayCanvas.height;
  const cssX = xPx * ratioX;
  const cssY = yPx * ratioY;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-annotation-input";
  input.style.left = cssX + "px";
  input.style.top = Math.max(0, cssY - 14) + "px";
  previewWrap.appendChild(input);
  input.focus();

  let valide = false;
  const commit = () => {
    if (valide) return;
    valide = true;
    const texte = input.value.trim();
    if (texte) {
      ajouterAnnotation({ type: "text", xPx: xPx, yPx: yPx, text: texte, size: 16 });
      redessinerOverlay();
    }
    if (input.parentNode) input.parentNode.removeChild(input);
    if (activeTextInput === input) activeTextInput = null;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      valide = true; // annule sans créer d'annotation
      if (input.parentNode) input.parentNode.removeChild(input);
      if (activeTextInput === input) activeTextInput = null;
    }
  });
  input.addEventListener("blur", commit);

  activeTextInput = input;
}

/** Ferme le champ de saisie texte actif. Si `valider` est vrai, tente d'enregistrer sa valeur. */
function fermerInputTexte(valider) {
  if (!activeTextInput) return;
  const input = activeTextInput;
  if (!valider) {
    // Retire simplement l'input sans déclencher son gestionnaire blur habituel deux fois
    input.onblur = null;
    if (input.parentNode) input.parentNode.removeChild(input);
    activeTextInput = null;
  } else {
    input.blur();
  }
}

/* ---------- Interaction pointeur sur l'overlay ---------- */

overlayCanvas.addEventListener("pointerdown", (e) => {
  if (!pdfDocJs) return;
  fermerInputTexte(false);
  const pos = positionSurCanevas(e);
  dragState = {
    tool: currentTool,
    startX: pos.x,
    startY: pos.y,
    pointerId: e.pointerId,
    points: [pos]
  };
  try { overlayCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
});

overlayCanvas.addEventListener("pointermove", (e) => {
  if (!dragState) return;
  const pos = positionSurCanevas(e);

  if (dragState.tool === "freehand") {
    const prev = dragState.points[dragState.points.length - 1];
    dragState.points.push(pos);
    overlayCtx.strokeStyle = COULEUR_BLEU;
    overlayCtx.lineWidth = 2.5;
    overlayCtx.lineCap = "round";
    overlayCtx.lineJoin = "round";
    overlayCtx.beginPath();
    overlayCtx.moveTo(prev.x, prev.y);
    overlayCtx.lineTo(pos.x, pos.y);
    overlayCtx.stroke();
  } else if (dragState.tool !== "text") {
    redessinerOverlay();
    if (dragState.tool === "line") {
      dessinerFormeBrute({ type: "line", x1Px: dragState.startX, y1Px: dragState.startY, x2Px: pos.x, y2Px: pos.y });
    } else {
      const x = Math.min(dragState.startX, pos.x);
      const y = Math.min(dragState.startY, pos.y);
      const w = Math.abs(pos.x - dragState.startX);
      const h = Math.abs(pos.y - dragState.startY);
      dessinerFormeBrute({ type: dragState.tool, xPx: x, yPx: y, wPx: w, hPx: h });
    }
  }
});

function terminerGeste(e) {
  if (!dragState) return;
  const pos = positionSurCanevas(e);
  try { overlayCanvas.releasePointerCapture(dragState.pointerId); } catch (err) { /* ignoré */ }

  const dx = pos.x - dragState.startX;
  const dy = pos.y - dragState.startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const outil = dragState.tool;

  if (outil === "text") {
    if (distance < SEUIL_CLIC_PX) {
      ouvrirInputTexte(dragState.startX, dragState.startY);
    }
  } else if (outil === "freehand") {
    dragState.points.push(pos);
    if (dragState.points.length >= 2) {
      ajouterAnnotation({ type: "freehand", points: dragState.points.slice() });
    }
    redessinerOverlay();
  } else if (outil === "line") {
    if (distance >= TAILLE_MIN_FORME_PX) {
      ajouterAnnotation({ type: "line", x1Px: dragState.startX, y1Px: dragState.startY, x2Px: pos.x, y2Px: pos.y });
    }
    redessinerOverlay();
  } else {
    const x = Math.min(dragState.startX, pos.x);
    const y = Math.min(dragState.startY, pos.y);
    const w = Math.abs(pos.x - dragState.startX);
    const h = Math.abs(pos.y - dragState.startY);
    if (w >= TAILLE_MIN_FORME_PX && h >= TAILLE_MIN_FORME_PX) {
      ajouterAnnotation({ type: outil, xPx: x, yPx: y, wPx: w, hPx: h });
    }
    redessinerOverlay();
  }

  dragState = null;
}
overlayCanvas.addEventListener("pointerup", terminerGeste);
overlayCanvas.addEventListener("pointercancel", terminerGeste);
overlayCanvas.addEventListener("pointerleave", (e) => {
  // Un dessin libre commencé puis quitté sans relâcher le pointeur est tout de même conservé
  if (dragState && dragState.tool !== "freehand") terminerGeste(e);
});

/* ---------- Annuler le dernier élément ---------- */

undoBtn.addEventListener("click", () => {
  hideMsg();
  fermerInputTexte(false);
  const liste = annotationsByPage[currentPageIndex];
  if (!liste || !liste.length) {
    showMsg("Il n'y a aucune annotation à annuler sur cette page.");
    return;
  }
  liste.pop();
  redessinerOverlay();
});

/* ---------- Génération du PDF modifié ---------- */

/** Convertit un point en pixels (espace overlay) en point PDF, selon l'échelle et la hauteur de page de l'annotation. */
function pixelVersPdf(xPx, yPx, echelle, pageHeightPt) {
  return {
    x: xPx / echelle,
    y: pageHeightPt - (yPx / echelle)
  };
}

function dessinerAnnotationSurPage(page, ann, font) {
  const echelle = ann.canvasWidthPx / ann.pageWidthPt;
  const pageHeightPt = ann.pageHeightPt;
  const bleu = PDFLib.rgb(0.145, 0.388, 0.922);
  const encre = PDFLib.rgb(0.12, 0.16, 0.22);

  switch (ann.type) {
    case "text": {
      const p = pixelVersPdf(ann.xPx, ann.yPx, echelle, pageHeightPt);
      page.drawText(ann.text, {
        x: p.x,
        y: p.y,
        size: ann.size / echelle,
        font: font,
        color: encre
      });
      break;
    }
    case "highlight": {
      const w = ann.wPx / echelle;
      const h = ann.hPx / echelle;
      const p = pixelVersPdf(ann.xPx, ann.yPx, echelle, pageHeightPt);
      page.drawRectangle({
        x: p.x,
        y: p.y - h,
        width: w,
        height: h,
        color: bleu,
        opacity: 0.35
      });
      break;
    }
    case "rect": {
      const w = ann.wPx / echelle;
      const h = ann.hPx / echelle;
      const p = pixelVersPdf(ann.xPx, ann.yPx, echelle, pageHeightPt);
      page.drawRectangle({
        x: p.x,
        y: p.y - h,
        width: w,
        height: h,
        borderColor: bleu,
        borderWidth: 2
      });
      break;
    }
    case "circle": {
      const w = ann.wPx / echelle;
      const h = ann.hPx / echelle;
      const centrePx = { x: ann.xPx + ann.wPx / 2, y: ann.yPx + ann.hPx / 2 };
      const centre = pixelVersPdf(centrePx.x, centrePx.y, echelle, pageHeightPt);
      page.drawEllipse({
        x: centre.x,
        y: centre.y,
        xScale: Math.abs(w / 2),
        yScale: Math.abs(h / 2),
        borderColor: bleu,
        borderWidth: 2
      });
      break;
    }
    case "line": {
      const p1 = pixelVersPdf(ann.x1Px, ann.y1Px, echelle, pageHeightPt);
      const p2 = pixelVersPdf(ann.x2Px, ann.y2Px, echelle, pageHeightPt);
      page.drawLine({
        start: p1,
        end: p2,
        thickness: 2,
        color: bleu
      });
      break;
    }
    case "freehand": {
      if (!ann.points || ann.points.length < 2) return;
      const pts = ann.points.map((pt) => pixelVersPdf(pt.x, pt.y, echelle, pageHeightPt));
      for (let i = 0; i < pts.length - 1; i++) {
        page.drawLine({
          start: pts[i],
          end: pts[i + 1],
          thickness: 2.5,
          color: bleu
        });
      }
      break;
    }
  }
}

saveBtn.addEventListener("click", async () => {
  hideMsg();
  fermerInputTexte(false);

  if (!srcBytes) {
    showMsg("Veuillez d'abord choisir un fichier PDF.");
    return;
  }

  const indexAvecAnnotations = Object.keys(annotationsByPage).filter(
    (k) => annotationsByPage[k] && annotationsByPage[k].length > 0
  );
  if (indexAvecAnnotations.length === 0) {
    showMsg("Ajoutez au moins une annotation avant d'enregistrer le PDF.");
    return;
  }

  saveBtn.disabled = true;
  try {
    setProgress(15, "Ouverture du PDF…");
    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(srcBytes);
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      saveBtn.disabled = false;
      return;
    }

    setProgress(35, "Préparation de la police…");
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const pages = doc.getPages();

    setProgress(55, "Ajout des annotations…");
    for (const cle of indexAvecAnnotations) {
      const idx = parseInt(cle, 10);
      if (idx < 0 || idx >= pages.length) continue;
      const page = pages[idx];
      const liste = annotationsByPage[cle];
      for (const ann of liste) {
        dessinerAnnotationSurPage(page, ann, font);
      }
    }

    setProgress(90, "Génération du fichier…");
    const bytes = await doc.save();
    hideProgress();
    offerDownload(bytes, "tchadiapdf-modifie.pdf");
  } catch (e) {
    hideProgress();
    showMsg("La modification du PDF a échoué. Réessayez avec un autre fichier.");
  } finally {
    saveBtn.disabled = false;
  }
});
