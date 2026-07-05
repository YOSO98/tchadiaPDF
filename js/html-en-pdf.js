/* tchadiaPdf : HTML en PDF */

const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo
const MAX_BATCH_FILES = 20;

// Géométrie de page A4 (points PDF et pixels équivalents à 96 DPI)
const A4 = { w: 595.28, h: 841.89 };
const PX_PER_PT = 96 / 72;
const PAGE_W_PX = Math.round(A4.w * PX_PER_PT);
const PAGE_H_PX = Math.round(A4.h * PX_PER_PT);
const MARGIN_PX = 30;
const CONTENT_W_PX = PAGE_W_PX - MARGIN_PX * 2;
const CONTENT_H_PX = PAGE_H_PX - MARGIN_PX * 2;

let singleFile = null;

const htmlInput = document.getElementById("htmlInput");
const renderFrame = document.getElementById("renderFrame");
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
  return /\.html?$/i.test(file.name) || /text\/html/.test(file.type);
}

/** Charge le HTML fourni dans l'iframe sandboxée (allow-same-origin uniquement, jamais allow-scripts). */
function loadHtmlIntoIframe(htmlText) {
  return new Promise((resolve, reject) => {
    renderFrame.onload = () => resolve();
    renderFrame.onerror = () => reject(new Error("Impossible de charger ce document HTML."));
    renderFrame.srcdoc = htmlText;
  });
}

/** Découpe les enfants directs d'un conteneur (potentiellement dans un autre document) en pages. */
function splitIntoPages(container) {
  const children = Array.from(container.children);
  const pages = [];
  let current = [];
  let currentHeight = 0;

  children.forEach((child) => {
    const rect = child.getBoundingClientRect();
    const style = getComputedStyle(child);
    const h = rect.height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);

    if (current.length > 0 && currentHeight + h > CONTENT_H_PX) {
      pages.push(current);
      current = [];
      currentHeight = 0;
    }
    current.push(child);
    currentHeight += h;
  });
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([]);

  return pages;
}

/** Rend chaque page (liste de noeuds appartenant à ownerDoc) en image JPEG (Uint8Array). */
async function renderPagesToJpegBytes(pages, ownerDoc, onPageProgress) {
  const host = ownerDoc.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  ownerDoc.body.appendChild(host);

  const imagesBytes = [];
  for (let i = 0; i < pages.length; i++) {
    const pageDiv = ownerDoc.createElement("div");
    pageDiv.style.width = PAGE_W_PX + "px";
    pageDiv.style.height = PAGE_H_PX + "px";
    pageDiv.style.padding = MARGIN_PX + "px";
    pageDiv.style.boxSizing = "border-box";
    pageDiv.style.background = "#FFFFFF";
    pageDiv.style.overflow = "hidden";
    pages[i].forEach((node) => pageDiv.appendChild(node));
    host.appendChild(pageDiv);

    const canvas = await html2canvas(pageDiv, { scale: 2, backgroundColor: "#FFFFFF" });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    imagesBytes.push(new Uint8Array(await blob.arrayBuffer()));
    host.removeChild(pageDiv);

    if (onPageProgress) onPageProgress(i + 1, pages.length);
  }

  ownerDoc.body.removeChild(host);
  return imagesBytes;
}

async function imagesToPdf(imagesBytes) {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  for (const bytes of imagesBytes) {
    const img = await doc.embedJpg(bytes);
    const page = doc.addPage([A4.w, A4.h]);
    page.drawImage(img, { x: 0, y: 0, width: A4.w, height: A4.h });
  }
  return doc.save();
}

async function waitForLayoutStable() {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** Convertit un texte HTML en octets PDF, via l'iframe sandboxée (aucun script exécuté). */
async function htmlToPdfBytes(htmlText, onPageProgress) {
  await loadHtmlIntoIframe(htmlText);
  const idoc = renderFrame.contentDocument;
  if (!idoc || !idoc.body) throw new Error("Document HTML invalide ou vide.");

  idoc.body.style.margin = "0";
  idoc.body.style.width = CONTENT_W_PX + "px";
  idoc.body.style.boxSizing = "border-box";

  await waitForLayoutStable();

  const pages = splitIntoPages(idoc.body);
  const imagesBytes = await renderPagesToJpegBytes(pages, idoc, onPageProgress);
  return imagesToPdf(imagesBytes);
}

function outName(originalName) {
  return originalName.replace(/\.[^.]+$/, "") + ".pdf";
}

/* ---------- Import de fichiers ---------- */

initDropzone("dropzone", "fileInput", async (newFiles) => {
  if (newFiles.length > 1) {
    setupBatch(newFiles);
  } else {
    await setupSingleFile(newFiles);
  }
});

async function setupSingleFile(newFiles) {
  resetBatchUI();
  htmlInput.style.display = "";
  hideMsg();
  resultEl.classList.remove("visible");

  const file = newFiles[0];
  if (!isValidFile(file)) {
    showMsg("Veuillez choisir un fichier HTML (.html ou .htm).");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 10 Mo. Choisissez un fichier plus léger.");
    return;
  }

  const text = await file.text();
  singleFile = file;
  htmlInput.value = text;
}

convertBtn.addEventListener("click", async () => {
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;
  try {
    if (!htmlInput.value.trim()) {
      showMsg("Collez du code HTML ou importez un fichier avant de convertir.");
      convertBtn.disabled = false;
      return;
    }
    setProgress(5, "Préparation du document…");
    const bytes = await htmlToPdfBytes(htmlInput.value, (page, total) => {
      setProgress(5 + Math.round((page / total) * 90), "Page " + page + " / " + total);
    });
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, singleFile ? outName(singleFile.name) : "tchadiapdf-page.pdf", "application/pdf");
  } catch (e) {
    hideProgress();
    showMsg("La conversion a échoué. Vérifiez que le code HTML est valide.");
  } finally {
    convertBtn.disabled = false;
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
  htmlInput.style.display = "none";
  convertBtn.style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    resetBatchUI();
    convertBtn.style.display = "";
    htmlInput.style.display = "";
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
      entry.error = "Ce n'est pas un fichier HTML.";
    } else if (entry.file.size > MAX_SIZE) {
      entry.status = "erreur";
      entry.error = "Fichier trop volumineux (limite 10 Mo).";
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
    htmlInput.style.display = "";
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
      const text = await entry.file.text();
      const bytes = await htmlToPdfBytes(text, (page, totalPages) => {
        setProgress(
          Math.round((page / totalPages) * 100),
          "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name + ", page " + page + " / " + totalPages
        );
      });
      entry.outBytes = bytes;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      entry.error = "Impossible de convertir ce fichier.";
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
    htmlInput.style.display = "";
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
