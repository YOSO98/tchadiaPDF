/* tchadiaPdf : PDF en images (JPG, PNG, WebP, TIFF multi-page) */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const MAX_BATCH_FILES = 50;
// Au-delà de cette largeur ou hauteur, aucun navigateur courant ne garantit
// un canvas exploitable : on refuse plutôt que de produire une image vide.
const MAX_CANVAS_SIDE = 16384;
// Seuil (en pixels) à partir duquel une page rendue est considérée comme
// « grande » : A4 à 600 ppp fait environ 35 Mpx, A4 à 300 ppp environ 9 Mpx.
const LARGE_PAGE_PIXELS = 25e6;
// L'aperçu n'est jamais rendu au-delà de cette surface : la taille estimée
// est alors extrapolée au prorata de la surface réelle.
const PREVIEW_MAX_PIXELS = 12e6;

const FORMATS = {
  jpg: { ext: "jpg", mime: "image/jpeg", label: "JPG", lossy: true,
    hint: "JPG : photos et pages scannées, taille réduite, légère perte de qualité." },
  png: { ext: "png", mime: "image/png", label: "PNG", lossy: false,
    hint: "PNG : sans perte, idéal pour les textes nets et les schémas, fichiers plus lourds." },
  webp: { ext: "webp", mime: "image/webp", label: "WebP", lossy: true,
    hint: "WebP : pour le web, plus léger que le JPG à qualité égale." },
  tiff: { ext: "tif", mime: "image/tiff", label: "TIFF", lossy: false,
    hint: "TIFF : sans perte, toutes les pages dans un seul fichier, pour l'archivage et l'impression." },
};

let srcBytes = null;
let currentFile = null;
let currentPdf = null; // document pdf.js ouvert (mode un seul fichier)
let singleCancelled = false;

const settings = {
  format: "jpg",
  quality: 85, // en pourcentage, JPG et WebP uniquement
  ppp: 150,
  gray: false,
  pageMode: "all", // "all" ou "range"
  rangeText: "",
};

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const imgOptions = document.getElementById("imgOptions");
const convertBtn = document.getElementById("convertBtn");
const cancelBtn = document.getElementById("cancelBtn");
const resultEl = document.getElementById("result");
const resultText = document.getElementById("resultText");
const formatHint = document.getElementById("formatHint");
const qualityGroup = document.getElementById("qualityGroup");
const qualityRange = document.getElementById("qualityRange");
const qualityValue = document.getElementById("qualityValue");
const graySwitch = document.getElementById("graySwitch");
const pageRangeInput = document.getElementById("pageRange");
const previewWrap = document.getElementById("previewWrap");
const previewImg = document.getElementById("previewImg");
const previewCaption = document.getElementById("previewCaption");

// --- Mode lot : éléments et état ---
const fileListEl = document.getElementById("fileList");
const batchActionsEl = document.getElementById("batchActions");
const startBatchBtn = document.getElementById("startBatchBtn");
const pauseBatchBtn = document.getElementById("pauseBatchBtn");
const cancelBatchBtn = document.getElementById("cancelBatchBtn");
const globalProgressEl = document.getElementById("globalProgress");
const globalProgressLabel = document.getElementById("globalProgressLabel");

let batchQueue = [];   // [{ file, baseName, status, error, files }]
let batchRunning = false;
let batchPaused = false;
let batchCancelled = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseNameOf(file) {
  return file.name.replace(/\.pdf$/i, "").replace(/[\/\\]/g, "_") || "document";
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  if (newFiles.length > 1) {
    setupBatch(newFiles);
  } else {
    setupSingleFile(newFiles);
  }
});

/* ===================== Réglages ===================== */

function setSegActive(segId, btn) {
  document.querySelectorAll("#" + segId + " button").forEach((b) => {
    const active = b === btn;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function applyFormatUI() {
  const f = FORMATS[settings.format];
  formatHint.textContent = f.hint;
  qualityGroup.style.display = f.lossy ? "" : "none";
  convertBtn.textContent = "Convertir en " + f.label;
}

document.querySelectorAll("#formatSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    setSegActive("formatSeg", btn);
    settings.format = btn.dataset.f;
    applyFormatUI();
    onSettingsChanged();
  });
});

