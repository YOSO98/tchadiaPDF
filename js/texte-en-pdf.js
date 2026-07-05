/* tchadiaPdf : Texte en PDF */

const MAX_SIZE = 20 * 1024 * 1024; // 20 Mo
const MAX_BATCH_FILES = 20;

const PAGE_W = 595.28; // A4 en points
const PAGE_H = 841.89;
const MARGIN = 50;
const USABLE_W = PAGE_W - MARGIN * 2;
const USABLE_H = PAGE_H - MARGIN * 2;

let currentFile = null;
let currentText = null;
let fontChoice = "sans";
let sizePt = 12;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const txtOptions = document.getElementById("txtOptions");
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

function isTxtFile(file) {
  return file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");
}

/** Lit un fichier texte, en tentant l'UTF-8. */
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Impossible de lire le fichier " + file.name));
    r.readAsText(file, "UTF-8");
  });
}

/** Remplace les caractères non pris en charge par les polices standards du PDF (encodage WinAnsi). */
function sanitizeText(text) {
  const map = {
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "…": "...", " ": " ",
  };
  let out = "";
  for (const ch of text) {
    if (map[ch] !== undefined) { out += map[ch]; continue; }
    const code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13) { out += ch; continue; }
    if (code >= 0x20 && code <= 0x7E) { out += ch; continue; }
    if (code >= 0xA0 && code <= 0xFF) { out += ch; continue; } // Latin-1 : accents français courants
    out += "?";
  }
  return out;
}

/** Découpe une ligne source en plusieurs lignes qui tiennent dans la largeur utile de la page. */
function wrapLine(line, font, size, maxWidth) {
  if (line.trim() === "") return [""];
  const words = line.split(/\s+/).filter((w) => w.length > 0);
  const lines = [];
  let current = "";

  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      // Le mot seul est trop long : on le découpe caractère par caractère.
      let chunk = "";
      for (const ch of word) {
        const t2 = chunk + ch;
        if (font.widthOfTextAtSize(t2, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = t2;
        }
      }
      current = chunk;
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Construit un PDF paginé A4 à partir d'un texte brut. */
async function buildPdfFromText(text, fontKey, size) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const fontMap = {
    sans: StandardFonts.Helvetica,
    serif: StandardFonts.TimesRoman,
    mono: StandardFonts.Courier,
  };

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(fontMap[fontKey] || StandardFonts.Helvetica);

  const clean = sanitizeText(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const sourceLines = clean.split("\n");

  const allLines = [];
  sourceLines.forEach((line) => {
    wrapLine(line, font, size, USABLE_W).forEach((l) => allLines.push(l));
  });
  if (allLines.length === 0) allLines.push("");

  const lineHeight = size * 1.4;
  const linesPerPage = Math.max(1, Math.floor(USABLE_H / lineHeight));
  const totalPages = Math.max(1, Math.ceil(allLines.length / linesPerPage));

  for (let p = 0; p < totalPages; p++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const pageLines = allLines.slice(p * linesPerPage, (p + 1) * linesPerPage);
    let y = PAGE_H - MARGIN - size;
    pageLines.forEach((line) => {
      if (line) {
        page.drawText(line, { x: MARGIN, y, size, font });
      }
      y -= lineHeight;
    });
  }

  return pdfDoc.save();
}

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

  if (!isTxtFile(file)) {
    showMsg("Veuillez choisir un fichier texte (.txt).");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 20 Mo. Choisissez un fichier plus léger.");
    return;
  }

  try {
    setProgress(20, "Lecture du fichier...");
    const text = await readAsText(file);

    currentFile = file;
    currentText = text;
    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size);
    fileInfo.classList.add("visible");
    txtOptions.style.display = "flex";
    convertBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    currentFile = null;
    currentText = null;
    convertBtn.disabled = true;
    fileInfo.classList.remove("visible");
    txtOptions.style.display = "none";
    showMsg("Impossible de lire ce fichier. Vérifiez qu'il s'agit bien d'un fichier texte valide.");
  }
}

document.querySelectorAll("#fontSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#fontSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    fontChoice = btn.dataset.f;
  });
});
document.querySelectorAll("#sizeSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#sizeSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sizePt = parseInt(btn.dataset.s, 10);
  });
});

convertBtn.addEventListener("click", async () => {
  if (currentText === null) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;

  try {
    setProgress(30, "Génération du PDF...");
    const bytes = await buildPdfFromText(currentText, fontChoice, sizePt);
    setProgress(100, "Terminé");
    hideProgress();
    const baseName = currentFile.name.replace(/\.txt$/i, "");
    offerDownload(bytes, "tchadiapdf-" + baseName + ".pdf", "application/pdf");
  } catch (e) {
    hideProgress();
    showMsg("La conversion a échoué. Réessayez avec un autre fichier.");
  } finally {
    convertBtn.disabled = currentText === null;
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

  currentFile = null;
  currentText = null;
  fileInfo.classList.remove("visible");
  convertBtn.disabled = true;
  convertBtn.style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    resetBatchUI();
    convertBtn.style.display = "";
    txtOptions.style.display = "none";
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: file.name.replace(/\.txt$/i, "").replace(/[\/\\]/g, "_"),
    status: "attente",
    error: null,
    bytes: null,
  }));

  batchQueue.forEach((entry) => {
    if (!isTxtFile(entry.file)) {
      entry.status = "erreur";
      entry.error = "Ce n'est pas un fichier texte.";
    } else if (entry.file.size > MAX_SIZE) {
      entry.status = "erreur";
      entry.error = "Fichier trop volumineux (limite 20 Mo).";
    }
  });

  fileListEl.style.display = "flex";
  batchActionsEl.style.display = "flex";
  txtOptions.style.display = "flex";
  startBatchBtn.disabled = false;
  pauseBatchBtn.disabled = true;
  cancelBatchBtn.disabled = false;
  renderFileList();
}

function statusLabel(entry) {
  switch (entry.status) {
    case "attente": return "En attente";
    case "encours": return "En cours...";
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
    txtOptions.style.display = "none";
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
    setProgress(0, "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name);

    try {
      const text = await readAsText(entry.file);
      const bytes = await buildPdfFromText(text, fontChoice, sizePt);
      entry.bytes = bytes;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      entry.error = "Lecture ou conversion impossible.";
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
    txtOptions.style.display = "none";
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
      offerDownload(only.bytes, "tchadiapdf-" + only.baseName + ".pdf", "application/pdf");
    } else {
      setProgress(0, "Génération de l'archive ZIP du lot...");
      const zip = new JSZip();
      succeeded.forEach((entry) => {
        zip.file(entry.baseName + ".pdf", entry.bytes);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(Math.round(meta.percent), "Génération de l'archive ZIP du lot...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-textes.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
