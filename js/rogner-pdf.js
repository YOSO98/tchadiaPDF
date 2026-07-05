/* tchadiaPdf : Rogner PDF */

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 Mo par fichier
const MAX_FILES = 50; // fichiers maximum par lot

let queue = []; // { id, file, status, message, arrayBuffer }
let nextId = 1;
let isProcessing = false;
let isPaused = false;
let cancelRequested = false;

// Référence de recadrage : dessinée une seule fois sur l'aperçu du premier fichier de la file,
// puis appliquée à tous les autres fichiers du lot, proportionnellement à leurs dimensions.
let previewCanvas = null;
let pageWidthPt = 0;
let pageHeightPt = 0;

// Sélection courante, exprimée en pixels CSS relatifs au canvas d'aperçu (pas au canvas interne).
let sel = null;
let dragStart = null;
let dragging = false;

const fileListEl = document.getElementById("fileList");
const cropPreviewHolder = document.getElementById("cropPreviewHolder");
const cropActions = document.getElementById("cropActions");
const cropWrap = document.getElementById("cropWrap");
const cropBox = document.getElementById("cropBox");
const cropBtn = document.getElementById("cropBtn");
const resetBtn = document.getElementById("resetBtn");
const pauseBtn = document.getElementById("pauseBtn");
const cancelAllBtn = document.getElementById("cancelAllBtn");
const globalProgressWrap = document.getElementById("globalProgress");
const resultEl = document.getElementById("result");
const resultTitleEl = document.getElementById("resultTitle");
const batchSummaryEl = document.getElementById("batchSummary");

previewCanvas = document.getElementById("previewCanvas");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setGlobalProgress(pct, label) {
  globalProgressWrap.classList.add("visible");
  globalProgressWrap.querySelector(".progress-bar > div").style.width = pct + "%";
  if (label) document.getElementById("globalProgressLabel").textContent = label;
}
function hideGlobalProgress() {
  globalProgressWrap.classList.remove("visible");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function statusLabel(item) {
  switch (item.status) {
    case "attente": return "En attente";
    case "encours": return "En cours…";
    case "termine": return "Terminé";
    case "erreur": return "Erreur : " + (item.message || "le recadrage a échoué");
    case "ignore": return "Ignoré" + (item.message ? " : " + item.message : "");
    default: return "";
  }
}

function renderQueue() {
  fileListEl.innerHTML = "";

  queue.forEach((item) => {
    const row = document.createElement("div");
    row.className = "file-item";
    row.dataset.id = String(item.id);

    const nameEl = document.createElement("span");
    nameEl.className = "f-name";
    nameEl.textContent = item.file.name;
    row.appendChild(nameEl);

    const metaEl = document.createElement("span");
    metaEl.className = "f-meta";
    metaEl.textContent = fmtSize(item.file.size);
    row.appendChild(metaEl);

    const statusEl = document.createElement("span");
    statusEl.className = "f-status";
    statusEl.textContent = statusLabel(item);
    row.appendChild(statusEl);

    if (item.status === "attente" || item.status === "ignore") {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "icon-btn";
      removeBtn.title = "Retirer";
      removeBtn.setAttribute("aria-label", "Retirer " + item.file.name);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        queue = queue.filter((q) => q.id !== item.id);
        renderQueue();
        maybeLoadPreview();
      });
      row.appendChild(removeBtn);
    }

    fileListEl.appendChild(row);
  });

  updateStartButton();
}

function updateStartButton() {
  const pending = queue.filter((q) => q.status === "attente").length;
  const hasSelection = !!(sel && sel.w >= 2 && sel.h >= 2);
  cropBtn.disabled = isProcessing || pending === 0 || !hasSelection;
  if (queue.length === 1 && pending === 1) {
    cropBtn.textContent = "Rogner le PDF";
  } else if (pending > 0) {
    cropBtn.textContent = "Démarrer le traitement (" + pending + " fichier" + (pending > 1 ? "s" : "") + ")";
  } else {
    cropBtn.textContent = "Rogner le PDF";
  }
}