document.querySelectorAll("#resSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    setSegActive("resSeg", btn);
    settings.ppp = parseInt(btn.dataset.ppp, 10);
    onSettingsChanged();
  });
});

document.querySelectorAll("#pagesSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    setSegActive("pagesSeg", btn);
    settings.pageMode = btn.dataset.p;
    pageRangeInput.style.display = settings.pageMode === "range" ? "" : "none";
    if (settings.pageMode === "range") pageRangeInput.focus();
    onSettingsChanged();
  });
});

qualityRange.addEventListener("input", () => {
  settings.quality = parseInt(qualityRange.value, 10);
  qualityValue.textContent = String(settings.quality);
});
qualityRange.addEventListener("change", onSettingsChanged);

graySwitch.addEventListener("change", () => {
  settings.gray = graySwitch.checked;
  onSettingsChanged();
});

pageRangeInput.addEventListener("input", () => {
  settings.rangeText = pageRangeInput.value;
  onSettingsChanged();
});

// Initialise les attributs ARIA des boutons segmentés déjà actifs dans le HTML.
["formatSeg", "resSeg", "pagesSeg"].forEach((id) => {
  document.querySelectorAll("#" + id + " button").forEach((b) => {
    b.setAttribute("aria-pressed", b.classList.contains("active") ? "true" : "false");
  });
});
applyFormatUI();

/**
 * Analyse une plage de pages du type « 1-3, 5 ».
 * Retourne { pages: [...] } (triées, sans doublon) ou { error: "..." }.
 */
function parsePageRange(text, numPages) {
  const cleaned = (text || "").replace(/\s+/g, "");
  if (!cleaned) return { error: "Indiquez les pages à exporter, par exemple « 1-3, 5 »." };
  const set = new Set();
  for (const part of cleaned.split(/[,;]/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return { error: "Plage de pages invalide : « " + part + " ». Utilisez des numéros séparés par des virgules, ou des intervalles comme 2-5." };
    let a = parseInt(m[1], 10);
    let b = m[2] !== undefined ? parseInt(m[2], 10) : a;
    if (a > b) { const t = a; a = b; b = t; }
    if (a < 1 || b > numPages) {
      return { error: "La page " + (a < 1 ? a : b) + " n'existe pas : ce document compte " + numPages + (numPages > 1 ? " pages." : " page.") };
    }
    for (let p = a; p <= b; p++) set.add(p);
  }
  if (set.size === 0) return { error: "Indiquez au moins une page à exporter." };
  return { pages: Array.from(set).sort((x, y) => x - y) };
}

/** Pages à exporter selon les réglages donnés : { pages } ou { error }. */
function selectedPagesFor(numPages, opts) {
  if (opts.pageMode === "all") {
    const all = [];
    for (let i = 1; i <= numPages; i++) all.push(i);
    return { pages: all };
  }
  return parsePageRange(opts.rangeText, numPages);
}

/* ===================== Rendu et encodage ===================== */

/** Convertit un canvas RGBA rendu en niveaux de gris (luminance), sur place. */
function toGrayscale(ctx, width, height) {
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
}

/** Rend une page pdf.js dans un canvas à la résolution demandée. */
async function renderPageToCanvas(pdf, pageNum, ppp, gray) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: ppp / 72 });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) {
    const err = new Error("page trop grande");
    err.code = "TOO_LARGE";
    err.pageNum = pageNum;
    throw err;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
  if (gray) toGrayscale(ctx, width, height);
  page.cleanup();
  return canvas;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        const err = new Error("encodage impossible");
        err.code = "ENCODE_FAILED";
        reject(err);
      } else {
        resolve(blob);
      }
    }, mime, quality);
  });
}

/** Libère la mémoire d'un canvas qui ne sera plus utilisé. */
function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Extrait les pixels d'un canvas pour le TIFF : 1 octet par pixel en gris,
 * 3 octets (RVB) en couleur. Le canal alpha est ignoré (fond blanc pdf.js).
 */
