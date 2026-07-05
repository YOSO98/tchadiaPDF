/* tchadiaPdf : EPUB en PDF */

const MAX_SIZE = 40 * 1024 * 1024; // 40 Mo
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
  return /\.epub$/i.test(file.name) || /application\/epub\+zip/.test(file.type);
}

/** Charge un texte HTML déjà résolu (images/CSS en URL blob) dans l'iframe sandboxée (jamais allow-scripts). */
function loadHtmlIntoIframe(htmlText) {
  return new Promise((resolve, reject) => {
    renderFrame.onload = () => resolve();
    renderFrame.onerror = () => reject(new Error("Impossible de charger ce chapitre."));
    renderFrame.srcdoc = htmlText;
  });
}

/** Convertit un Blob en URL de données (base64), pour un rendu html2canvas fiable. */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Lecture d'image impossible."));
    reader.readAsDataURL(blob);
  });
}

function waitForImageLoad(img) {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

/**
 * Remplace les images en URL blob (générées par epub.js) par des URL de données.
 * html2canvas ne capture pas toujours de façon fiable des images en blob: à temps ;
 * les URL de données sont disponibles de façon synchrone une fois chargées.
 */
async function inlineBlobImages(idoc) {
  const imgs = Array.from(idoc.querySelectorAll('img[src^="blob:"]'));
  await Promise.all(
    imgs.map(async (img) => {
      try {
        const resp = await fetch(img.src);
        const blob = await resp.blob();
        const dataUrl = await blobToDataURL(blob);
        img.src = dataUrl;
        await waitForImageLoad(img);
      } catch (e) {
        // Si l'image ne peut pas être convertie, on la laisse telle quelle.
      }
    })
  );
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

/** Liste ordonnée des sections de contenu du livre, en excluant la page de navigation (sommaire EPUB3). */
function getContentSections(book) {
  const manifest = (book.packaging && book.packaging.manifest) || {};
  const navHrefs = new Set(
    Object.values(manifest)
      .filter((m) => m.properties && m.properties.indexOf("nav") !== -1)
      .map((m) => m.href)
  );
  let items = book.spine.spineItems.filter((item) => item.linear !== false && !navHrefs.has(item.href));
  if (items.length === 0) items = book.spine.spineItems.slice();
  return items;
}

/** Convertit un fichier EPUB en octets PDF : un groupe de pages A4 par chapitre. */
async function epubToPdfBytes(file, onProgress) {
  const buffer = await readAsArrayBuffer(file);

  let book;
  try {
    book = ePub(buffer);
    await book.ready;
  } catch (e) {
    throw new Error("Ce fichier EPUB n'a pas pu être lu. Vérifiez qu'il s'agit d'un EPUB valide et non protégé par DRM.");
  }

  const items = getContentSections(book);
  if (items.length === 0) throw new Error("Aucun chapitre lisible dans ce fichier EPUB.");

  const allImagesBytes = [];
  for (let c = 0; c < items.length; c++) {
    const section = book.spine.get(items[c].href);
    if (!section) continue;

    let htmlString;
    try {
      htmlString = await section.render(book.load.bind(book));
    } catch (e) {
      continue; // chapitre illisible : on l'ignore et on poursuit avec les suivants
    }
    if (!htmlString) continue;

    await loadHtmlIntoIframe(htmlString);
    const idoc = renderFrame.contentDocument;
    if (!idoc || !idoc.body) continue;

    idoc.body.style.margin = "0";
    idoc.body.style.width = CONTENT_W_PX + "px";
    idoc.body.style.boxSizing = "border-box";

    await inlineBlobImages(idoc);
    await waitForLayoutStable();

    const pages = splitIntoPages(idoc.body);
    const chapterImages = await renderPagesToJpegBytes(pages, idoc, (page, total) => {
      if (onProgress) onProgress(c + 1, items.length, page, total);
    });
    allImagesBytes.push(...chapterImages);

    if (section.unload) section.unload();
  }

  if (allImagesBytes.length === 0) throw new Error("Aucune page n'a pu être générée depuis ce fichier EPUB.");

  return imagesToPdf(allImagesBytes);
}

function outName(originalName) {
  return originalName.replace(/\.[^.]+$/, "") + ".pdf";
}

/* ---------- Import de fichiers ---------- */

initDropzone("dropzone", "fileInput", (newFiles) => {
  if (newFiles.length > 1) {
    setupBatch(newFiles);
  } else {
    setupSingleFile(newFiles);
  }
});

function setupSingleFile(newFiles) {
  resetBatchUI();
  convertBtn.style.display = "";
  hideMsg();
  resultEl.classList.remove("visible");

  const file = newFiles[0];
  if (!isValidFile(file)) {
    showMsg("Veuillez choisir un fichier EPUB.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 40 Mo. Choisissez un fichier plus léger.");
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
    setProgress(5, "Lecture du fichier EPUB…");
    const bytes = await epubToPdfBytes(singleFile, (chap, totalChap, page, totalPages) => {
      setProgress(
        5 + Math.round(((chap - 1 + page / totalPages) / totalChap) * 90),
        "Chapitre " + chap + " / " + totalChap + ", page " + page + " / " + totalPages
      );
    });
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, outName(singleFile.name), "application/pdf");
  } catch (e) {
    hideProgress();
    showMsg(e && e.message ? e.message : "La conversion a échoué. Vérifiez que le fichier est un EPUB valide.");
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
      entry.error = "Ce n'est pas un fichier EPUB.";
    } else if (entry.file.size > MAX_SIZE) {
      entry.status = "erreur";
      entry.error = "Fichier trop volumineux (limite 40 Mo).";
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
      const bytes = await epubToPdfBytes(entry.file, (chap, totalChap, page, totalPages) => {
        setProgress(
          Math.round(((chap - 1 + page / totalPages) / totalChap) * 100),
          "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name + ", chapitre " + chap + " / " + totalChap
        );
      });
      entry.outBytes = bytes;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      entry.error = "EPUB corrompu, protégé par DRM ou format non pris en charge.";
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
