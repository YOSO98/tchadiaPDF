/* tchadiaPdf : PDF en Excel (détection de tableaux et export XLSX multi-feuilles) */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const MAX_BATCH_FILES = 20;

let srcBytes = null;
let currentFile = null;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const convertBtn = document.getElementById("convertBtn");
const resultEl = document.getElementById("result");
const excelPreview = document.getElementById("excelPreview");
const previewSheets = document.getElementById("previewSheets");

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

/* ===================== Regroupement du texte en lignes et colonnes ===================== */

/** Regroupe les items pdf.js getTextContent() en lignes, par position de baseline. */
function buildLines(items) {
  const rawLines = [];
  for (const item of items) {
    if (!item.str) continue;
    const y = item.transform[5];
    let line = rawLines.find((l) => Math.abs(l.y - y) < 2.5);
    if (!line) { line = { y, items: [] }; rawLines.push(line); }
    line.items.push(item);
  }
  rawLines.sort((a, b) => b.y - a.y);
  return rawLines.map((rl) => {
    rl.items.sort((a, b) => a.transform[4] - b.transform[4]);
    const fontSize = Math.max.apply(null, rl.items.map((it) => Math.abs(it.transform[3]) || it.height || 10));
    let text = "";
    let prevEndX = null;
    for (const it of rl.items) {
      const x0 = it.transform[4];
      const w = typeof it.width === "number" ? it.width : (Math.abs(it.transform[3]) || 10) * it.str.length * 0.5;
      if (prevEndX !== null && x0 - prevEndX > fontSize * 0.25 && !/\s$/.test(text) && !/^\s/.test(it.str)) {
        text += " ";
      }
      text += it.str;
      prevEndX = x0 + w;
    }
    return { y: rl.y, x: rl.items[0].transform[4], fontSize, text, items: rl.items };
  });
}

/**
 * Regroupe les items d'une ligne en cellules séparées par un grand espace horizontal (rupture de colonne).
 * Attention : pdf.js insère parfois un item "espace" invisible dont la largeur couvre tout l'écart
 * entre deux mots éloignés (pour que la simple concaténation des .str reste lisible). Un tel espace
 * ferait croire à tort que les deux mots se suivent sans rupture si on ne le traitait pas à part :
 * on le détecte donc explicitement comme séparateur de colonne plutôt que de l'inclure dans une cellule.
 */
function splitLineIntoRawCells(line) {
  const gapThreshold = Math.max(9, line.fontSize * 1.6);
  const cells = [];
  let current = null;
  let prevEndX = null;
  for (const it of line.items) {
    const x0 = it.transform[4];
    const w = typeof it.width === "number" ? it.width : (Math.abs(it.transform[3]) || 10) * it.str.length * 0.5;
    const isWideFillerSpace = !it.str.trim() && w > line.fontSize * 1.2;
    if (isWideFillerSpace) {
      if (current) { cells.push(current); current = null; }
      prevEndX = x0 + w;
      continue;
    }
    if (prevEndX !== null && x0 - prevEndX > gapThreshold) {
      if (current) cells.push(current);
      current = { x: x0, text: it.str };
    } else if (!current) {
      current = { x: x0, text: it.str };
    } else {
      current.text += (prevEndX !== null && x0 - prevEndX > line.fontSize * 0.2 ? " " : "") + it.str;
    }
    prevEndX = x0 + w;
  }
  if (current) cells.push(current);
  return cells;
}

/** Détecte des positions de colonnes récurrentes sur au moins 60% des lignes non vides d'une page. */
function detectColumnBoundaries(lines) {
  const withCells = lines.map((l) => ({ line: l, cells: splitLineIntoRawCells(l) })).filter((e) => e.line.text.trim());
  if (withCells.length < 3) return null;
  const tol = 7;
  const clusters = [];
  withCells.forEach(({ cells }) => {
    cells.forEach((c) => {
      let cl = clusters.find((k) => Math.abs(k.center - c.x) < tol);
      if (!cl) { cl = { xs: [] }; clusters.push(cl); }
      cl.xs.push(c.x);
      cl.center = cl.xs.reduce((a, b) => a + b, 0) / cl.xs.length;
    });
  });
  const total = withCells.length;
  const good = clusters
    .map((c) => ({ center: c.center, count: c.xs.length }))
    .filter((c) => c.count / total >= 0.6)
    .sort((a, b) => a.center - b.center)
    .map((c) => c.center);
  return good.length >= 2 ? good : null;
}

