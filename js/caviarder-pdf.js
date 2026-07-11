/* tchadiaPdf : Caviarder PDF
 *
 * Garantie centrale de l'outil : le texte sous une zone caviardée est
 * réellement supprimé, pas seulement recouvert par un rectangle visuel (ce
 * qui laisserait le texte copiable/extractible sous la zone noire, un piège
 * classique des faux outils de caviardage). pdf-lib ne permet pas de
 * réécrire finement le flux de contenu d'une page (retirer certains
 * fragments de texte tout en gardant le reste en vectoriel) sans un
 * analyseur de flux PDF complet, hors de portée ici et risqué : une erreur
 * y laisserait silencieusement du texte "caviardé" mais toujours présent.
 *
 * Approche retenue, plus simple et sûre : toute page contenant au moins une
 * zone caviardée est intégralement rendue en image (via pdf.js) avec les
 * zones noircies directement dans les pixels, puis cette image remplace la
 * page dans le document de sortie. Le texte et les objets vectoriels de
 * cette page n'existent alors plus du tout dans le PDF final. Les pages
 * sans zone caviardée restent copiées telles quelles (toujours cherchables).
 * Ce compromis (perte de recherche/sélection sur les pages concernées) est
 * documenté explicitement dans l'interface (voir caviarder-pdf.html).
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const RASTER_SCALE = 2; // ~144 DPI equivalent pour les pages rasterisees, bon compromis qualite/poids

let srcBytes = null;
let srcDoc = null; // pdf.js
let pageCount = 0;
let currentPage = 1;
let redactions = new Map(); // pageNum -> [{fracX, fracY, fracW, fracH}, ...]

let dragStart = null;
let dragging = false;
let currentDragPx = null; // rectangle en cours de dessin, en pixels CSS du canvas

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const cavPreviewHolder = document.getElementById("cavPreviewHolder");
const cavActions = document.getElementById("cavActions");
const cavWrap = document.getElementById("cavWrap");
const previewCanvas = document.getElementById("previewCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const pageLabel = document.getElementById("pageLabel");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const clearPageBtn = document.getElementById("clearPageBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const caviarderBtn = document.getElementById("caviarderBtn");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function totalRedactionCount() {
  let n = 0;
  redactions.forEach((list) => { n += list.length; });
  return n;
}

function updateCaviarderBtn() {
  caviarderBtn.disabled = totalRedactionCount() === 0;
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  resetOutil();

  const file = newFiles[0];
  const validation = validateFile(file, { accept: ["pdf", "application/pdf"], acceptLabel: "un fichier PDF", maxWarnBytes: MAX_SIZE });
  if (!validation.ok) {
    showMsg(validation.message);
    return;
  }
  if (validation.warning) showMsg(validation.warning);

  try {
    setProgress(10, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(file);

    let jsDoc;
    try {
      jsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      return;
    }

    srcBytes = bytes;
    srcDoc = jsDoc;
    pageCount = jsDoc.numPages;
    currentPage = 1;
    redactions = new Map();

    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + pageCount + " page" + (pageCount > 1 ? "s" : "");
    fileInfo.style.display = "flex";

    cavPreviewHolder.style.display = "flex";
    cavActions.style.display = "flex";

    await renderCurrentPage();
    hideProgress();
    updateCaviarderBtn();
  } catch (e) {
    hideProgress();
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
});

function resetOutil() {
  srcBytes = null;
  srcDoc = null;
  pageCount = 0;
  currentPage = 1;
  redactions = new Map();
  fileInfo.style.display = "none";
  cavPreviewHolder.style.display = "none";
  cavActions.style.display = "none";
  updateCaviarderBtn();
}

/** Rend la page courante dans le canvas d'aperçu et redimensionne le canvas de recouvrement. */
async function renderCurrentPage() {
  if (!srcDoc) return;
  const disponible = cavWrap.clientWidth || 500;
  const largeur = clamp(disponible, 200, 560);
  await renderPdfPage(srcDoc, currentPage, previewCanvas, largeur);
  overlayCanvas.width = previewCanvas.width;
  overlayCanvas.height = previewCanvas.height;
  overlayCanvas.style.width = previewCanvas.style.width || previewCanvas.width + "px";
  overlayCanvas.style.height = previewCanvas.style.height || previewCanvas.height + "px";
  pageLabel.textContent = "Page " + currentPage + " / " + pageCount;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= pageCount;
  currentDragPx = null;
  redrawOverlay();
}

/** Redessine les zones déjà caviardées de la page courante (noir) et la zone en cours de tracé (bleu, aperçu). */
function redrawOverlay() {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const list = redactions.get(currentPage) || [];
  ctx.fillStyle = "#000000";
  list.forEach((r) => {
    ctx.fillRect(r.fracX * overlayCanvas.width, r.fracY * overlayCanvas.height, r.fracW * overlayCanvas.width, r.fracH * overlayCanvas.height);
  });

  if (currentDragPx) {
    ctx.fillStyle = "rgba(37, 99, 235, 0.35)";
    ctx.fillRect(currentDragPx.x, currentDragPx.y, currentDragPx.w, currentDragPx.h);
  }
}

