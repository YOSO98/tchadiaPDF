/* tchadiaPdf : SVG en PNG */

const MAX_SIZE = 15 * 1024 * 1024; // 15 Mo
const MAX_BATCH_FILES = 20;
const DEFAULT_W = 800;
const DEFAULT_H = 600;

let resScale = 2;
let singleFile = null;

const pngOptions = document.getElementById("pngOptions");
const convertBtn = document.getElementById("convertBtn");
const resultEl = document.getElementById("result");

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

function isValidFile(file) {
  return /image\/svg\+xml/.test(file.type) || /\.svg$/i.test(file.name);
}

document.querySelectorAll("#resSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#resSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    resScale = parseFloat(btn.dataset.r);
  });
});

/** Encode une chaîne SVG en data URL base64, avec gestion correcte de l'UTF-8. */
function svgTextToDataUrl(svgText) {
  const bytes = new TextEncoder().encode(svgText);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return "data:image/svg+xml;base64," + btoa(binary);
}

/** Détermine la taille intrinsèque du SVG (attributs width/height ou viewBox, sinon valeurs par défaut). */
function getSvgIntrinsicSize(svgText) {
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (svgEl.nodeName === "parsererror" || !svgEl) return { w: DEFAULT_W, h: DEFAULT_H };
    let w = parseFloat(svgEl.getAttribute("width"));
    let h = parseFloat(svgEl.getAttribute("height"));
    if (!w || !h) {
      const vb = svgEl.getAttribute("viewBox");
      if (vb) {
        const parts = vb.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) { w = parts[2]; h = parts[3]; }
      }
    }
    if (!w || !h || isNaN(w) || isNaN(h)) return { w: DEFAULT_W, h: DEFAULT_H };
    return { w, h };
  } catch (e) {
    return { w: DEFAULT_W, h: DEFAULT_H };
  }
}

/** Charge un SVG (texte) dans une image et la dessine dans un canvas à la résolution demandée. */
async function svgToCanvas(svgText, scale) {
  const { w, h } = getSvgIntrinsicSize(svgText);
  const dataUrl = svgTextToDataUrl(svgText);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("SVG invalide ou corrompu."));
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function convertOneFile(file) {
  const svgText = await file.text();
  const canvas = await svgToCanvas(svgText, resScale);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("La conversion a échoué.");
  return blob;
}

function outName(originalName) {
  return originalName.replace(/\.[^.]+$/, "") + ".png";
}

initDropzone("dropzone", "fileInput", (newFiles) => {
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
  if (!isValidFile(file)) {
    showMsg("Veuillez choisir un fichier SVG.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 15 Mo. Choisissez un SVG plus léger.");
    return;
  }

  singleFile = file;
  pngOptions.style.display = "flex";
  convertBtn.disabled = false;
}

convertBtn.addEventListener("click", async () => {
  if (!singleFile) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;
  try {
    setProgress(30, "Conversion en cours…");
    const blob = await convertOneFile(singleFile);
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(blob, outName(singleFile.name), "image/png");
  } catch (e) {
    hideProgress();
    showMsg("La conversion a échoué. Vérifiez que le fichier est bien un SVG valide.");
  } finally {
    convertBtn.disabled = !singleFile;
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

  singleFile = null;
  convertBtn.disabled = true;
  convertBtn.style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    resetBatchUI();
    convertBtn.style.display = "";
    pngOptions.style.display = "none";
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: file.name.replace(/\.[^.]+$/, "").replace(/[\/\\]/g, "_"),
    status: "attente",
    error: null,
    outBlob: null,
  }));

  batchQueue.forEach((entry) => {
    if (!isValidFile(entry.file)) {
      entry.status = "erreur";
      entry.error = "Ce n'est pas un fichier SVG.";
    } else if (entry.file.size > MAX_SIZE) {
      entry.status = "erreur";
      entry.error = "Fichier trop volumineux (limite 15 Mo).";
    }
  });

  fileListEl.style.display = "flex";
  batchActionsEl.style.display = "flex";
  pngOptions.style.display = "flex";
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
    pngOptions.style.display = "none";
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
    setProgress(Math.round((idx / total) * 100), "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name);

    try {
      const blob = await convertOneFile(entry.file);
      entry.outBlob = blob;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      entry.error = "SVG corrompu ou format non pris en charge.";
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
    pngOptions.style.display = "none";
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
      offerDownload(only.outBlob, outName(only.file.name), "image/png");
    } else {
      setProgress(0, "Génération de l'archive ZIP...");
      const zip = new JSZip();
      succeeded.forEach((entry) => {
        zip.file(outName(entry.file.name), entry.outBlob);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(Math.round(meta.percent), "Génération de l'archive ZIP...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-images-lot.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
