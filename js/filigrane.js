/* tchadiaPdf : Ajouter un filigrane */

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 Mo
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 Mo
const MAX_FICHIERS_LOT = 50;

let srcBytes = null; // utilisé uniquement en mode "un seul fichier"
let srcName = "";
let watermarkType = "texte";
let textSize = 48;
let opacity = 0.3;
let position = "centre";
let orientation = "diagonale";
let textColor = "#1e293b";
let imageBytes = null;
let imageMime = null;
let previewPageSize = { width: 595, height: 842 }; // A4 par défaut (points), affiné dès qu'un PDF est chargé
let previewImageEl = null;
let previewImageUrl = null;

// File d'attente utilisée dès que 2 fichiers PDF ou plus sont sélectionnés
let queue = []; // { id, file, status: "attente" | "cours" | "termine" | "erreur", error }
let nextId = 1;
let batchState = "idle"; // idle | running | paused | cancelled
let batchRunning = false;

const wmOptions = document.getElementById("wmOptions");
const pdfFileList = document.getElementById("pdfFileList");
const textFields = document.getElementById("textFields");
const sizeFields = document.getElementById("sizeFields");
const imageFields = document.getElementById("imageFields");
const imageFileList = document.getElementById("imageFileList");
const wmText = document.getElementById("wmText");
const wmOpacity = document.getElementById("wmOpacity");
const opacityVal = document.getElementById("opacityVal");
const wmColor = document.getElementById("wmColor");
const previewCanvas = document.getElementById("wmPreview");
const applyBtn = document.getElementById("applyBtn");
const batchActions = document.getElementById("batchActions");
const startBatchBtn = document.getElementById("startBatchBtn");
const pauseBatchBtn = document.getElementById("pauseBatchBtn");
const cancelBatchBtn = document.getElementById("cancelBatchBtn");
const globalProgress = document.getElementById("globalProgress");
const globalProgressLabel = document.getElementById("globalProgressLabel");
const resultEl = document.getElementById("result");

/* ---------- Dépôt du ou des PDF cibles ---------- */
initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");

  if (batchRunning) {
    showMsg("Un traitement est en cours. Attendez la fin ou annulez le lot avant d'ajouter des fichiers.");
    return;
  }

  const valides = [];
  let ignores = 0;
  newFiles.forEach((file) => {
    const estPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!estPdf || file.size > MAX_PDF_SIZE) {
      ignores++;
      return;
    }
    valides.push(file);
  });

  const placesRestantes = Math.max(MAX_FICHIERS_LOT - queue.length, 0);
  const ajoutes = valides.slice(0, placesRestantes);
  const refuses = valides.length - ajoutes.length;

  ajoutes.forEach((file) => {
    queue.push({ id: nextId++, file, status: "attente", error: "" });
  });

  const messages = [];
  if (ignores > 0) {
    messages.push(ignores + " fichier(s) ignoré(s) : format non PDF ou taille supérieure à 100 Mo.");
  }
  if (refuses > 0) {
    messages.push("Limite de " + MAX_FICHIERS_LOT + " fichiers atteinte : " + refuses + " fichier(s) supplémentaire(s) n'ont pas été ajoutés.");
  }
  if (messages.length) showMsg(messages.join(" "));

  await syncMode();
});

/** Bascule l'affichage entre mode "un seul fichier" et mode "lot". */
async function syncMode() {
  if (queue.length === 0) {
    srcBytes = null;
    srcName = "";
    previewPageSize = { width: 595, height: 842 };
    pdfFileList.innerHTML = "";
    wmOptions.style.display = "none";
    applyBtn.style.display = "";
    applyBtn.disabled = true;
    batchActions.style.display = "none";
    globalProgress.classList.remove("visible");
    return;
  }

  if (queue.length === 1) {
    batchActions.style.display = "none";
    applyBtn.style.display = "";
    globalProgress.classList.remove("visible");
    await validerFichierUnique(queue[0]);
    return;
  }

  // Mode lot : 2 fichiers ou plus
  applyBtn.style.display = "none";
  wmOptions.style.display = "flex";
  batchActions.style.display = "flex";
  hideMsg();
  renderQueueList();
  updateBatchButtons();
  const traites = queue.filter((q) => q.status === "termine" || q.status === "erreur").length;
  setGlobalProgress(traites, queue.length);
  updatePreview();
}