function canvasToTiffSamples(canvas, gray) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const spp = gray ? 1 : 3;
  const out = new Uint8Array(w * h * spp);
  if (gray) {
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) out[j] = rgba[i];
  } else {
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      out[j] = rgba[i];
      out[j + 1] = rgba[i + 1];
      out[j + 2] = rgba[i + 2];
    }
  }
  return out;
}

const canDeflate = typeof CompressionStream === "function";

/** Compresse en zlib (compression TIFF 8, « Adobe Deflate »). */
async function deflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Assemble un TIFF multi-page (big-endian) à partir de bandes déjà encodées.
 * UTIF.encode ne gère ni la compression ni plus de quelques dizaines d'IFD
 * (tampon fixe de 20 Ko) : on réutilise ses primitives _writeIFD et _binBE
 * pour écrire nous-mêmes l'en-tête, en deux passes (la première mesure
 * l'en-tête, la seconde inscrit les offsets réels des bandes).
 * pages : [{ width, height, spp, data, compression }]
 */
function buildTiff(pages, ppp) {
  const bin = UTIF._binBE;
  const software = "tchadiaPdf (UTIF.js)";

  function makeIfds(offsets) {
    return pages.map((p, i) => ({
      "t256": [p.width],
      "t257": [p.height],
      "t258": p.spp === 1 ? [8] : [8, 8, 8],
      "t259": [p.compression],
      "t262": [p.spp === 1 ? 1 : 2],
      "t273": [offsets[i]],
      "t277": [p.spp],
      "t278": [p.height],
      "t279": [p.data.length],
      "t282": [ppp],
      "t283": [ppp],
      "t284": [1],
      "t296": [2],
      "t305": [software],
    }));
  }

  function writeHeader(ifds) {
    const data = new Uint8Array(8 + ifds.length * 512);
    data[0] = 77; data[1] = 77; data[3] = 42; // "MM\0*"
    let ifdo = 8;
    bin.writeUint(data, 4, ifdo);
    for (let i = 0; i < ifds.length; i++) {
      const noffs = UTIF._writeIFD(bin, data, ifdo, ifds[i]);
      ifdo = noffs[1];
      if (i < ifds.length - 1) bin.writeUint(data, noffs[0], ifdo);
    }
    return data.slice(0, ifdo);
  }

  const probe = writeHeader(makeIfds(pages.map(() => 0)));
  let cursor = probe.length + (probe.length & 1);
  const offsets = pages.map((p) => {
    const o = cursor;
    cursor += p.data.length + (p.data.length & 1);
    return o;
  });
  const header = writeHeader(makeIfds(offsets));

  const out = new Uint8Array(cursor);
  out.set(header, 0);
  pages.forEach((p, i) => out.set(p.data, offsets[i]));
  return out;
}

/**
 * Exporte les pages demandées d'un PDF.
 * Retourne { files: [{ name, blob }], pages: [...] }.
 * Pour TIFF : un seul fichier multi-page. Sinon : une image par page.
 */
async function exportPdf(pdf, baseName, opts, onProgress, isCancelled) {
  const sel = selectedPagesFor(pdf.numPages, opts);
  if (sel.error) {
    const err = new Error(sel.error);
    err.code = "RANGE";
    throw err;
  }
  const pages = sel.pages;
  const fmt = FORMATS[opts.format];
  const files = [];
  const tiffPages = [];

  for (let k = 0; k < pages.length; k++) {
    if (isCancelled && isCancelled()) {
      const err = new Error("annulé");
      err.code = "CANCELLED";
      throw err;
    }
    const pageNum = pages[k];
    if (onProgress) onProgress(k, pages.length, pageNum);
    const canvas = await renderPageToCanvas(pdf, pageNum, opts.ppp, opts.gray);

    if (opts.format === "tiff") {
      const width = canvas.width, height = canvas.height;
      const raw = canvasToTiffSamples(canvas, opts.gray);
      releaseCanvas(canvas);
      const data = canDeflate ? await deflateBytes(raw) : raw;
      tiffPages.push({ width, height, spp: opts.gray ? 1 : 3, data, compression: canDeflate ? 8 : 1 });
    } else {
      const blob = await canvasToBlob(canvas, fmt.mime, fmt.lossy ? opts.quality / 100 : undefined);
      releaseCanvas(canvas);
      files.push({ name: baseName + "-page-" + String(pageNum).padStart(3, "0") + "." + fmt.ext, blob });
    }
    // Laisse respirer l'interface entre deux pages (barre de progression).
    await sleep(0);
  }

  if (opts.format === "tiff") {
    const bytes = buildTiff(tiffPages, opts.ppp);
    files.push({ name: baseName + ".tif", blob: new Blob([bytes], { type: "image/tiff" }) });
  }
  if (onProgress) onProgress(pages.length, pages.length, null);
  return { files, pages };
}