function pointerPos(e) {
  const rect = previewCanvas.getBoundingClientRect();
  return {
    x: clamp(e.clientX - rect.left, 0, rect.width) * (previewCanvas.width / rect.width),
    y: clamp(e.clientY - rect.top, 0, rect.height) * (previewCanvas.height / rect.height),
  };
}

cavWrap.style.touchAction = "none";

cavWrap.addEventListener("pointerdown", (e) => {
  if (!srcDoc) return;
  dragging = true;
  dragStart = pointerPos(e);
  currentDragPx = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
  redrawOverlay();
  try { cavWrap.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
});

cavWrap.addEventListener("pointermove", (e) => {
  if (!dragging || !dragStart) return;
  const cur = pointerPos(e);
  const left = Math.min(dragStart.x, cur.x);
  const top = Math.min(dragStart.y, cur.y);
  currentDragPx = { x: left, y: top, w: Math.abs(cur.x - dragStart.x), h: Math.abs(cur.y - dragStart.y) };
  redrawOverlay();
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  if (currentDragPx && currentDragPx.w >= 4 && currentDragPx.h >= 4) {
    const list = redactions.get(currentPage) || [];
    list.push({
      fracX: currentDragPx.x / overlayCanvas.width,
      fracY: currentDragPx.y / overlayCanvas.height,
      fracW: currentDragPx.w / overlayCanvas.width,
      fracH: currentDragPx.h / overlayCanvas.height,
    });
    redactions.set(currentPage, list);
  }
  currentDragPx = null;
  redrawOverlay();
  updateCaviarderBtn();
}
cavWrap.addEventListener("pointerup", endDrag);
cavWrap.addEventListener("pointercancel", endDrag);

prevPageBtn.addEventListener("click", async () => {
  if (currentPage <= 1) return;
  currentPage--;
  await renderCurrentPage();
});
nextPageBtn.addEventListener("click", async () => {
  if (currentPage >= pageCount) return;
  currentPage++;
  await renderCurrentPage();
});

clearPageBtn.addEventListener("click", () => {
  redactions.delete(currentPage);
  redrawOverlay();
  updateCaviarderBtn();
});
clearAllBtn.addEventListener("click", () => {
  redactions = new Map();
  redrawOverlay();
  updateCaviarderBtn();
});

async function runCaviarder() {
  hideMsg();
  document.getElementById("result").classList.remove("visible");

  if (totalRedactionCount() === 0) {
    showMsg("Dessinez au moins une zone à caviarder avant de continuer.");
    return;
  }

  caviarderBtn.disabled = true;
  try {
    setProgress(5, "Ouverture du document…");
    const { PDFDocument } = PDFLib;
    let inDoc;
    try {
      inDoc = await PDFDocument.load(srcBytes);
    } catch (e) {
      throw new Error("Impossible d'ouvrir ce PDF pour le caviardage. Il est peut-être protégé par mot de passe ou endommagé.");
    }

    const outDoc = await PDFDocument.create();
    const total = inDoc.getPageCount();

    for (let i = 0; i < total; i++) {
      const pageNum = i + 1;
      const rects = redactions.get(pageNum);
      setProgress(5 + Math.round((i / total) * 85), "Traitement de la page " + pageNum + " / " + total + "…");

      if (!rects || rects.length === 0) {
        const [copied] = await outDoc.copyPages(inDoc, [i]);
        outDoc.addPage(copied);
        continue;
      }

      // Page a caviarder : rendue entierement en image, zones noircies dans les pixels.
      const jsPage = await srcDoc.getPage(pageNum);
      const viewport = jsPage.getViewport({ scale: RASTER_SCALE });
      const rasterCanvas = document.createElement("canvas");
      rasterCanvas.width = Math.round(viewport.width);
      rasterCanvas.height = Math.round(viewport.height);
      const ctx = rasterCanvas.getContext("2d");
      await jsPage.render({ canvasContext: ctx, viewport }).promise;

      ctx.fillStyle = "#000000";
      rects.forEach((r) => {
        ctx.fillRect(r.fracX * rasterCanvas.width, r.fracY * rasterCanvas.height, r.fracW * rasterCanvas.width, r.fracH * rasterCanvas.height);
      });

      const blob = await new Promise((resolve) => rasterCanvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("La conversion de la page " + pageNum + " a échoué.");
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const pngImage = await outDoc.embedPng(pngBytes);

      const origPage = inDoc.getPage(i);
      const pw = origPage.getWidth();
      const ph = origPage.getHeight();
      const newPage = outDoc.addPage([pw, ph]);
      newPage.drawImage(pngImage, { x: 0, y: 0, width: pw, height: ph });
    }

    setProgress(95, "Génération du fichier final…");
    const bytes = await outDoc.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, "tchadiapdf-caviarde.pdf");
  } catch (err) {
    hideProgress();
    showError(err.message || "Le caviardage a échoué. Vérifiez votre fichier et réessayez.", { retry: runCaviarder });
  } finally {
    updateCaviarderBtn();
  }
}

caviarderBtn.addEventListener("click", runCaviarder);