/** Reproduit la validation d'origine pour le cas d'un seul fichier sélectionné. */
async function validerFichierUnique(item) {
  srcBytes = null;
  srcName = "";

  try {
    setProgress(30, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(item.file);
    // Vérification de lisibilité du PDF (protection par mot de passe, corruption)
    const tmpDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
    const firstPage = tmpDoc.getPage(0);
    previewPageSize = firstPage.getSize();

    srcBytes = bytes;
    srcName = item.file.name;
    renderSingleFile();

    wmOptions.style.display = "flex";
    applyBtn.disabled = false;
    hideProgress();
    updatePreview();
  } catch (e) {
    hideProgress();
    queue = queue.filter((q) => q.id !== item.id);
    srcBytes = null;
    srcName = "";
    renderSingleFile();
    wmOptions.style.display = "none";
    applyBtn.disabled = true;
    showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }
}

function renderSingleFile() {
  pdfFileList.innerHTML = "";
  if (!srcBytes) return;
  const row = document.createElement("div");
  row.className = "file-item";
  row.innerHTML =
    '<span class="f-name"></span>' +
    '<span class="f-meta"></span>' +
    '<button class="icon-btn" title="Retirer" aria-label="Retirer le fichier">✕</button>';
  row.querySelector(".f-name").textContent = srcName;
  row.querySelector(".f-meta").textContent = fmtSize(srcBytes.byteLength);
  row.querySelector("button").onclick = () => {
    queue = [];
    srcBytes = null;
    srcName = "";
    syncMode();
  };
  pdfFileList.appendChild(row);
}

/** Construit la liste visuelle des fichiers en mode lot. */
function renderQueueList() {
  pdfFileList.innerHTML = "";
  queue.forEach((item) => {
    const row = document.createElement("div");
    row.className = "file-item";
    row.innerHTML =
      '<span class="f-name"></span>' +
      '<span class="f-meta"></span>' +
      '<span class="f-status"></span>' +
      '<button type="button" class="icon-btn" title="Retirer" aria-label="Retirer le fichier">✕</button>';
    row.querySelector(".f-name").textContent = item.file.name;
    row.querySelector(".f-meta").textContent = fmtSize(item.file.size);

    const statusEl = row.querySelector(".f-status");
    statusEl.textContent = libelleStatut(item);
    statusEl.classList.toggle("is-done", item.status === "termine");

    const removeBtn = row.querySelector(".icon-btn");
    removeBtn.disabled = batchState === "running";
    removeBtn.addEventListener("click", () => {
      queue = queue.filter((q) => q.id !== item.id);
      syncMode();
    });

    pdfFileList.appendChild(row);
  });
}

function libelleStatut(item) {
  switch (item.status) {
    case "cours": return "En cours…";
    case "termine": return "Terminé";
    case "erreur": return "Erreur : " + (item.error || "échec du traitement");
    default: return "En attente";
  }
}

function updateBatchButtons() {
  const tousTraites = queue.length > 0 && queue.every((q) => q.status === "termine" || q.status === "erreur");
  startBatchBtn.disabled = batchState === "running" || queue.length === 0 || tousTraites;
  pauseBatchBtn.disabled = !(batchState === "running" || batchState === "paused");
  pauseBatchBtn.textContent = batchState === "paused" ? "Reprendre" : "Mettre en pause";
  cancelBatchBtn.disabled = queue.length === 0;
}

function setGlobalProgress(traites, total) {
  globalProgress.classList.add("visible");
  globalProgressLabel.textContent = "Fichiers traités : " + traites + " / " + total;
  globalProgress.querySelector(".progress-bar > div").style.width = (total > 0 ? Math.round((traites / total) * 100) : 0) + "%";
}

/* ---------- Type de filigrane : texte / image ---------- */
const orientFields = document.getElementById("orientFields");
const colorFields = document.getElementById("colorFields");

document.querySelectorAll("#typeSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#typeSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    watermarkType = btn.dataset.type;
    const isTexte = watermarkType === "texte";
    textFields.style.display = isTexte ? "flex" : "none";
    sizeFields.style.display = isTexte ? "flex" : "none";
    orientFields.style.display = isTexte ? "flex" : "none";
    colorFields.style.display = isTexte ? "flex" : "none";
    imageFields.style.display = isTexte ? "none" : "flex";
    updatePreview();
  });
});