/** Regroupe les fichiers produits : image directe si un seul, ZIP sinon. */
async function packageFiles(files, zipName, onZipProgress) {
  if (files.length === 1) {
    return { blob: files[0].blob, name: files[0].name, mime: files[0].blob.type };
  }
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.blob));
  const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
    if (onZipProgress) onZipProgress(meta.percent);
  });
  return { blob: zipBlob, name: zipName, mime: "application/zip" };
}

function describeResult(files, pagesCount) {
  if (files.length === 1 && FORMATS[settings.format].ext === "tif") {
    return "Votre fichier TIFF (" + pagesCount + (pagesCount > 1 ? " pages" : " page") + ") est prêt.";
  }
  if (files.length === 1) return "Votre image est prête.";
  return "Vos " + files.length + " images sont prêtes.";
}

function errorMessage(e) {
  if (!e) return "La conversion a échoué. Réessayez avec un autre fichier.";
  if (e.code === "RANGE") return e.message;
  if (e.code === "TOO_LARGE") {
    return "La page " + e.pageNum + " dépasse " + MAX_CANVAS_SIDE + " pixels de côté à " + settings.ppp + " ppp : choisissez une résolution plus faible.";
  }
  if (e.code === "ENCODE_FAILED") {
    return "Votre navigateur n'a pas pu encoder une page aussi grande (mémoire insuffisante). Réduisez la résolution ou exportez moins de pages à la fois.";
  }
  if (e.name === "PasswordException") return "Ce PDF est protégé par un mot de passe. Retirez la protection avant de le convertir.";
  return "La conversion a échoué. Réessayez avec un autre fichier.";
}

/* ===================== Mode un seul fichier ===================== */

async function setupSingleFile(newFiles) {
  resetBatchUI();
  document.getElementById("singleActions").style.display = "";

  hideMsg();
  resultEl.classList.remove("visible");
  previewWrap.classList.remove("visible");
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
    if (currentPdf) { try { currentPdf.destroy(); } catch (e) { /* déjà libéré */ } }
    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;

    currentPdf = pdf;
    currentFile = file;
    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + pdf.numPages + (pdf.numPages > 1 ? " pages" : " page");
    fileInfo.classList.add("visible");
    imgOptions.style.display = "flex";
    convertBtn.disabled = false;
    hideProgress();
    onSettingsChanged();
  } catch (e) {
    hideProgress();
    srcBytes = null;
    currentFile = null;
    currentPdf = null;
    convertBtn.disabled = true;
    fileInfo.classList.remove("visible");
    imgOptions.style.display = "none";
    showMsg(errorMessage(e));
  }
}

/** Réagit à tout changement de réglage : avertissement mémoire et aperçu. */
function onSettingsChanged() {
  if (!currentPdf) return;
  hideMsg();
  checkMemoryWarning();
  schedulePreview();
}