function splitLineByBoundaries(line, boundaries) {
  const cells = splitLineIntoRawCells(line);
  const out = boundaries.map(() => "");
  cells.forEach((c) => {
    let colIdx = 0;
    for (let i = 0; i < boundaries.length; i++) {
      if (c.x >= boundaries[i] - 10) colIdx = i;
    }
    out[colIdx] = (out[colIdx] ? out[colIdx] + " " : "") + c.text.trim();
  });
  return out.map((s) => s.trim());
}

/** Construit la matrice (tableau de tableaux) d'une page : structure en colonnes si détectée, sinon une seule colonne. */
function buildAoaForPage(lines) {
  const nonEmpty = lines.filter((l) => l.text.trim());
  if (nonEmpty.length === 0) return { aoa: [[""]], isTable: false };

  const boundaries = detectColumnBoundaries(lines);
  if (!boundaries) {
    return { aoa: nonEmpty.map((l) => [l.text.trim()]), isTable: false };
  }

  const aoa = nonEmpty.map((l) => splitLineByBoundaries(l, boundaries));
  return { aoa, isTable: true };
}

/* ===================== Construction du classeur XLSX ===================== */

function sanitizeSheetName(name) {
  return name.replace(/[:\\/?*\[\]]/g, " ").slice(0, 31) || "Feuille";
}

async function buildWorkbookFromPdf(bytes, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const numPages = pdf.numPages;
  const sheets = [];

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = buildLines(content.items);
    const { aoa, isTable } = buildAoaForPage(lines);
    sheets.push({ name: "Page " + p, aoa, isTable });
    if (onProgress) onProgress(p, numPages, "Analyse de la page " + p + " / " + numPages);
  }

  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(s.name));
  });
  const wbout = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return { blob, sheets };
}

/* ===================== Aperçu HTML avant téléchargement ===================== */

function renderPreview(sheets) {
  previewSheets.innerHTML = "";
  sheets.forEach((s) => {
    const wrap = document.createElement("div");
    wrap.className = "preview-sheet";

    const h3 = document.createElement("h3");
    h3.textContent = s.name + " ";
    const kind = document.createElement("span");
    kind.className = "sheet-kind";
    kind.textContent = s.isTable ? "(tableau détecté)" : "(colonne unique, aucun tableau détecté)";
    h3.appendChild(kind);
    wrap.appendChild(h3);

    const scroll = document.createElement("div");
    scroll.className = "preview-scroll";
    const table = document.createElement("table");
    s.aoa.slice(0, 200).forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => {
        const td = document.createElement("td");
        td.textContent = cell === undefined || cell === null ? "" : String(cell);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    previewSheets.appendChild(wrap);
  });
  excelPreview.classList.add("visible");
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
  excelPreview.classList.remove("visible");
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
  excelPreview.classList.remove("visible");
  convertBtn.disabled = true;

  try {
    setProgress(0, "Ouverture du PDF…");
    const { blob, sheets } = await buildWorkbookFromPdf(srcBytes, (i, total, label) => {
      setProgress(Math.round((i / total) * 90), label);
    });
    setProgress(95, "Préparation de l'aperçu…");
    renderPreview(sheets);
    hideProgress();
    const baseName = (currentFile ? currentFile.name.replace(/\.pdf$/i, "") : "tableaux").replace(/[\/\\]/g, "_");
    offerDownload(blob, "tchadiapdf-" + baseName + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    excelPreview.scrollIntoView({ behavior: "smooth", block: "center" });
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
  excelPreview.classList.remove("visible");
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
  excelPreview.classList.remove("visible");
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
      const { blob } = await buildWorkbookFromPdf(bytes, (i, totalSteps, label) => {
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
      offerDownload(only.blob, "tchadiapdf-" + only.baseName + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } else {
      setProgress(0, "Génération de l'archive ZIP du lot...");
      const zip = new JSZip();
      succeeded.forEach((entry) => {
        zip.file(entry.baseName + ".xlsx", entry.blob);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(Math.round(meta.percent), "Génération de l'archive ZIP du lot...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-tableaux-excel-lot.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
