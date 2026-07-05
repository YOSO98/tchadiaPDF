/* tchadiaPdf : Markdown en PDF */

const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo
const MAX_BATCH_FILES = 20;

// Géométrie de page A4 (points PDF et pixels équivalents à 96 DPI)
const A4 = { w: 595.28, h: 841.89 };
const PX_PER_PT = 96 / 72;
const PAGE_W_PX = Math.round(A4.w * PX_PER_PT);
const PAGE_H_PX = Math.round(A4.h * PX_PER_PT);
const MARGIN_PX = 40;
const CONTENT_W_PX = PAGE_W_PX - MARGIN_PX * 2;
const CONTENT_H_PX = PAGE_H_PX - MARGIN_PX * 2;

let singleFile = null;

const mdInput = document.getElementById("mdInput");
const mdPreview = document.getElementById("mdPreview");
const convertBtn = document.getElementById("convertBtn");
const resultEl = document.getElementById("result");

const fileListEl = document.getElementById("fileList");
const batchActionsEl = document.getElementById("batchActions");
const startBatchBtn = document.getElementById("startBatchBtn");
const pauseBatchBtn = document.getElementById("pauseBatchBtn");
const cancelBatchBtn = document.getElementById("cancelBatchBtn");
const globalProgressEl = document.getElementById("globalProgress");
const globalProgressLabel = document.getElementById("globalProgressLabel");
const editorGrid = document.getElementById("editorGrid");

let batchQueue = [];
let batchRunning = false;
let batchPaused = false;
let batchCancelled = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidFile(file) {
  return /\.md$/i.test(file.name) || /text\/(markdown|plain)/.test(file.type);
}

/* ---------- Aperçu en direct ---------- */
let previewTimer = null;
function updatePreview() {
  try {
    // Le Markdown fourni peut provenir d'un fichier importé (donc non fiable) : marked.parse()
    // ne neutralise aucun HTML brut qu'il contiendrait, on assainit systématiquement avant
    // toute insertion dans le DOM réel de la page (voir js/security-utils.js).
    mdPreview.innerHTML = sanitizeHtmlForDisplay(marked.parse(mdInput.value || ""));
  } catch (e) {
    mdPreview.innerHTML = "<p>Aperçu indisponible.</p>";
  }
}
mdInput.addEventListener("input", () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 150);
});
updatePreview();

/* ---------- Pagination générique (Markdown, HTML, EPUB) ---------- */

/** Construit un conteneur hors-écran de largeur fixe et y injecte le HTML donné (déjà assaini). */
function createMeasureContainer(innerHtml) {
  const container = document.createElement("div");
  container.className = "doc-content";
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = CONTENT_W_PX + "px";
  // Ce conteneur est bien attaché au DOM réel de la page (nécessaire pour que html2canvas
  // puisse le rasteriser), donc le HTML doit être assaini avant d'être injecté ici : un
  // Markdown importé peut contenir du HTML brut (marked.parse() ne neutralise rien).
  container.innerHTML = sanitizeHtmlForDisplay(innerHtml);
  document.body.appendChild(container);
  return container;
}

/** Découpe les enfants directs d'un conteneur en pages sans jamais couper un élément. */
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
  if (pages.length === 0) pages.push([]); // document vide : une page blanche

  return pages;
}

/** Rend chaque page (liste de noeuds) en image JPEG (Uint8Array), via html2canvas. */
async function renderPagesToJpegBytes(pages, onPageProgress) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  document.body.appendChild(host);

  const imagesBytes = [];
  for (let i = 0; i < pages.length; i++) {
    const pageDiv = document.createElement("div");
    pageDiv.className = "doc-content";
    pageDiv.style.width = PAGE_W_PX + "px";
    pageDiv.style.height = PAGE_H_PX + "px";
    pageDiv.style.padding = MARGIN_PX + "px";
    pageDiv.style.boxSizing = "border-box";
    pageDiv.style.background = "#FFFFFF";
    pageDiv.style.overflow = "hidden";
    pages[i].forEach((node) => pageDiv.appendChild(node)); // déplace le noeud (le retire de son parent d'origine)
    host.appendChild(pageDiv);

    const canvas = await html2canvas(pageDiv, { scale: 2, backgroundColor: "#FFFFFF" });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    imagesBytes.push(new Uint8Array(await blob.arrayBuffer()));
    host.removeChild(pageDiv);

    if (onPageProgress) onPageProgress(i + 1, pages.length);
  }

  document.body.removeChild(host);
  return imagesBytes;
}

/** Assemble des images de page (JPEG bytes) en un PDF A4, une image par page. */
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

/** Attend que la mise en page se stabilise (polices, images) avant de mesurer. */
async function waitForLayoutStable() {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** Convertit un texte Markdown en octets PDF. */
async function markdownToPdfBytes(mdText, onPageProgress) {
  const html = marked.parse(mdText || "");
  const container = createMeasureContainer(html);
  await waitForLayoutStable();
  const pages = splitIntoPages(container);
  const imagesBytes = await renderPagesToJpegBytes(pages, onPageProgress);
  document.body.removeChild(container);
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
  editorGrid.style.display = "grid";
  hideMsg();
  resultEl.classList.remove("visible");

  const file = newFiles[0];
  if (!isValidFile(file)) {
    showMsg("Veuillez choisir un fichier Markdown (.md).");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 10 Mo. Choisissez un fichier plus léger.");
    return;
  }

  const text = await file.text();
  singleFile = file;
  mdInput.value = text;
  updatePreview();
}

convertBtn.addEventListener("click", async () => {
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;
  try {
    setProgress(5, "Préparation du document…");
    const bytes = await markdownToPdfBytes(mdInput.value, (page, total) => {
      setProgress(5 + Math.round((page / total) * 90), "Page " + page + " / " + total);
    });
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, singleFile ? outName(singleFile.name) : "tchadiapdf-markdown.pdf", "application/pdf");
  } catch (e) {
    hideProgress();
    showMsg("La conversion a échoué. Réessayez avec un texte plus court ou vérifiez sa mise en forme.");
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
  editorGrid.style.display = "none";
  convertBtn.style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    resetBatchUI();
    convertBtn.style.display = "";
    editorGrid.style.display = "grid";
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
      entry.error = "Ce n'est pas un fichier Markdown (.md).";
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
    editorGrid.style.display = "grid";
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
      const bytes = await markdownToPdfBytes(text, (page, totalPages) => {
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
    editorGrid.style.display = "grid";
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