async function checkMemoryWarning() {
  if (settings.ppp <= 300) return;
  const page = await currentPdf.getPage(1);
  const vp = page.getViewport({ scale: settings.ppp / 72 });
  const px = Math.round(vp.width) * Math.round(vp.height);
  if (px > LARGE_PAGE_PIXELS) {
    showMsg("À " + settings.ppp + " ppp, chaque page fera environ " + Math.round(vp.width) + " × " + Math.round(vp.height) +
      " pixels (" + Math.round(px / 1e6) + " Mpx) : la conversion peut consommer beaucoup de mémoire et échouer, surtout sur mobile. Préférez 300 ppp si possible.");
  }
}

let previewTimer = null;
let previewToken = 0;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 250);
}

async function renderPreview() {
  if (!currentPdf) return;
  const token = ++previewToken;
  const pdf = currentPdf;
  const sel = selectedPagesFor(pdf.numPages, settings);
  previewWrap.classList.add("visible");
  previewCaption.textContent = "Aperçu en cours…";

  if (sel.error) {
    previewCaption.textContent = sel.error;
    return;
  }
  const firstPage = sel.pages[0];
  previewWrap.querySelector(".t-num").textContent = "Aperçu : page " + firstPage;

  try {
    const page = await pdf.getPage(firstPage);
    const fullVp = page.getViewport({ scale: settings.ppp / 72 });
    const fullW = Math.round(fullVp.width), fullH = Math.round(fullVp.height);
    const fullPx = fullW * fullH;
    // Pour les très grandes pages, on rend l'aperçu à une résolution réduite
    // et on extrapole la taille au prorata de la surface.
    const ratio = fullPx > PREVIEW_MAX_PIXELS ? Math.sqrt(PREVIEW_MAX_PIXELS / fullPx) : 1;
    const previewPpp = settings.ppp * ratio;

    const canvas = await renderPageToCanvas(pdf, firstPage, previewPpp, settings.gray);
    if (token !== previewToken) { releaseCanvas(canvas); return; }

    let sampleSize;
    let displayBlob;
    if (settings.format === "tiff") {
      const raw = canvasToTiffSamples(canvas, settings.gray);
      const data = canDeflate ? await deflateBytes(raw) : raw;
      sampleSize = data.length;
      displayBlob = await canvasToBlob(canvas, "image/png");
    } else {
      const fmt = FORMATS[settings.format];
      displayBlob = await canvasToBlob(canvas, fmt.mime, fmt.lossy ? settings.quality / 100 : undefined);
      sampleSize = displayBlob.size;
    }
    releaseCanvas(canvas);
    if (token !== previewToken) return;

    const estPage = sampleSize / (ratio * ratio);
    const estTotal = estPage * sel.pages.length;
    if (previewImg.src) URL.revokeObjectURL(previewImg.src);
    previewImg.src = URL.createObjectURL(displayBlob);
    const pagesLabel = sel.pages.length > 1 ? sel.pages.length + " pages" : "1 page";
    previewCaption.innerHTML = "";
    const line1 = document.createElement("span");
    line1.innerHTML = "<strong>" + fullW + " × " + fullH + " px</strong> par page à " + settings.ppp + " ppp" + (settings.gray ? ", niveaux de gris" : "");
    const line2 = document.createElement("span");
    line2.textContent = "Taille estimée : environ " + fmtSize(estPage) + " par page, " + fmtSize(estTotal) + " pour " + pagesLabel +
      (settings.format === "tiff" ? " (TIFF " + (canDeflate ? "Deflate" : "non compressé") + ")" : "") + ".";
    previewCaption.appendChild(line1);
    previewCaption.appendChild(document.createElement("br"));
    previewCaption.appendChild(line2);
  } catch (e) {
    if (token !== previewToken) return;
    previewCaption.textContent = e && e.code === "TOO_LARGE"
      ? "Aperçu impossible : la page dépasse " + MAX_CANVAS_SIDE + " pixels de côté à cette résolution."
      : "Aperçu indisponible pour cette page.";
  }
}

cancelBtn.addEventListener("click", () => {
  singleCancelled = true;
});