/** Charge l'aperçu du premier fichier en attente de la file, pour y dessiner la zone de recadrage. */
async function maybeLoadPreview() {
  if (pageWidthPt > 0) return; // une référence de recadrage est déjà chargée

  const first = queue.find((q) => q.status === "attente");
  if (!first) return;

  try {
    setProgress(30, "Lecture du fichier…");
    const bytes = first.arrayBuffer || await readAsArrayBuffer(first.file);
    first.arrayBuffer = bytes;

    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    } catch (err) {
      hideProgress();
      if (err && err.name === "PasswordException") {
        showMsg("« " + first.file.name + " » est protégé par mot de passe. Retirez-le de la file ou ajoutez un autre fichier pour dessiner la zone de recadrage.");
      } else {
        showMsg("Impossible d'ouvrir « " + first.file.name + " » pour dessiner la zone de recadrage. Retirez-le de la file ou ajoutez un autre fichier.");
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
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  if (isProcessing) {
    showMsg("Le traitement est en cours. Attendez la fin ou annulez avant d'ajouter d'autres fichiers.");
    return;
  }
  hideMsg();
  resultEl.classList.remove("visible");

  // Un nouveau dépôt après un lot entièrement traité repart d'une file vide et d'une nouvelle sélection.
  const hasPending = queue.some((q) => q.status === "attente");
  if (!hasPending && queue.length > 0) {
    queue = [];
    pageWidthPt = 0;
    pageHeightPt = 0;
    cropPreviewHolder.style.display = "none";
    cropActions.style.display = "none";
    resetSelection();
  }

  const pdfFiles = newFiles.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfFiles.length < newFiles.length) {
    showMsg("Seuls les fichiers PDF sont acceptés, les autres ont été ignorés.");
  }

  const spaceLeft = Math.max(0, MAX_FILES - queue.length);
  let toAdd = pdfFiles;
  let overflow = false;
  if (toAdd.length > spaceLeft) {
    overflow = true;
    toAdd = toAdd.slice(0, spaceLeft);
  }

  toAdd.forEach((file) => {
    if (file.size > MAX_FILE_SIZE) {
      queue.push({ id: nextId++, file, status: "ignore", message: "fichier trop volumineux (100 Mo maximum)" });
    } else {
      queue.push({ id: nextId++, file, status: "attente", message: "" });
    }
  });

  if (overflow) {
    showMsg("Vous avez dépassé la limite de " + MAX_FILES + " fichiers. Les " + MAX_FILES + " premiers ont été conservés, les suivants ont été ignorés.");
  }

  renderQueue();
  await maybeLoadPreview();
});

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
  updateStartButton();
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
    updateStartButton();
  } else {
    sel = null;
    updateBoxDisplay();
    updateStartButton();
  }
}

cropWrap.addEventListener("pointerup", endDrag);
cropWrap.addEventListener("pointercancel", endDrag);

resetBtn.addEventListener("click", () => {
  hideMsg();
  resetSelection();
});

function baseNameCropped(originalName) {
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  return base + "-rogne.pdf";
}

async function finalizeResults(successResults, failureCount, total) {
  if (successResults.length === 0) {
    showMsg("Aucun fichier n'a pu être rogné. Consultez la liste ci-dessus pour le détail des erreurs.");
    return;
  }

  if (successResults.length === 1) {
    resultTitleEl.textContent = "Votre PDF rogné est prêt.";
    batchSummaryEl.style.display = "none";
    offerDownload(successResults[0].bytes, "tchadiapdf-rogne.pdf");
    return;
  }

  batchSummaryEl.style.display = "block";
  resultTitleEl.textContent = successResults.length + " fichier(s) rogné(s) avec succès sur " + total + ".";
  batchSummaryEl.textContent = failureCount > 0
    ? failureCount + " fichier(s) en échec. Consultez la liste ci-dessus pour le détail."
    : "Tous les fichiers ont été rognés sans erreur.";

  const zip = new JSZip();
  successResults.forEach((r) => {
    zip.file(baseNameCropped(r.name), r.bytes);
  });
  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  offerDownload(zipBytes, "tchadiapdf-rognes.zip", "application/zip");
}

/** Rogne un seul fichier à partir des fractions de la sélection de référence. */
async function cropOneFile(item, fr, labelPrefix) {
  const bytes = item.arrayBuffer || await readAsArrayBuffer(item.file);

  setProgress(40, labelPrefix + "Ouverture du document…");
  const { PDFDocument } = PDFLib;
  let doc;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (err) {
    const message = (err && err.message) ? err.message.toLowerCase() : "";
    if (message.indexOf("encrypt") !== -1) {
      throw new Error("PDF protégé par mot de passe");
    }
    throw new Error("fichier corrompu ou format non pris en charge");
  }

  setProgress(65, labelPrefix + "Application du recadrage…");
  const pages = doc.getPages();
  if (pages.length === 0) {
    throw new Error("le document ne contient aucune page");
  }
  const pw1 = pages[0].getWidth();
  const ph1 = pages[0].getHeight();
  const pdfX = fr.fracX * pw1;
  const pdfY = fr.fracY * ph1;
  const pdfWidth = fr.fracW * pw1;
  const pdfHeight = fr.fracH * ph1;

  pages.forEach((page) => {
    const pw = page.getWidth();
    const ph = page.getHeight();
    const x = clamp(pdfX, 0, pw);
    const y = clamp(pdfY, 0, ph);
    const w = Math.max(0, Math.min(pw, pdfX + pdfWidth) - x);
    const h = Math.max(0, Math.min(ph, pdfY + pdfHeight) - y);
    page.setCropBox(x, y, w, h);
  });

  setProgress(90, labelPrefix + "Génération du fichier…");
  return doc.save();
}

