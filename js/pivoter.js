/* tchadiaPdf : Faire pivoter PDF */

const MAX_BATCH_FILES = 50;

let srcBytes = null;
let degrees = 90;
let previewCanvas = null;

const rotateBtn = document.getElementById("rotateBtn");
const previewEl = document.getElementById("preview");
const rotOptions = document.getElementById("rotOptions");
const resultEl = document.getElementById("result");

// --- Mode lot : éléments et état ---
const fileListEl = document.getElementById("fileList");
const batchActionsEl = document.getElementById("batchActions");
const startBatchBtn = document.getElementById("startBatchBtn");
const pauseBatchBtn = document.getElementById("pauseBatchBtn");
const cancelBatchBtn = document.getElementById("cancelBatchBtn");
const globalProgressEl = document.getElementById("globalProgress");
const globalProgressLabel = document.getElementById("globalProgressLabel");

let batchQueue = [];   // [{ file, baseName, status, error, bytes }]
let batchRunning = false;
let batchPaused = false;
let batchCancelled = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  if (newFiles.length > 1) {
    setupBatch(newFiles);
  } else {
    setupSingleFile(newFiles);
  }
});

/** Mode un seul fichier : comportement identique à la version d'origine. */
async function setupSingleFile(newFiles) {
  resetBatchUI();
  rotateBtn.style.display = "";

  hideMsg();
  resultEl.classList.remove("visible");
  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  try {
    setProgress(30, "Lecture du fichier…");
    srcBytes = await readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;

    previewEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "thumb";
    wrap.style.cursor = "default";
    previewCanvas = document.createElement("canvas");
    previewCanvas.style.transition = "transform 150ms ease";
    wrap.appendChild(previewCanvas);
    const label = document.createElement("div");
    label.className = "t-num";
    label.textContent = "Aperçu, page 1";
    wrap.appendChild(label);
    previewEl.appendChild(wrap);

    await renderPdfPage(pdf, 1, previewCanvas, 180);
    applyPreviewRotation();

    rotOptions.style.display = "flex";
    rotateBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }
}

function applyPreviewRotation() {
  if (!previewCanvas) return;
  previewCanvas.style.transform = "rotate(" + degrees + "deg)";
  const scale = degrees % 180 !== 0 ? 0.75 : 1;
  previewCanvas.style.transform += " scale(" + scale + ")";
}

document.querySelectorAll("#rotSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#rotSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    degrees = parseInt(btn.dataset.deg, 10);
    applyPreviewRotation();
  });
});

/** Fait pivoter un PDF (ArrayBuffer) de "deg" degrés et renvoie les octets du fichier obtenu. */
async function rotatePdfBytes(bytes, deg) {
  const { PDFDocument, degrees: degFn } = PDFLib;
  const doc = await PDFDocument.load(bytes);
  doc.getPages().forEach((page) => {
    const current = page.getRotation().angle || 0;
    page.setRotation(degFn((current + deg) % 360));
  });
  return await doc.save();
}

rotateBtn.addEventListener("click", async () => {
  hideMsg();
  rotateBtn.disabled = true;
  try {
    setProgress(30, "Rotation des pages…");
    const bytes = await rotatePdfBytes(srcBytes, degrees);
    setProgress(85, "Génération du fichier…");
    hideProgress();
    offerDownload(bytes, "tchadiapdf-pivote.pdf");
  } catch (e) {
    hideProgress();
    showMsg("La rotation a échoué. Réessayez avec un autre fichier.");
  } finally {
    rotateBtn.disabled = false;
  }
});

/* ===================== Mode lot (jusqu'à 50 fichiers) ===================== */

function resetBatchUI() {
  batchQueue = [];
  batchRunning = false;
  batchPaused = false;
  batchCancelled = false;
  fileListEl.innerHTML = "";
  fileListEl.style.display = "none";
  batchActionsEl.style.display = "none";
  globalProgressEl.classList.remove("visible");
  startBatchBtn.disabled = false;
  pauseBatchBtn.disabled = true;
  pauseBatchBtn.textContent = "Mettre en pause";
  cancelBatchBtn.disabled = true;
}

function setupBatch(newFiles) {
  hideMsg();
  resultEl.classList.remove("visible");
  hideProgress();

  // Repasse en mode lot : on désactive proprement le mode un seul fichier.
  srcBytes = null;
  previewCanvas = null;
  previewEl.innerHTML = "";
  rotateBtn.disabled = true;
  rotateBtn.style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    resetBatchUI();
    rotateBtn.style.display = "";
    rotOptions.style.display = "none";
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: file.name.replace(/\.pdf$/i, "").replace(/[\/\\]/g, "_"),
    status: "attente",
    error: null,
    bytes: null,
  }));

  batchQueue.forEach((entry) => {
    if (!(entry.file.type === "application/pdf" || entry.file.name.toLowerCase().endsWith(".pdf"))) {
      entry.status = "erreur";
      entry.error = "Ce n'est pas un fichier PDF.";
    }
  });

  fileListEl.style.display = "flex";
  batchActionsEl.style.display = "flex";
  rotOptions.style.display = "flex";
  startBatchBtn.disabled = false;
  pauseBatchBtn.disabled = true;
  cancelBatchBtn.disabled = false;
  renderFileList();
}

