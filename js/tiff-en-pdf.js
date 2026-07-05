/* tchadiaPdf : TIFF en PDF */

const MAX_SIZE = 150 * 1024 * 1024; // 150 Mo (les TIFF sont souvent volumineux)
const MAX_BATCH_FILES = 20;
const A4 = { w: 595.28, h: 841.89 }; // points
// Protection contre un TIFF multi-pages "bombe" (des milliers de frames) qui gèlerait l'onglet :
// chaque frame est décodée puis rasterisée individuellement.
const MAX_FRAMES = 500;

let singleFile = null;

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
  return /image\/tiff/.test(file.type) || /\.tiff?$/i.test(file.name);
}

/** Décode un frame TIFF en PNG bytes (Uint8Array) via un canvas intermédiaire. */
function ifdToPngBytesSync(ifd) {
  UTIF.decodeImage(ifd.__buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const canvas = document.createElement("canvas");
  canvas.width = ifd.width;
  canvas.height = ifd.height;
  const ctx = canvas.getContext("2d");
  const imgData = new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height);
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** Convertit un fichier TIFF (potentiellement multi-pages) en un PDF (une page par frame). */
async function convertOneFile(file, onFrameProgress) {
  const buffer = await readAsArrayBuffer(file);

  // Validation par octets magiques ("II*\0" ou "MM\0*"), indépendante de l'extension ou du
  // type MIME déclaré par le navigateur.
  const sniffed = sniffFileType(buffer);
  if (sniffed !== "tiff") {
    throw new Error("Ce fichier ne semble pas être un TIFF valide (contenu détecté : " + sniffed + ").");
  }

  const ifds = UTIF.decode(buffer);
  if (!ifds || ifds.length === 0) throw new Error("Aucune page lisible dans ce TIFF.");

  const framesLimit = enforceLimits({ pageCount: ifds.length, maxPages: MAX_FRAMES });
  if (!framesLimit.ok) throw new Error(framesLimit.message);

  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();

  for (let i = 0; i < ifds.length; i++) {
    const ifd = ifds[i];
    ifd.__buffer = buffer;
    const canvas = ifdToPngBytesSync(ifd);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) throw new Error("Le décodage de la page " + (i + 1) + " a échoué.");
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
    const img = await doc.embedPng(pngBytes);

    const isLandscape = img.width > img.height;
    const pageW = isLandscape ? A4.h : A4.w;
    const pageH = isLandscape ? A4.w : A4.h;
    const page = doc.addPage([pageW, pageH]);

    const scale = Math.min(pageW / img.width, pageH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });

    if (onFrameProgress) onFrameProgress(i + 1, ifds.length);
  }

  return doc.save();
}

function outName(originalName) {
  return originalName.replace(/\.[^.]+$/, "") + ".pdf";
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
    showMsg("Veuillez choisir un fichier TIFF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 150 Mo. Choisissez un fichier plus léger.");
    return;
  }

  singleFile = file;
  convertBtn.disabled = false;
}

convertBtn.addEventListener("click", async () => {
  if (!singleFile) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;
  try {
    setProgress(5, "Lecture du fichier TIFF…");
    const bytes = await convertOneFile(singleFile, (page, total) => {
      setProgress(Math.round((page / total) * 95), "Page " + page + " / " + total);
    });
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, outName(singleFile.name), "application/pdf");
  } catch (e) {
    hideProgress();
    if (e && /(contenu détecté|dépasse la limite de \d+ pages)/.test(e.message || "")) {
      showMsg(e.message);
    } else {
      showMsg("La conversion a échoué. Vérifiez que le fichier est bien un TIFF valide.");
    }
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
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: file.name.replace(/\.[^.]+$/, "").replace(/[\/\\]/g, "_"),
    status: "attente",
    error: null,
    outBytes: null,
  }));

  batchQueue.forEach((entry) => {
    if (!isValidFile(entry.file)) {
      entry.status = "erreur";
      entry.error = "Ce n'est pas un fichier TIFF.";
    } else if (entry.file.size > MAX_SIZE) {
      entry.status = "erreur";
      entry.error = "Fichier trop volumineux (limite 150 Mo).";
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
      const bytes = await convertOneFile(entry.file, (page, totalPages) => {
        setProgress(
          Math.round((page / totalPages) * 100),
          "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name + ", page " + page + " / " + totalPages
        );
      });
      entry.outBytes = bytes;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      entry.error = "TIFF corrompu ou format non pris en charge.";
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
      offerDownload(only.outBytes, outName(only.file.name), "application/pdf");
    } else {
      setProgress(0, "Génération de l'archive ZIP...");
      const zip = new JSZip();
      succeeded.forEach((entry) => {
        zip.file(outName(entry.file.name), entry.outBytes);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(Math.round(meta.percent), "Génération de l'archive ZIP...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-pdfs-lot.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
