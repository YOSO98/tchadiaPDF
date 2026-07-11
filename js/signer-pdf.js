/* tchadiaPdf : Signer un PDF */

const TAILLE_MAX_OCTETS = 100 * 1024 * 1024; // 100 Mo
const SIG_RATIO = 150 / 400; // ratio hauteur / largeur du canevas de signature

let srcBytes = null;      // ArrayBuffer du PDF d'origine
let pdfDocJs = null;      // document pdf.js (pour l'aperçu et les dimensions de page)
let pageCount = 0;
let currentPageNum = 1;
let hasSignature = false;
let drawingSig = false;
let draggingOverlay = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const pageOptions = document.getElementById("pageOptions");
const pageSelect = document.getElementById("pageSelect");
const previewSection = document.getElementById("previewSection");
const previewWrap = document.getElementById("previewWrap");
const previewCanvas = document.getElementById("previewCanvas");
const sigOverlay = document.getElementById("sigOverlay");
const sizeRange = document.getElementById("sizeRange");
const signPadSection = document.getElementById("signPadSection");
const sigCanvas = document.getElementById("sigCanvas");
const clearSigBtn = document.getElementById("clearSigBtn");
const signBtn = document.getElementById("signBtn");

const sigCtx = sigCanvas.getContext("2d");
sigCtx.strokeStyle = "#1E293B";
sigCtx.lineWidth = 2.5;
sigCtx.lineCap = "round";
sigCtx.lineJoin = "round";

/* ---------- Chargement du fichier ---------- */

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  resetOutil();

  const file = newFiles[0];
  const validation = validateFile(file, { accept: ["pdf", "application/pdf"], acceptLabel: "un fichier PDF", maxWarnBytes: TAILLE_MAX_OCTETS });
  if (!validation.ok) {
    showMsg(validation.message);
    return;
  }
  if (validation.warning) showMsg(validation.warning);

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
    currentPageNum = 1;

    pageOptions.style.display = "flex";
    previewSection.style.display = "block";
    signPadSection.style.display = "block";

    await renderSelectedPage(currentPageNum);

    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
});

/** Remet l'outil à zéro avant le chargement d'un nouveau fichier. */
function resetOutil() {
  srcBytes = null;
  pdfDocJs = null;
  pageCount = 0;
  currentPageNum = 1;
  hasSignature = false;

  fileInfo.style.display = "none";
  pageOptions.style.display = "none";
  previewSection.style.display = "none";
  signPadSection.style.display = "none";

  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  sigOverlay.style.display = "none";
  sigOverlay.removeAttribute("src");

  signBtn.disabled = true;
}

/* ---------- Aperçu de la page choisie ---------- */

pageSelect.addEventListener("change", async () => {
  currentPageNum = parseInt(pageSelect.value, 10);
  signBtn.disabled = true;
  await renderSelectedPage(currentPageNum);
  signBtn.disabled = !hasSignature;
});

/** Calcule une largeur d'aperçu adaptée à l'espace disponible. */
function calculerLargeurApercu() {
  const disponible = previewSection.clientWidth || 320;
  return Math.max(200, Math.min(480, disponible));
}

async function renderSelectedPage(pageNum) {
  if (!pdfDocJs) return;
  const largeur = calculerLargeurApercu();
  await renderPdfPage(pdfDocJs, pageNum, previewCanvas, largeur);
  clampOverlay();
}

/* ---------- Dessin de la signature ---------- */

/** Convertit la position d'un événement pointeur en coordonnées internes du canevas. */
function positionSurCanevas(evt, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY
  };
}

sigCanvas.addEventListener("pointerdown", (e) => {
  drawingSig = true;
  sigCanvas.setPointerCapture(e.pointerId);
  const pos = positionSurCanevas(e, sigCanvas);
  sigCtx.beginPath();
  sigCtx.moveTo(pos.x, pos.y);
});

sigCanvas.addEventListener("pointermove", (e) => {
  if (!drawingSig) return;
  const pos = positionSurCanevas(e, sigCanvas);
  sigCtx.lineTo(pos.x, pos.y);
  sigCtx.stroke();
  hasSignature = true;
});