/* ---------- Taille du texte ---------- */
document.querySelectorAll("#sizeSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#sizeSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    textSize = parseInt(btn.dataset.size, 10);
    updatePreview();
  });
});

/* ---------- Orientation du texte ---------- */
document.querySelectorAll("#orientSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#orientSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    orientation = btn.dataset.orient;
    updatePreview();
  });
});

/* ---------- Couleur du texte ---------- */
wmColor.addEventListener("input", () => {
  textColor = wmColor.value;
  updatePreview();
});

/* ---------- Opacité ---------- */
wmOpacity.addEventListener("input", () => {
  opacity = parseFloat(wmOpacity.value);
  opacityVal.textContent = Math.round(opacity * 100) + " %";
  updatePreview();
});

/* ---------- Position ---------- */
document.querySelectorAll("#posGrid button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#posGrid button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    position = btn.dataset.pos;
    updatePreview();
  });
});

/* ---------- Texte du filigrane (aperçu en direct) ---------- */
wmText.addEventListener("input", updatePreview);

/* ---------- Dépôt de l'image de filigrane (réglage unique, partagé par tout le lot) ---------- */
initDropzone("dzImage", "imageInput", async (newFiles) => {
  hideMsg();
  const file = newFiles[0];
  const isJpeg = file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name);
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);

  if (!isJpeg && !isPng) {
    showMsg("Le filigrane image doit être au format JPG ou PNG.");
    return;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    showMsg("L'image est trop volumineuse (limite 20 Mo).");
    return;
  }

  try {
    imageBytes = await readAsArrayBuffer(file);
    imageMime = isPng ? "image/png" : "image/jpeg";
    renderImageFile(file);
    setPreviewImage(imageBytes, imageMime);
  } catch (e) {
    imageBytes = null;
    imageMime = null;
    showMsg("Impossible de lire l'image du filigrane. Utilisez un fichier JPG ou PNG.");
  }
});

/** Charge l'image de filigrane dans un <img> en mémoire pour l'aperçu en direct (canvas). */
function setPreviewImage(bytes, mime) {
  if (previewImageUrl) {
    URL.revokeObjectURL(previewImageUrl);
    previewImageUrl = null;
  }
  if (!bytes) {
    previewImageEl = null;
    updatePreview();
    return;
  }
  const blob = new Blob([bytes], { type: mime });
  previewImageUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    previewImageEl = img;
    updatePreview();
  };
  img.src = previewImageUrl;
}

function renderImageFile(file) {
  imageFileList.innerHTML = "";
  if (!imageBytes) return;
  const row = document.createElement("div");
  row.className = "file-item";
  row.innerHTML =
    '<span class="f-name"></span>' +
    '<span class="f-meta"></span>' +
    '<button class="icon-btn" title="Retirer" aria-label="Retirer l\'image">✕</button>';
  row.querySelector(".f-name").textContent = file.name;
  row.querySelector(".f-meta").textContent = fmtSize(file.size);
  row.querySelector("button").onclick = () => {
    imageBytes = null;
    imageMime = null;
    imageFileList.innerHTML = "";
    setPreviewImage(null, null);
  };
  imageFileList.appendChild(row);
}

/* ---------- Calcul de position pour le texte (sans rotation) ---------- */
function textCornerPosition(pos, width, height, textWidth, size) {
  const margin = 40;
  switch (pos) {
    case "hg": return { x: margin, y: height - margin - size };
    case "hd": return { x: width - margin - textWidth, y: height - margin - size };
    case "bg": return { x: margin, y: margin };
    default:   return { x: width - margin - textWidth, y: margin }; // bd
  }
}

