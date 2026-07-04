/* tchadiaPdf : Rogner PDF */

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 Mo

let srcBytes = null;
let previewCanvas = null;
let pageWidthPt = 0;
let pageHeightPt = 0;

// Sélection courante, exprimée en pixels CSS relatifs au canvas d'aperçu (pas au canvas interne).
let sel = null;
let dragStart = null;
let dragging = false;

const cropPreviewHolder = document.getElementById("cropPreviewHolder");
const cropActions = document.getElementById("cropActions");
const cropWrap = document.getElementById("cropWrap");
const cropBox = document.getElementById("cropBox");
const cropBtn = document.getElementById("cropBtn");
const resetBtn = document.getElementById("resetBtn");

previewCanvas = document.getElementById("previewCanvas");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  const file = newFiles[0];

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showMsg("Ce fichier est trop volumineux (100 Mo maximum).");
    return;
  }

  try {
    setProgress(30, "Lecture du fichier…");
    srcBytes = await readAsArrayBuffer(file);

    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
    } catch (err) {
      hideProgress();
      if (err && err.name === "PasswordException") {
        showMsg("Ce PDF est protégé par mot de passe. Retirez la protection avant de le rogner.");
      } else {
        showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
      }
      return;
    }

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    pageWidthPt = viewport.width;
    pageHeightPt = viewport.height;

    await renderPdfPage(pdf, 1, previewCanvas, 500);

    resetSelection();
    cropPreviewHolder.style.display = "flex";
    cropActions.style.display = "flex";
    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointerPos(e) {
  const rect = previewCanvas.getBoundingClientRect();
  return {
    x: clamp(e.clientX - rect.left, 0, rect.width),
    y: clamp(e.clientY - rect.top, 0, rect.height)
  };
}

function updateBoxDisplay() {
  if (!sel) {
    cropBox.style.width = "0px";
    cropBox.style.height = "0px";
    return;
  }
  const canvasRect = previewCanvas.getBoundingClientRect();
  const wrapRect = cropWrap.getBoundingClientRect();
  const offsetX = canvasRect.left - wrapRect.left;
  const offsetY = canvasRect.top - wrapRect.top;
  cropBox.style.left = offsetX + sel.x + "px";
  cropBox.style.top = offsetY + sel.y + "px";
  cropBox.style.width = sel.w + "px";
  cropBox.style.height = sel.h + "px";
}

function resetSelection() {
  sel = null;
  dragStart = null;
  dragging = false;
  updateBoxDisplay();
  cropBtn.disabled = true;
}

cropWrap.style.touchAction = "none";

cropWrap.addEventListener("pointerdown", (e) => {
  if (!previewCanvas) return;
  dragging = true;
  dragStart = pointerPos(e);
  sel = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
  updateBoxDisplay();
  try { cropWrap.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
});

cropWrap.addEventListener("pointermove", (e) => {
  if (!dragging || !dragStart) return;
  const cur = pointerPos(e);
  const left = Math.min(dragStart.x, cur.x);
  const top = Math.min(dragStart.y, cur.y);
  const width = Math.abs(cur.x - dragStart.x);
  const height = Math.abs(cur.y - dragStart.y);
  sel = { x: left, y: top, w: width, h: height };
  updateBoxDisplay();
});

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  if (sel && sel.w >= 2 && sel.h >= 2) {
    cropBtn.disabled = false;
  } else {
    sel = null;
    updateBoxDisplay();
    cropBtn.disabled = true;
  }
}

cropWrap.addEventListener("pointerup", endDrag);
cropWrap.addEventListener("pointercancel", endDrag);

resetBtn.addEventListener("click", () => {
  hideMsg();
  resetSelection();
});

cropBtn.addEventListener("click", async () => {
  hideMsg();

  if (!sel || sel.w < 2 || sel.h < 2) {
    showMsg("Veuillez sélectionner une zone à rogner sur l'aperçu avant de continuer.");
    return;
  }

  cropBtn.disabled = true;
  try {
    setProgress(20, "Calcul de la zone de recadrage…");

    const canvasRect = previewCanvas.getBoundingClientRect();
    const ptPerPxX = pageWidthPt / canvasRect.width;
    const ptPerPxY = pageHeightPt / canvasRect.height;

    const pdfX = sel.x * ptPerPxX;
    const pdfWidth = sel.w * ptPerPxX;
    const pdfHeight = sel.h * ptPerPxY;
    const pdfY = pageHeightPt - (sel.y * ptPerPxY) - pdfHeight;

    setProgress(40, "Ouverture du document…");
    const { PDFDocument } = PDFLib;
    let doc;
    try {
      doc = await PDFDocument.load(srcBytes);
    } catch (err) {
      hideProgress();
      const message = (err && err.message) ? err.message.toLowerCase() : "";
      if (message.indexOf("encrypt") !== -1) {
        showMsg("Ce PDF est protégé par mot de passe. Retirez la protection avant de le rogner.");
      } else {
        showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
      }
      cropBtn.disabled = false;
      return;
    }

    setProgress(60, "Application du recadrage…");
    doc.getPages().forEach((page) => {
      const pw = page.getWidth();
      const ph = page.getHeight();

      const x = clamp(pdfX, 0, pw);
      const y = clamp(pdfY, 0, ph);
      const w = Math.max(0, Math.min(pw, pdfX + pdfWidth) - x);
      const h = Math.max(0, Math.min(ph, pdfY + pdfHeight) - y);

      page.setCropBox(x, y, w, h);
    });

    setProgress(85, "Génération du fichier…");
    const bytes = await doc.save();
    hideProgress();
    offerDownload(bytes, "tchadiapdf-rogne.pdf");
  } catch (e) {
    hideProgress();
    showMsg("Le recadrage a échoué. Réessayez avec un autre fichier.");
  } finally {
    cropBtn.disabled = false;
  }
});