function terminerTrait(e) {
  if (!drawingSig) return;
  drawingSig = false;
  try { sigCanvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
  if (hasSignature) {
    mettreAJourApercuSignature();
    signBtn.disabled = false;
  }
}
sigCanvas.addEventListener("pointerup", terminerTrait);
sigCanvas.addEventListener("pointercancel", terminerTrait);
sigCanvas.addEventListener("pointerleave", (e) => { if (drawingSig) terminerTrait(e); });

clearSigBtn.addEventListener("click", () => {
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  hasSignature = false;
  sigOverlay.style.display = "none";
  signBtn.disabled = true;
  hideMsg();
});

/** Met à jour l'image de l'overlay à partir du contenu actuel du canevas de signature. */
function mettreAJourApercuSignature() {
  const etaitCachee = sigOverlay.style.display === "none" || !sigOverlay.style.display;
  sigOverlay.src = sigCanvas.toDataURL("image/png");
  if (etaitCachee) {
    const largeurBase = 150 * (parseInt(sizeRange.value, 10) / 100);
    const hauteurBase = largeurBase * SIG_RATIO;
    sigOverlay.style.width = largeurBase + "px";
    sigOverlay.style.height = hauteurBase + "px";
    sigOverlay.style.left = "20px";
    sigOverlay.style.top = "20px";
    sigOverlay.style.display = "block";
    clampOverlay();
  }
}

/* ---------- Redimensionnement de la signature ---------- */

sizeRange.addEventListener("input", () => {
  if (sigOverlay.style.display === "none" || !sigOverlay.style.display) return;
  const largeurBase = 150 * (parseInt(sizeRange.value, 10) / 100);
  const hauteurBase = largeurBase * SIG_RATIO;
  sigOverlay.style.width = largeurBase + "px";
  sigOverlay.style.height = hauteurBase + "px";
  clampOverlay();
});

/* ---------- Déplacement de la signature (glisser) ---------- */

sigOverlay.addEventListener("pointerdown", (e) => {
  draggingOverlay = true;
  sigOverlay.setPointerCapture(e.pointerId);
  const wrapRect = previewWrap.getBoundingClientRect();
  const pointeurX = e.clientX - wrapRect.left;
  const pointeurY = e.clientY - wrapRect.top;
  dragOffsetX = pointeurX - (parseFloat(sigOverlay.style.left) || 0);
  dragOffsetY = pointeurY - (parseFloat(sigOverlay.style.top) || 0);
});

sigOverlay.addEventListener("pointermove", (e) => {
  if (!draggingOverlay) return;
  const wrapRect = previewWrap.getBoundingClientRect();
  const pointeurX = e.clientX - wrapRect.left;
  const pointeurY = e.clientY - wrapRect.top;
  let left = pointeurX - dragOffsetX;
  let top = pointeurY - dragOffsetY;
  const maxLeft = Math.max(0, previewWrap.clientWidth - sigOverlay.offsetWidth);
  const maxTop = Math.max(0, previewWrap.clientHeight - sigOverlay.offsetHeight);
  left = Math.min(Math.max(left, 0), maxLeft);
  top = Math.min(Math.max(top, 0), maxTop);
  sigOverlay.style.left = left + "px";
  sigOverlay.style.top = top + "px";
});

function terminerDeplacement(e) {
  if (!draggingOverlay) return;
  draggingOverlay = false;
  try { sigOverlay.releasePointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
}
sigOverlay.addEventListener("pointerup", terminerDeplacement);
sigOverlay.addEventListener("pointercancel", terminerDeplacement);

/** Recadre la signature dans les limites de l'aperçu (après changement de page ou de taille). */
function clampOverlay() {
  if (sigOverlay.style.display === "none" || !sigOverlay.style.display) return;
  const maxLeft = Math.max(0, previewWrap.clientWidth - sigOverlay.offsetWidth);
  const maxTop = Math.max(0, previewWrap.clientHeight - sigOverlay.offsetHeight);
  let left = parseFloat(sigOverlay.style.left) || 0;
  let top = parseFloat(sigOverlay.style.top) || 0;
  left = Math.min(Math.max(left, 0), maxLeft);
  top = Math.min(Math.max(top, 0), maxTop);
  sigOverlay.style.left = left + "px";
  sigOverlay.style.top = top + "px";
}

/* ---------- Génération du PDF signé ---------- */

async function runSign() {
  hideMsg();

  if (!srcBytes || !pdfDocJs) {
    showMsg("Veuillez d'abord choisir un fichier PDF.");
    return;
  }
  if (!hasSignature) {
    showMsg("Veuillez dessiner une signature avant de signer le PDF.");
    return;
  }

  signBtn.disabled = true;
  try {
    setProgress(15, "Ouverture du PDF…");
    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(srcBytes);
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      signBtn.disabled = false;
      return;
    }

    setProgress(35, "Préparation de la signature…");
    const blob = await new Promise((resolve) => sigCanvas.toBlob(resolve, "image/png"));
    if (!blob) {
      hideProgress();
      showMsg("La signature n'a pas pu être générée. Réessayez.");
      signBtn.disabled = false;
      return;
    }
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const pngImage = await doc.embedPng(pngBytes);

    const pages = doc.getPages();
    const pageIndex = currentPageNum - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) {
      hideProgress();
      showMsg("La page choisie est introuvable dans ce PDF.");
      signBtn.disabled = false;
      return;
    }
    const targetPage = pages[pageIndex];
    const pageHeightPt = targetPage.getHeight();

    // Largeur de la page en points, telle que rendue par pdf.js à l'échelle 1
    const jsPage = await pdfDocJs.getPage(currentPageNum);
    const viewportPtWidth = jsPage.getViewport({ scale: 1 }).width;
    // On utilise la largeur CSS affichee (et non previewCanvas.width, sa resolution interne)
    // car la position/taille de la signature (sigOverlay) est exprimee en pixels CSS.
    const scale = previewCanvas.getBoundingClientRect().width / viewportPtWidth;

    const overlayLeftPx = parseFloat(sigOverlay.style.left) || 0;
    const overlayTopPx = parseFloat(sigOverlay.style.top) || 0;
    const overlayWidthPx = sigOverlay.offsetWidth;
    const overlayHeightPx = sigOverlay.offsetHeight;

    const pdfX = overlayLeftPx / scale;
    const pdfWidth = overlayWidthPx / scale;
    const pdfHeight = overlayHeightPx / scale;
    const pdfY = pageHeightPt - (overlayTopPx / scale) - pdfHeight;

    setProgress(70, "Ajout de la signature…");
    targetPage.drawImage(pngImage, { x: pdfX, y: pdfY, width: pdfWidth, height: pdfHeight });

    setProgress(90, "Génération du fichier…");
    const bytes = await doc.save();
    hideProgress();
    offerDownload(bytes, "tchadiapdf-signe.pdf");
  } catch (e) {
    hideProgress();
    showError("La signature du PDF a échoué. Réessayez avec un autre fichier.", { retry: runSign });
  } finally {
    signBtn.disabled = !hasSignature;
  }
}

signBtn.addEventListener("click", runSign);