/* ---------- Calcul de position pour l'image ---------- */
function imagePosition(pos, width, height, w, h) {
  const margin = 30;
  switch (pos) {
    case "centre": return { x: (width - w) / 2, y: (height - h) / 2 };
    case "hg": return { x: margin, y: height - margin - h };
    case "hd": return { x: width - margin - w, y: height - margin - h };
    case "bg": return { x: margin, y: margin };
    default:   return { x: width - margin - w, y: margin }; // bd
  }
}

/** Convertit une couleur hexadécimale (#rrggbb) en composantes normalisées pour pdf-lib rgb(). */
function hexToRgbNorm(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0.12, g: 0.16, b: 0.22 };
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}

/* ---------- Aperçu en direct (canvas, indicatif : ne rend pas le PDF réel) ---------- */
function updatePreview() {
  if (!previewCanvas) return;
  const ctx = previewCanvas.getContext("2d");
  const cw = previewCanvas.width;
  const ch = previewCanvas.height;
  ctx.clearRect(0, 0, cw, ch);

  const ratio = previewPageSize.height / previewPageSize.width;
  const drawW = Math.min(cw, ch / ratio);
  const drawH = drawW * ratio;
  const offsetX = (cw - drawW) / 2;
  const offsetY = (ch - drawH) / 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(offsetX, offsetY, drawW, drawH);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, drawW - 1, drawH - 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(offsetX, offsetY, drawW, drawH);
  ctx.clip();

  const margin = drawW * 0.08;
  const anchors = {
    centre: { x: offsetX + drawW / 2, y: offsetY + drawH / 2, align: "center", baseline: "middle" },
    hg: { x: offsetX + margin, y: offsetY + margin, align: "left", baseline: "top" },
    hd: { x: offsetX + drawW - margin, y: offsetY + margin, align: "right", baseline: "top" },
    bg: { x: offsetX + margin, y: offsetY + drawH - margin, align: "left", baseline: "bottom" },
    bd: { x: offsetX + drawW - margin, y: offsetY + drawH - margin, align: "right", baseline: "bottom" },
  };
  const anchor = anchors[position] || anchors.centre;

  if (watermarkType === "texte") {
    const texte = wmText.value.trim() || "CONFIDENTIEL";
    const size = Math.max(8, (textSize / previewPageSize.height) * drawH);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = textColor;
    ctx.font = "700 " + size + "px Inter, Arial, sans-serif";
    ctx.textAlign = anchor.align;
    ctx.textBaseline = anchor.baseline;
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(orientation === "diagonale" ? -Math.PI / 4 : 0);
    ctx.fillText(texte, 0, 0);
  } else if (previewImageEl) {
    const w = drawW * 0.3;
    const h = w * (previewImageEl.naturalHeight / previewImageEl.naturalWidth);
    let ix, iy;
    if (position === "centre") {
      ix = offsetX + drawW / 2 - w / 2;
      iy = offsetY + drawH / 2 - h / 2;
    } else if (position === "hg") {
      ix = offsetX + margin; iy = offsetY + margin;
    } else if (position === "hd") {
      ix = offsetX + drawW - margin - w; iy = offsetY + margin;
    } else if (position === "bg") {
      ix = offsetX + margin; iy = offsetY + drawH - margin - h;
    } else {
      ix = offsetX + drawW - margin - w; iy = offsetY + drawH - margin - h;
    }
    ctx.globalAlpha = opacity;
    ctx.drawImage(previewImageEl, ix, iy, w, h);
  } else {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Choisissez une image", offsetX + drawW / 2, offsetY + drawH / 2);
  }

  ctx.restore();
}