async function processQueue(fr) {
  const toProcess = queue.filter((q) => q.status === "attente");
  const total = toProcess.length;
  let doneCount = 0;
  let failureCount = 0;
  const successResults = [];

  setGlobalProgress(0, "0 / " + total + " fichier(s) traité(s)");

  for (let i = 0; i < toProcess.length; i++) {
    if (cancelRequested) break;

    while (isPaused && !cancelRequested) {
      await sleep(200);
    }
    if (cancelRequested) break;

    const item = toProcess[i];
    item.status = "encours";
    renderQueue();

    const labelPrefix = total > 1 ? "Fichier " + (i + 1) + " / " + total + " : " : "";
    setProgress(10, labelPrefix + "Lecture du fichier…");

    try {
      const outBytes = await cropOneFile(item, fr, labelPrefix);
      item.status = "termine";
      item.message = "";
      successResults.push({ name: item.file.name, bytes: outBytes });
    } catch (err) {
      item.status = "erreur";
      item.message = (err && err.message) ? err.message : "le recadrage a échoué";
      failureCount++;
    }

    if (cancelRequested) break; // annulé pendant le traitement de ce fichier : on ne remet pas l'affichage à jour

    doneCount++;
    renderQueue();
    setGlobalProgress(Math.round((doneCount / total) * 100), doneCount + " / " + total + " fichier(s) traité(s)");
  }

  hideProgress();

  if (cancelRequested) {
    hideGlobalProgress();
    return; // le bouton "Tout annuler" gère déjà le message et la réinitialisation de la file
  }

  hideGlobalProgress();
  await finalizeResults(successResults, failureCount, total);
}

cropBtn.addEventListener("click", async () => {
  if (isProcessing) return;
  hideMsg();
  resultEl.classList.remove("visible");

  if (!sel || sel.w < 2 || sel.h < 2) {
    showMsg("Veuillez sélectionner une zone à rogner sur l'aperçu avant de continuer.");
    return;
  }

  const canvasRect = previewCanvas.getBoundingClientRect();
  const ptPerPxX = pageWidthPt / canvasRect.width;
  const ptPerPxY = pageHeightPt / canvasRect.height;

  const pdfX = sel.x * ptPerPxX;
  const pdfWidth = sel.w * ptPerPxX;
  const pdfHeight = sel.h * ptPerPxY;
  const pdfY = pageHeightPt - (sel.y * ptPerPxY) - pdfHeight;

  // Fractions de la page de référence (0 à 1), pour reproduire la même zone proportionnellement
  // sur chaque fichier du lot, quelle que soit la taille de ses propres pages.
  const fr = {
    fracX: pdfX / pageWidthPt,
    fracY: pdfY / pageHeightPt,
    fracW: pdfWidth / pageWidthPt,
    fracH: pdfHeight / pageHeightPt,
  };

  isProcessing = true;
  isPaused = false;
  cancelRequested = false;
  pauseBtn.textContent = "Mettre en pause";
  pauseBtn.style.display = "inline-flex";
  cancelAllBtn.style.display = "inline-flex";
  cropBtn.disabled = true;

  await processQueue(fr);

  isProcessing = false;
  pauseBtn.style.display = "none";
  cancelAllBtn.style.display = "none";
  updateStartButton();
});

pauseBtn.addEventListener("click", () => {
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? "Reprendre" : "Mettre en pause";
  if (isPaused) {
    showMsg("Traitement en pause, il reprendra avant le prochain fichier.");
  } else {
    hideMsg();
  }
});

cancelAllBtn.addEventListener("click", () => {
  cancelRequested = true;
  isPaused = false;

  queue = [];
  pageWidthPt = 0;
  pageHeightPt = 0;
  cropPreviewHolder.style.display = "none";
  cropActions.style.display = "none";
  resetSelection();
  renderQueue();
  hideProgress();
  hideGlobalProgress();

  isProcessing = false;
  pauseBtn.style.display = "none";
  cancelAllBtn.style.display = "none";
  showMsg("Traitement annulé, la file a été réinitialisée.");
  updateStartButton();
});
