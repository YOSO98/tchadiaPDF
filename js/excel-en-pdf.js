/* tchadiaPdf : Excel en PDF */

const MAX_SIZE = 25 * 1024 * 1024; // 25 Mo
const MAX_BATCH_FILES = 20;
const PAD_PX = 60; // marges hors écran

let currentFile = null;
let orientation = "portrait";
let fitToWidth = true;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const xlsOptions = document.getElementById("xlsOptions");
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

function isSpreadsheetFile(file) {
  const n = file.name.toLowerCase();
  return (
    n.endsWith(".xlsx") ||
    n.endsWith(".xls") ||
    n.endsWith(".csv") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "text/csv"
  );
}

/** Dimensions de rendu (px, 96dpi) et du PDF (pt, A4) selon l'orientation. */
function getPageDims(orient) {
  if (orient === "paysage") {
    return { pagePxW: 1123, pagePxH: 794, pdfW: 841.89, pdfH: 595.28 };
  }
  return { pagePxW: 794, pagePxH: 1123, pdfW: 595.28, pdfH: 841.89 };
}

/** Construit un <table> HTML à partir d'une feuille SheetJS. */
function buildSheetTable(sheet, fit) {
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");

  json.forEach((rowArr, rIdx) => {
    const tr = document.createElement("tr");
    rowArr.forEach((cell) => {
      const cellEl = document.createElement(rIdx === 0 ? "th" : "td");
      cellEl.textContent = cell === null || cell === undefined ? "" : String(cell);
      if (!fit) cellEl.style.whiteSpace = "nowrap";
      tr.appendChild(cellEl);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  if (fit) {
    table.style.width = "100%";
    table.style.tableLayout = "auto";
  } else {
    table.style.width = "auto";
  }
  return table;
}

/** Découpe un conteneur (feuille = h2 + table) en pages, avec en-tête de tableau répété. */
function paginateContainer(container, contentH) {
  const directTables = Array.from(container.children).filter((el) => el.tagName === "TABLE");
  directTables.forEach((table) => {
    const rows = Array.from(table.rows);
    if (rows.length <= 1) return;
    const headerRow = rows[0];
    const headerHeight = headerRow.getBoundingClientRect().height;
    const dataRows = rows.slice(1);

    const chunks = [];
    let current = [];
    let currentHeight = headerHeight;
    dataRows.forEach((row) => {
      const h = row.getBoundingClientRect().height;
      if (currentHeight + h > contentH && current.length > 0) {
        chunks.push(current);
        current = [];
        currentHeight = headerHeight;
      }
      current.push(row);
      currentHeight += h;
    });
    if (current.length) chunks.push(current);
    if (chunks.length <= 1) return;

    const newTables = chunks.map((chunkRows) => {
      const newTable = document.createElement("table");
      newTable.className = table.className;
      newTable.style.cssText = table.style.cssText;
      const tbody = document.createElement("tbody");
      tbody.appendChild(headerRow.cloneNode(true));
      chunkRows.forEach((row) => tbody.appendChild(row.cloneNode(true)));
      newTable.appendChild(tbody);
      return newTable;
    });

    newTables.forEach((t) => container.insertBefore(t, table));
    container.removeChild(table);
  });

  const children = Array.from(container.children);
  const pages = [];
  let current = [];
  let currentHeight = 0;

  children.forEach((child) => {
    const h = child.getBoundingClientRect().height;
    if (currentHeight + h > contentH && current.length > 0) {
      pages.push(current);
      current = [];
      currentHeight = 0;
    }
    current.push(child);
    currentHeight += h;
  });
  if (current.length) pages.push(current);
  if (pages.length === 0) pages.push([]);

  const pageDivs = pages.map((group) => {
    const pageDiv = document.createElement("div");
    pageDiv.className = "xlsx-render";
    pageDiv.style.position = "absolute";
    pageDiv.style.left = "-9999px";
    pageDiv.style.top = "0";
    pageDiv.style.boxSizing = "border-box";
    pageDiv.style.padding = PAD_PX + "px";
    pageDiv.style.background = "#ffffff";
    pageDiv.style.overflow = "hidden";
    document.body.appendChild(pageDiv);
    group.forEach((node) => pageDiv.appendChild(node));
    return pageDiv;
  });

  return pageDivs;
}

/** Convertit un classeur (ArrayBuffer ou texte CSV) en PDF. */
async function convertSpreadsheetToPdf(file, orient, fit, onProgress) {
  const { PDFDocument } = PDFLib;
  const dims = getPageDims(orient);
  const pagePxW = dims.pagePxW;
  const pagePxH = dims.pagePxH;
  const contentW = pagePxW - PAD_PX * 2;
  const contentH = pagePxH - PAD_PX * 2;

  const isCsv = file.name.toLowerCase().endsWith(".csv");
  let workbook;
  if (isCsv) {
    const text = await readAsText(file);
    workbook = XLSX.read(text, { type: "string" });
  } else {
    const arrayBuffer = await readAsArrayBuffer(file);
    if (!hasValidSpreadsheetSignature(arrayBuffer)) {
      throw new Error("Ce fichier ne semble pas être un classeur Excel valide.");
    }
    workbook = XLSX.read(arrayBuffer, { type: "array" });
  }

  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error("Aucune feuille trouvée dans ce fichier.");
  }

  // 1) Construit et paginer chaque feuille séparément (chaque feuille commence sur une nouvelle page).
  const allPageDivs = [];
  sheetNames.forEach((name) => {
    const container = document.createElement("div");
    container.className = "xlsx-render";
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = contentW + "px";
    document.body.appendChild(container);

    const h2 = document.createElement("h2");
    h2.textContent = name;
    container.appendChild(h2);

    const table = buildSheetTable(workbook.Sheets[name], fit);
    container.appendChild(table);

    const pageDivs = paginateContainer(container, contentH);
    pageDivs.forEach((div) => {
      div.style.width = pagePxW + "px";
      div.style.height = pagePxH + "px";
    });
    document.body.removeChild(container);
    allPageDivs.push(...pageDivs);
  });

  const pdfDoc = await PDFDocument.create();
  const total = allPageDivs.length;
  for (let i = 0; i < allPageDivs.length; i++) {
    const div = allPageDivs[i];
    const canvas = await html2canvas(div, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = await pdfDoc.embedJpg(bytes);
    const page = pdfDoc.addPage([dims.pdfW, dims.pdfH]);
    page.drawImage(img, { x: 0, y: 0, width: dims.pdfW, height: dims.pdfH });
    document.body.removeChild(div);
    if (onProgress) onProgress(i + 1, total);
  }

  return pdfDoc.save();
}

/** Vérifie la signature binaire d'un classeur (zip pour .xlsx, OLE pour l'ancien .xls). */
function hasValidSpreadsheetSignature(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  if (b.length < 4) return false;
  const isZip = b[0] === 0x50 && b[1] === 0x4b; // "PK"
  const isOle = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  return isZip || isOle;
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Impossible de lire le fichier " + file.name));
    r.readAsText(file, "UTF-8");
  });
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

  if (!isSpreadsheetFile(file)) {
    showMsg("Veuillez choisir un fichier Excel (.xlsx) ou CSV.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 25 Mo. Choisissez un fichier plus léger.");
    return;
  }

  currentFile = file;
  fileName.textContent = file.name;
  fileMeta.textContent = fmtSize(file.size);
  fileInfo.classList.add("visible");
  xlsOptions.style.display = "flex";
  convertBtn.disabled = false;
}

document.querySelectorAll("#orientSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#orientSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    orientation = btn.dataset.o;
  });
});
document.getElementById("fitWidthChk").addEventListener("change", (e) => {
  fitToWidth = e.target.checked;
});

convertBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;

  try {
    setProgress(5, "Lecture du fichier...");
    const bytes = await convertSpreadsheetToPdf(currentFile, orientation, fitToWidth, (p, total) => {
      setProgress(5 + Math.round((p / total) * 90), "Mise en page : page " + p + " / " + total);
    });
    setProgress(100, "Terminé");
    hideProgress();
    const baseName = currentFile.name.replace(/\.(xlsx|xls|csv)$/i, "");
    offerDownload(bytes, "tchadiapdf-" + baseName + ".pdf", "application/pdf");
  } catch (e) {
    hideProgress();
    showMsg("Impossible de convertir ce fichier. Vérifiez qu'il s'agit bien d'un fichier Excel (.xlsx) ou CSV valide.");
  } finally {
    convertBtn.disabled = !currentFile;
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
  fileInfo.classList.remove("visible");
  convertBtn.disabled = true;
  convertBtn.style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    resetBatchUI();
    convertBtn.style.display = "";
    xlsOptions.style.display = "none";
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: file.name.replace(/\.(xlsx|xls|csv)$/i, "").replace(/[\/\\]/g, "_"),
    status: "attente",
    error: null,
    bytes: null,
  }));

  batchQueue.forEach((entry) => {
    if (!isSpreadsheetFile(entry.file)) {
      entry.status = "erreur";
      entry.error = "Ce n'est pas un fichier Excel ou CSV.";
    } else if (entry.file.size > MAX_SIZE) {
      entry.status = "erreur";
      entry.error = "Fichier trop volumineux (limite 25 Mo).";
    }
  });

  fileListEl.style.display = "flex";
  batchActionsEl.style.display = "flex";
  xlsOptions.style.display = "flex";
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
    xlsOptions.style.display = "none";
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
      const bytes = await convertSpreadsheetToPdf(entry.file, orientation, fitToWidth, (p, totalPages) => {
        setProgress(
          Math.round((p / totalPages) * 100),
          "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name + ", page " + p + " / " + totalPages
        );
      });
      entry.bytes = bytes;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      entry.error = "Corrompu ou format non pris en charge.";
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
    xlsOptions.style.display = "none";
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
      offerDownload(zipBlob, "tchadiapdf-classeurs.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