/* ---------- Application du filigrane (mode un seul fichier) ---------- */
applyBtn.addEventListener("click", async () => {
  hideMsg();
  resultEl.classList.remove("visible");

  if (!srcBytes) {
    showMsg("Choisissez d'abord un fichier PDF.");
    return;
  }
  if (watermarkType === "texte" && !wmText.value.trim()) {
    showMsg("Saisissez un texte pour le filigrane.");
    return;
  }
  if (watermarkType === "image" && !imageBytes) {
    showMsg("Choisissez une image pour le filigrane.");
    return;
  }

  applyBtn.disabled = true;
  try {
    setProgress(15, "Chargement du PDF…");
    const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(srcBytes, { ignoreEncryption: false });
    } catch (e) {
      throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
    }

    const pages = doc.getPages();
    if (pages.length === 0) {
      throw new Error("Ce PDF ne contient aucune page.");
    }

    if (watermarkType === "texte") {
      setProgress(35, "Préparation du texte…");
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const texte = wmText.value.trim();
      const size = textSize;
      const textWidth = font.widthOfTextAtSize(texte, size);
      const angleRad = orientation === "diagonale" ? Math.PI / 4 : 0;
      const rotate = degrees(orientation === "diagonale" ? 45 : 0);
      const c = hexToRgbNorm(textColor);

      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        let x, y;

        if (position === "centre") {
          x = width / 2 - (textWidth / 2) * Math.cos(angleRad);
          y = height / 2 - (textWidth / 2) * Math.sin(angleRad);
        } else {
          const p = textCornerPosition(position, width, height, textWidth, size);
          x = p.x;
          y = p.y;
        }

        page.drawText(texte, {
          x, y, size, font,
          opacity,
          color: rgb(c.r, c.g, c.b),
          rotate,
        });

        setProgress(35 + Math.round(((i + 1) / pages.length) * 50), "Application du filigrane…");
      });
    } else {
      setProgress(35, "Préparation de l'image…");
      let img;
      try {
        img = imageMime === "image/png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
      } catch (e) {
        throw new Error("Impossible de lire l'image du filigrane. Utilisez un fichier JPG ou PNG.");
      }

      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        const scale = (width * 0.3) / img.width;
        const w = img.width * scale;
        const h = img.height * scale;
        const p = imagePosition(position, width, height, w, h);

        page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, opacity });

        setProgress(35 + Math.round(((i + 1) / pages.length) * 50), "Application du filigrane…");
      });
    }

    setProgress(92, "Génération du fichier…");
    const out = await doc.save();
    setProgress(100, "Terminé");
    hideProgress();
    resultEl.querySelector("p").textContent = "Votre PDF avec filigrane est prêt.";
    offerDownload(out, "tchadiapdf-filigrane.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "L'application du filigrane a échoué. Réessayez avec un autre fichier.");
  } finally {
    applyBtn.disabled = false;
  }
});

/* ---------- Application du filigrane à un buffer donné (utilisé en mode lot) ---------- */
async function appliquerFiligraneAuBuffer(buffer) {
  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

  let doc;
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  } catch (e) {
    throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }

  const pages = doc.getPages();
  if (pages.length === 0) {
    throw new Error("Ce PDF ne contient aucune page.");
  }

  if (watermarkType === "texte") {
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const texte = wmText.value.trim();
    const size = textSize;
    const textWidth = font.widthOfTextAtSize(texte, size);
    const angleRad = orientation === "diagonale" ? Math.PI / 4 : 0;
    const rotate = degrees(orientation === "diagonale" ? 45 : 0);
    const c = hexToRgbNorm(textColor);

    pages.forEach((page) => {
      const { width, height } = page.getSize();
      let x, y;

      if (position === "centre") {
        x = width / 2 - (textWidth / 2) * Math.cos(angleRad);
        y = height / 2 - (textWidth / 2) * Math.sin(angleRad);
      } else {
        const p = textCornerPosition(position, width, height, textWidth, size);
        x = p.x;
        y = p.y;
      }

      page.drawText(texte, {
        x, y, size, font,
        opacity,
        color: rgb(c.r, c.g, c.b),
        rotate,
      });
    });
  } else {
    let img;
    try {
      img = imageMime === "image/png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
    } catch (e) {
      throw new Error("Impossible de lire l'image du filigrane. Utilisez un fichier JPG ou PNG.");
    }

    pages.forEach((page) => {
      const { width, height } = page.getSize();
      const scale = (width * 0.3) / img.width;
      const w = img.width * scale;
      const h = img.height * scale;
      const p = imagePosition(position, width, height, w, h);
      page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, opacity });
    });
  }

  return doc.save();
}

/** Retire l'extension ".pdf" d'un nom de fichier. */
function nomSansExtension(nomFichier) {
  return nomFichier.replace(/\.pdf$/i, "");
}