function statusLabel(entry) {
  switch (entry.status) {
    case "attente": return "En attente";
    case "encours": return "En cours…";
    case "termine": return "Terminé";
    case "erreur": return "Erreur : " + (entry.error || "échec du traitement");
    default: return "";
  }
}

function renderFileList() {
  fileListEl.innerHTML = "";
  batchQueue.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "file-item";

    const name = document.createElement("span");
    name.className = "f-name";
    name.textContent = entry.file.name;

    const meta = document.createElement("span");
    meta.className = "f-meta";
    meta.textContent = fmtSize(entry.file.size);

    const status = document.createElement("span");
    status.className = "f-status";
    status.textContent = statusLabel(entry);

    div.appendChild(name);
    div.appendChild(meta);
    div.appendChild(status);
    fileListEl.appendChild(div);
  });
}

function updateGlobalProgress(done, total) {
  globalProgressEl.classList.add("visible");
  const pct = total ? Math.round((done / total) * 100) : 0;
  globalProgressEl.querySelector(".progress-bar > div").style.width = pct + "%";
  globalProgressLabel.textContent = "Fichiers traités : " + done + " / " + total;
}

startBatchBtn.addEventListener("click", () => {
  if (batchQueue.length === 0 || batchRunning) return;
  runBatchProcessing();
});

pauseBatchBtn.addEventListener("click", () => {
  if (!batchRunning) return;
  batchPaused = !batchPaused;
  pauseBatchBtn.textContent = batchPaused ? "Reprendre" : "Mettre en pause";
});

cancelBatchBtn.addEventListener("click", () => {
  batchCancelled = true;
  batchPaused = false;
  if (!batchRunning) {
    resetBatchUI();
    rotateBtn.style.display = "";
    rotOptions.style.display = "none";
    hideProgress();
  }
});

async function runBatchProcessing() {
  batchRunning = true;
  batchCancelled = false;
  batchPaused = false;
  hideMsg();
  resultEl.classList.remove("visible");
  startBatchBtn.disabled = true;
  pauseBatchBtn.disabled = false;
  pauseBatchBtn.textContent = "Mettre en pause";
  cancelBatchBtn.disabled = false;

  const total = batchQueue.length;
  let done = batchQueue.filter((e) => e.status === "termine" || e.status === "erreur").length;
  updateGlobalProgress(done, total);

  for (let idx = 0; idx < batchQueue.length; idx++) {
    const entry = batchQueue[idx];
    if (entry.status === "termine" || entry.status === "erreur") continue;

    while (batchPaused && !batchCancelled) {
      await sleep(150);
    }
    if (batchCancelled) break;

    entry.status = "encours";
    renderFileList();
    setProgress(30, "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name);

    try {
      const bytes = await readAsArrayBuffer(entry.file);
      const outBytes = await rotatePdfBytes(bytes, degrees);
      entry.bytes = outBytes;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      entry.error = "Protégé par mot de passe ou endommagé.";
    }

    done++;
    updateGlobalProgress(done, total);
    renderFileList();
  }

  hideProgress();
  batchRunning = false;
  pauseBatchBtn.disabled = true;
  pauseBatchBtn.textContent = "Mettre en pause";
  batchPaused = false;

  if (batchCancelled) {
    resetBatchUI();
    rotateBtn.style.display = "";
    rotOptions.style.display = "none";
    showMsg("Traitement annulé.");
    return;
  }

  startBatchBtn.disabled = true;
  cancelBatchBtn.disabled = true;
  await finalizeBatchResults();
}

async function finalizeBatchResults() {
  const succeeded = batchQueue.filter((e) => e.status === "termine");
  const failedCount = batchQueue.length - succeeded.length;

  if (succeeded.length === 0) {
    showMsg("Aucun fichier n'a pu être pivoté. Consultez la liste ci-dessus pour le détail des erreurs.");
    return;
  }

  try {
    if (succeeded.length === 1) {
      offerDownload(succeeded[0].bytes, "tchadiapdf-pivote.pdf");
    } else {
      setProgress(0, "Génération de l'archive ZIP du lot...");
      const zip = new JSZip();
      succeeded.forEach((entry) => {
        zip.file(entry.baseName + "-pivote.pdf", entry.bytes);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(Math.round(meta.percent), "Génération de l'archive ZIP du lot...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-pivotes-lot.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être pivotés. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
