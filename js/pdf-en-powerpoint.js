/* tchadiaPdf : PDF en PowerPoint (une diapositive image par page, texte de la page en notes) */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const MAX_BATCH_FILES = 20;
const RENDER_SCALE = 2.5; // même technique de rendu que pdf-en-jpg.js

let srcBytes = null;
let currentFile = null;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const convertBtn = document.getElementById("convertBtn");
const resultEl = document.getElementById("result");

// --- Mode lot : éléments et état ---
const fileListEl = document.getElementById("fileList");
const batchActionsEl = document.getElementById("batchActions");
const startBatchBtn = document.getElementById("startBatchBtn");
const pauseBatchBtn = document.getElementById("pauseBatchBtn");
const cancelBatchBtn = document.getElementById("cancelBatchBtn");
const globalProgressEl = document.getElementById("globalProgress");
const globalProgressLabel = document.getElementById("globalProgressLabel");

let batchQueue = [];
let batchRunning = false;
let batchPaused = false;
let batchCancelled = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Construit un PPTX : une diapositive plein cadre par page (image haute résolution), texte de la page en note. */
async function buildPptxFromPdf(bytes, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const numPages = pdf.numPages;

  // Le format des diapositives est calé sur la première page (en pouces, 72 points = 1 pouce),
  // pour que l'image remplisse exactement le cadre sans déformation sur un PDF à pages homogènes.
  const firstPage = await pdf.getPage(1);
  const vp1 = firstPage.getViewport({ scale: 1 });
  const pageWidthIn = Math.max(1, Math.min(56, vp1.width / 72));
  const pageHeightIn = Math.max(1, Math.min(56, vp1.height / 72));

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "TCHADIAPDF_PAGE", width: pageWidthIn, height: pageHeightIn });
  pptx.layout = "TCHADIAPDF_PAGE";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();

    const slide = pptx.addSlide();
    slide.addImage({ data: dataUrl, x: 0, y: 0, w: pageWidthIn, h: pageHeightIn });
    if (text) slide.addNotes(text);

    if (onProgress) onProgress(i, numPages, "Page " + i + " / " + numPages);
  }

  return await pptx.write("blob");
}

/* ===================== Mode un seul fichier ===================== */

initDropzone("dropzone", "fileInput", async (newFiles) => {
  if (newFiles.length > 1) {
    setupBatch(newFiles);
  } else {
    setupSingleFile(newFiles);
  }
});

async function setupSingleFile(newFiles) {
  resetBatchUI();
  convertBtn.style.display = "";

  hideMsg();
  resultEl.classList.remove("visible");
  const file = newFiles[0];

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 100 Mo. Choisissez un PDF plus léger.");
    return;
  }

  try {
    setProgress(10, "Lecture du fichier…");
    srcBytes = await readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;

    currentFile = file;
    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + pdf.numPages + (pdf.numPages > 1 ? " pages" : " page");
    fileInfo.classList.add("visible");
    convertBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    srcBytes = null;
    currentFile = null;
    convertBtn.disabled = true;
    fileInfo.classList.remove("visible");
    if (e && e.name === "PasswordException") {
      showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant de le convertir.");
    } else {
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
    }
  }
}

convertBtn.addEventListener("click", async () => {
  if (!srcBytes) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;

  try {
    setProgress(0, "Ouverture du PDF…");
    const blob = await buildPptxFromPdf(srcBytes, (i, total, label) => {
      setProgress(Math.round((i / total) * 100), label);
    });
    hideProgress();
    const baseName = (currentFile ? currentFile.name.replace(/\.pdf$/i, "") : "diaporama").replace(/[\/\\]/g, "_");
    offerDownload(blob, "tchadiapdf-" + baseName + ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  } catch (e) {
    hideProgress();
    showMsg("La conversion a échoué. Réessayez avec un autre fichier.");
  } finally {
    convertBtn.disabled = !srcBytes;
  }
});

/* ===================== Mode lot (jusqu'à 20 fichiers) ===================== */

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

  srcBytes = null;
  currentFile = null;
  fileInfo.classList.remove("visible");
  convertBtn.disabled = true;
  convertBtn.style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    resetBatchUI();
    convertBtn.style.display = "";
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: file.name.replace(/\.pdf$/i, "").replace(/[\/\\]/g, "_"),
    status: "attente",
    error: null,
    blob: null,
  }));

  batchQueue.forEach((entry) => {
    if (!(entry.file.type === "application/pdf" || entry.file.name.toLowerCase().endsWith(".pdf"))) {
      entry.status = "erreur";
      entry.error = "Ce n'est pas un fichier PDF.";
    } else if (entry.file.size > MAX_SIZE) {
      entry.status = "erreur";
      entry.error = "Fichier trop volumineux (limite 100 Mo).";
    }
  });

  fileListEl.style.display = "flex";
  batchActionsEl.style.display = "flex";
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
    convertBtn.style.display = "";
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

    try {
      const bytes = await readAsArrayBuffer(entry.file);
      const blob = await buildPptxFromPdf(bytes, (i, totalSteps, label) => {
        setProgress(Math.round((i / totalSteps) * 100), "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name + ", " + label);
      });
      entry.blob = blob;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      if (e && e.name === "PasswordException") {
        entry.error = "Protégé par mot de passe.";
      } else {
        entry.error = "Corrompu ou format non pris en charge.";
      }
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
    convertBtn.style.display = "";
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
    showMsg("Aucun fichier n'a pu être converti. Consultez la liste ci-dessus pour le détail des erreurs.");
    return;
  }

  try {
    if (succeeded.length === 1) {
      const only = succeeded[0];
      offerDownload(only.blob, "tchadiapdf-" + only.baseName + ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    } else {
      setProgress(0, "Génération de l'archive ZIP du lot...");
      const zip = new JSZip();
      succeeded.forEach((entry) => {
        zip.file(entry.baseName + ".pptx", entry.blob);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(Math.round(meta.percent), "Génération de l'archive ZIP du lot...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-diaporamas-lot.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