/** Garantit un nom de fichier unique dans l'archive ZIP. */
function nomUnique(nom, utilises) {
  if (!utilises.has(nom)) {
    utilises.add(nom);
    return nom;
  }
  const point = nom.lastIndexOf(".");
  const base = point === -1 ? nom : nom.slice(0, point);
  const ext = point === -1 ? "" : nom.slice(point);
  let i = 2;
  let candidat = base + " (" + i + ")" + ext;
  while (utilises.has(candidat)) {
    i++;
    candidat = base + " (" + i + ")" + ext;
  }
  utilises.add(candidat);
  return candidat;
}

/* ---------- Traitement du lot ---------- */

function attendreReprise() {
  return new Promise((resolve) => {
    const verifier = () => {
      if (batchState !== "paused") {
        resolve();
      } else {
        setTimeout(verifier, 150);
      }
    };
    verifier();
  });
}

startBatchBtn.addEventListener("click", async () => {
  if (batchRunning) return;
  await lancerLot();
});

pauseBatchBtn.addEventListener("click", () => {
  if (batchState === "running") {
    batchState = "paused";
  } else if (batchState === "paused") {
    batchState = "running";
  }
  updateBatchButtons();
});

cancelBatchBtn.addEventListener("click", () => {
  batchState = "cancelled";
  if (!batchRunning) {
    queue = [];
    hideMsg();
    resultEl.classList.remove("visible");
    batchState = "idle";
    syncMode();
  }
});

async function lancerLot() {
  hideMsg();
  resultEl.classList.remove("visible");

  if (watermarkType === "texte" && !wmText.value.trim()) {
    showMsg("Saisissez un texte pour le filigrane.");
    return;
  }
  if (watermarkType === "image" && !imageBytes) {
    showMsg("Choisissez une image pour le filigrane.");
    return;
  }

  batchRunning = true;
  batchState = "running";
  updateBatchButtons();

  const total = queue.length;
  let traites = 0;
  const resultats = [];
  const nomsUtilises = new Set();

  setGlobalProgress(0, total);

  for (const item of queue) {
    if (batchState === "cancelled") break;
    await attendreReprise();
    if (batchState === "cancelled") break;

    item.status = "cours";
    renderQueueList();
    setProgress(30, "Traitement de « " + item.file.name + " »…");

    try {
      const buffer = await readAsArrayBuffer(item.file);
      const bytes = await appliquerFiligraneAuBuffer(buffer);
      const nomFinal = nomUnique(nomSansExtension(item.file.name) + "-filigrane.pdf", nomsUtilises);
      resultats.push({ nom: nomFinal, bytes });
      item.status = "termine";
      item.error = "";
    } catch (e) {
      item.status = "erreur";
      item.error = e.message || "Le traitement a échoué.";
    }

    traites++;
    renderQueueList();
    setGlobalProgress(traites, total);
  }

  batchRunning = false;
  const etatFinal = batchState;
  batchState = "idle";
  updateBatchButtons();
  hideProgress();

  if (etatFinal === "cancelled") {
    showMsg("Traitement annulé. " + traites + " fichier(s) sur " + total + " avaient déjà été traités.");
    return;
  }

  const echecs = queue.filter((q) => q.status === "erreur").length;

  if (resultats.length === 0) {
    showMsg("Aucun fichier n'a pu être traité. Consultez le détail des erreurs dans la liste ci-dessus.");
    return;
  }

  try {
    setProgress(90, "Génération de l'archive ZIP…");
    const zip = new JSZip();
    resultats.forEach((r) => zip.file(r.nom, r.bytes));
    const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
      setProgress(90 + Math.round(meta.percent / 10), "Génération de l'archive ZIP…");
    });
    hideProgress();
    resultEl.querySelector("p").textContent =
      resultats.length + " fichier(s) avec filigrane sur " + total + (echecs > 0 ? ". " + echecs + " échec(s), voir le détail ci-dessus." : ".");
    offerDownload(zipBlob, "tchadiapdf-filigrane-lot.zip", "application/zip");
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive ZIP a échoué.");
  }
}

updatePreview();