convertBtn.addEventListener("click", async () => {
  if (!currentPdf || !currentFile) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;
  singleCancelled = false;
  cancelBtn.classList.add("visible");
  const opts = Object.assign({}, settings);
  const base = baseNameOf(currentFile);

  try {
    setProgress(0, "Ouverture du PDF…");
    const { files, pages } = await exportPdf(currentPdf, base, opts, (done, total, pageNum) => {
      const pct = Math.round((done / total) * (total === 1 ? 100 : 90));
      if (pageNum !== null) setProgress(pct, "Conversion de la page " + pageNum + " (" + (done + 1) + " / " + total + ")");
    }, () => singleCancelled);

    const zipName = base + "-images-" + FORMATS[opts.format].ext + ".zip";
    const out = await packageFiles(files, zipName, (pct) => {
      setProgress(90 + Math.round(pct / 10), "Génération de l'archive ZIP…");
    });
    hideProgress();
    resultText.textContent = describeResult(files, pages.length);
    offerDownload(out.blob, out.name, out.mime);
  } catch (e) {
    hideProgress();
    if (e && e.code === "CANCELLED") {
      showMsg("Conversion annulée.");
    } else {
      showMsg(errorMessage(e));
    }
  } finally {
    cancelBtn.classList.remove("visible");
    convertBtn.disabled = !currentPdf;
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

function leaveBatchMode() {
  resetBatchUI();
  document.getElementById("singleActions").style.display = "";
  imgOptions.style.display = "none";
  hideProgress();
}

function setupBatch(newFiles) {
  hideMsg();
  resultEl.classList.remove("visible");
  previewWrap.classList.remove("visible");
  hideProgress();

  // Repasse en mode lot : on désactive proprement le mode un seul fichier.
  srcBytes = null;
  currentFile = null;
  if (currentPdf) { try { currentPdf.destroy(); } catch (e) { /* déjà libéré */ } }
  currentPdf = null;
  fileInfo.classList.remove("visible");
  convertBtn.disabled = true;
  document.getElementById("singleActions").style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    leaveBatchMode();
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: baseNameOf(file),
    status: "attente",
    error: null,
    files: null,
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
  imgOptions.style.display = "flex";
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
  if (!batchRunning) leaveBatchMode();
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
  const opts = Object.assign({}, settings);

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

    let pdf = null;
    try {
      const bytes = await readAsArrayBuffer(entry.file);
      pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const { files } = await exportPdf(pdf, entry.baseName, opts, (pageDone, pagesTotal, pageNum) => {
        if (pageNum === null) return;
        setProgress(
          Math.round((pageDone / pagesTotal) * 100),
          "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name + ", page " + pageNum + " (" + (pageDone + 1) + " / " + pagesTotal + ")"
        );
      }, () => batchCancelled);
      entry.files = files;
      entry.status = "termine";
    } catch (e) {
      if (e && e.code === "CANCELLED") {
        entry.status = "attente";
      } else {
        entry.status = "erreur";
        if (e && e.name === "PasswordException") entry.error = "Protégé par mot de passe.";
        else if (e && e.code === "RANGE") entry.error = e.message;
        else if (e && (e.code === "TOO_LARGE" || e.code === "ENCODE_FAILED")) entry.error = "Page trop grande à cette résolution.";
        else entry.error = "Corrompu ou format non pris en charge.";
      }
    } finally {
      if (pdf) { try { pdf.destroy(); } catch (e) { /* déjà libéré */ } }
    }

    if (batchCancelled) break;
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
    leaveBatchMode();
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
    const allFiles = [];
    succeeded.forEach((entry) => entry.files.forEach((f) => allFiles.push(f)));
    const zipName = succeeded.length === 1
      ? succeeded[0].baseName + "-images-" + FORMATS[settings.format].ext + ".zip"
      : "tchadiapdf-images-lot.zip";
    setProgress(0, "Génération de l'archive ZIP du lot…");
    const out = await packageFiles(allFiles, zipName, (pct) => {
      setProgress(Math.round(pct), "Génération de l'archive ZIP du lot…");
    });
    hideProgress();
    resultText.textContent = allFiles.length === 1 ? "Votre fichier est prêt." : "Vos " + allFiles.length + " fichiers sont prêts.";
    offerDownload(out.blob, out.name, out.mime);

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
