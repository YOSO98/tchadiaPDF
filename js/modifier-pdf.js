/* tchadiaPdf : Modifier PDF, éditeur complet
 *
 * Architecture : pdf.js rend la page courante dans un canvas ; un second
 * canvas transparent superposé sert de zone d'interaction pour les formes
 * (rectangle, cercle, flèche, trait, dessin libre, surlignage, masquage)
 * ET pour la sélection de mots / l'édition de ligne ; des éléments HTML
 * positionnés par-dessus servent uniquement pour les images ajoutées et
 * les champs de saisie ponctuels (texte neuf, édition de ligne), qui ont
 * besoin d'être de vrais éléments du DOM pour capter la saisie clavier.
 *
 * Modèle de texte : caractère -> mot -> ligne. Les items de
 * pdf.js getTextContent() sont regroupés en LIGNES (même ligne de base),
 * puis chaque ligne est découpée en MOTS avec la position et la largeur de
 * CHAQUE CARACTÈRE (mesurées par proportion via canvas measureText, mises
 * à l'échelle pour correspondre exactement à la largeur totale connue de
 * pdf.js). Cela permet : un clic simple sélectionne le mot sous le
 * curseur, un clic-glissé sélectionne une plage de mots, un double-clic
 * place le curseur d'édition au caractère exact cliqué.
 *
 * Toutes les modifications sont conservées en mémoire, par page, sous
 * forme de données en points PDF (pas en pixels d'écran), et ne sont
 * transformées en instructions pdf-lib qu'au moment de l'enregistrement
 * final. L'historique annuler/rétablir fonctionne par instantané de ces
 * données page par page.
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const INK = { r: 0.12, g: 0.16, b: 0.22 };
const BLUE = { r: 0.145, g: 0.388, b: 0.922 };

const LIBERATION_BASE = "https://cdn.jsdelivr.net/gh/shantigilbert/liberation-fonts-ttf@master/";
const FONT_FILES = {
  sans: { regular: "LiberationSans-Regular.ttf", bold: "LiberationSans-Bold.ttf", italic: "LiberationSans-Italic.ttf", boldItalic: "LiberationSans-BoldItalic.ttf" },
  serif: { regular: "LiberationSerif-Regular.ttf", bold: "LiberationSerif-Bold.ttf", italic: "LiberationSerif-Italic.ttf", boldItalic: "LiberationSerif-BoldItalic.ttf" },
  mono: { regular: "LiberationMono-Regular.ttf", bold: "LiberationMono-Bold.ttf", italic: "LiberationMono-Italic.ttf", boldItalic: "LiberationMono-BoldItalic.ttf" },
};

// Motifs de détection automatique dans le texte (Partie 1 de la refonte "blocs")
const DATE_PATTERNS = [
  { re: /\b(\d{2})\/(\d{2})\/(\d{4})\b/, format: "dmy", sep: "/" },
  { re: /\b(\d{2})-(\d{2})-(\d{4})\b/, format: "dmy", sep: "-" },
  { re: /\b(\d{2})\.(\d{2})\.(\d{4})\b/, format: "dmy", sep: "." },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, format: "ymd", sep: "-" },
];
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// ---------- État global ----------
let currentFile = null;
let srcBytes = null;
let pdfjsDoc = null;
let numPages = 0;
let currentPageIndex = 0;
let zoomFactor = 1;
let currentTool = "select";
let hasUnsavedChanges = false;

const pageTextCache = new Map(); // pageIndex -> { lines: [...], isOcr: bool }
const pageBlocksCache = new Map(); // pageIndex -> blocs [...] (regroupement de lignes, paresseux)
const pageImagesCache = new Map(); // pageIndex -> images détectées [...] (getOperatorList, paresseux)
const pageEditsMap = new Map(); // pageIndex -> { textEdits: [], decorations: [], annotations: [], images: [] }
const history = []; // { pageIndex, before, after }
let historyIndex = -1;

let selection = null; // { kind: 'text'|'image', pageIndex, id }
let wordSelection = null; // { lineId, startWordIdx, endWordIdx }

// ---------- Éléments DOM ----------
const fileListEl = document.getElementById("fileInfo");
const editorSection = document.getElementById("editorSection");
const pageCanvas = document.getElementById("pageCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const previewWrap = document.getElementById("previewWrap");
const thumbRail = document.getElementById("thumbRail");
const contextBar = document.getElementById("contextBar");
const saveBtn = document.getElementById("saveBtn");
const scannedBanner = document.getElementById("scannedBanner");
const scannedBannerText = document.getElementById("scannedBannerText");
const protectedBanner = document.getElementById("protectedBanner");
const imageInput = document.getElementById("imageInput");
const toolHint = document.getElementById("toolHint");

function getPageEdits(pageIndex) {
  if (!pageEditsMap.has(pageIndex)) pageEditsMap.set(pageIndex, { textEdits: [], decorations: [], annotations: [], images: [] });
  return pageEditsMap.get(pageIndex);
}
function snapshotPage(pageIndex) {
  return JSON.parse(JSON.stringify(getPageEdits(pageIndex)));
}

/** Toute modification passe par ici : historique annuler/rétablir uniforme pour tous les types d'action. */
function withHistory(pageIndex, mutateFn) {
  const before = snapshotPage(pageIndex);
  mutateFn(getPageEdits(pageIndex));
  const after = snapshotPage(pageIndex);
  history.length = historyIndex + 1;
  history.push({ pageIndex, before, after });
  historyIndex++;
  hasUnsavedChanges = true;
  updateUndoRedoButtons();
  if (pageIndex === currentPageIndex) renderOverlay();
}
function undo() {
  if (historyIndex < 0) return;
  const h = history[historyIndex];
  pageEditsMap.set(h.pageIndex, JSON.parse(JSON.stringify(h.before)));
  historyIndex--;
  updateUndoRedoButtons();
  deselect();
  if (h.pageIndex === currentPageIndex) renderOverlay();
}
function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  const h = history[historyIndex];
  pageEditsMap.set(h.pageIndex, JSON.parse(JSON.stringify(h.after)));
  updateUndoRedoButtons();
  deselect();
  if (h.pageIndex === currentPageIndex) renderOverlay();
}
function updateUndoRedoButtons() {
  document.getElementById("undoBtn").disabled = historyIndex < 0;
  document.getElementById("redoBtn").disabled = historyIndex >= history.length - 1;
}

window.addEventListener("beforeunload", (e) => {
  if (!hasUnsavedChanges) return;
  e.preventDefault();
  e.returnValue = "";
});

// ---------- Chargement du fichier ----------
initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  scannedBanner.classList.remove("visible");
  protectedBanner.classList.remove("visible");
  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo).");
    return;
  }
  currentFile = file;
  renderFileInfo();

  try {
    srcBytes = await readAsArrayBuffer(file);
    pdfjsDoc = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
    numPages = pdfjsDoc.numPages;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      protectedBanner.classList.add("visible");
      currentFile = null;
      fileListEl.style.display = "none";
      return;
    }
    showMsg("Impossible d'ouvrir ce PDF. Il est peut-être endommagé.");
    currentFile = null;
    return;
  }

  pageTextCache.clear();
  pageBlocksCache.clear();
  pageImagesCache.clear();
  pageEditsMap.clear();
  history.length = 0;
  historyIndex = -1;
  hasUnsavedChanges = false;
  updateUndoRedoButtons();
  currentPageIndex = 0;
  zoomFactor = 1;
  updateZoomLabel();

  editorSection.style.display = "block";
  saveBtn.disabled = false;
  await buildThumbnails();
  await renderCurrentPage();
});

function renderFileInfo() {
  fileListEl.style.display = "flex";
  document.getElementById("fileName").textContent = currentFile.name;
  document.getElementById("fileMeta").textContent = fmtSize(currentFile.size);
}

// ---------- Vignettes ----------
async function buildThumbnails() {
  thumbRail.innerHTML = "";
  for (let i = 0; i < numPages; i++) {
    const item = document.createElement("div");
    item.className = "thumb-item" + (i === 0 ? " active" : "");
    item.dataset.page = String(i);
    const canvas = document.createElement("canvas");
    item.appendChild(canvas);
    const label = document.createElement("span");
    label.textContent = "Page " + (i + 1);
    item.appendChild(label);
    item.addEventListener("click", () => goToPage(i));
    thumbRail.appendChild(item);
  }
  for (let i = 0; i < numPages; i++) {
    const canvas = thumbRail.children[i].querySelector("canvas");
    try {
      const page = await pdfjsDoc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const scale = 90 / vp.width;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    } catch (e) { /* vignette non critique, on continue */ }
  }
}

async function goToPage(index) {
  if (index === currentPageIndex) return;
  currentPageIndex = index;
  Array.from(thumbRail.children).forEach((el, i) => el.classList.toggle("active", i === index));
  deselect();
  await renderCurrentPage();
}

// ---------- Rendu de la page courante ----------
let currentViewport = null;
let currentPageObj = null;

async function renderCurrentPage() {
  currentPageObj = await pdfjsDoc.getPage(currentPageIndex + 1);
  const baseScale = 1.3 * zoomFactor;
  currentViewport = currentPageObj.getViewport({ scale: baseScale });
  pageCanvas.width = currentViewport.width;
  pageCanvas.height = currentViewport.height;
  overlayCanvas.width = currentViewport.width;
  overlayCanvas.height = currentViewport.height;
  await currentPageObj.render({ canvasContext: pageCanvas.getContext("2d"), viewport: currentViewport }).promise;

  if (!pageTextCache.has(currentPageIndex)) {
    const content = await currentPageObj.getTextContent();
    const lines = buildLines(content.items, content.styles);
    pageTextCache.set(currentPageIndex, { lines, isOcr: false });
  }
  updateScannedBanner();
  await ensureBlocksForPage(currentPageIndex);
  await ensureImagesForPage(currentPageIndex, currentPageObj);
  rebuildTextHitAreas();
  rebuildBlockOverlays();
  renderOverlay();

  // Détection paresseuse : uniquement page courante + voisines immédiates,
  // jamais tout le document (important pour les gros documents, ex. 100 pages).
  prefetchNeighborBlocks(currentPageIndex - 1);
  prefetchNeighborBlocks(currentPageIndex + 1);
}

function prefetchNeighborBlocks(idx) {
  if (idx < 0 || idx >= numPages) return;
  if (pageBlocksCache.has(idx) && pageImagesCache.has(idx)) return;
  (async () => {
    try {
      const page = await pdfjsDoc.getPage(idx + 1);
      if (!pageTextCache.has(idx)) {
        const content = await page.getTextContent();
        pageTextCache.set(idx, { lines: buildLines(content.items, content.styles), isOcr: false });
      }
      await ensureBlocksForPage(idx);
      await ensureImagesForPage(idx, page);
    } catch (e) { /* préchargement facultatif, on ignore les erreurs */ }
  })();
}

/** Affiche ou masque le bandeau de proposition d'OCR selon la qualité du texte détecté sur la page courante. */
function updateScannedBanner() {
  const data = pageTextCache.get(currentPageIndex);
  const quality = assessTextQuality(data ? data.lines : []);
  if (quality === "good") {
    scannedBanner.classList.remove("visible");
    return;
  }
  scannedBannerText.textContent = quality === "none"
    ? "Cette page semble scannée : aucun texte n'y a été détecté. Lancez la reconnaissance de texte (OCR) pour pouvoir la modifier, ou continuez en mode annotation seule (ajout de texte, formes, masquage)."
    : "Le texte détecté sur cette page semble de mauvaise qualité (probablement un scan). Lancez la reconnaissance de texte (OCR) pour de meilleurs résultats, ou continuez en mode annotation seule.";
  scannedBanner.classList.add("visible");
}

function assessTextQuality(lines) {
  if (!lines || !lines.length) return "none";
  let totalWords = 0, shortWords = 0, alnumChars = 0, totalChars = 0;
  for (const line of lines) {
    for (const w of line.words) {
      totalWords++;
      if (w.text.length <= 1) shortWords++;
      for (const ch of w.text) {
        totalChars++;
        if (/[a-zA-Z0-9À-ÿ]/.test(ch)) alnumChars++;
      }
    }
  }
  if (totalWords === 0) return "none";
  const shortRatio = shortWords / totalWords;
  const alnumRatio = totalChars ? alnumChars / totalChars : 0;
  if (shortRatio > 0.5 || alnumRatio < 0.5) return "poor";
  return "good";
}

document.getElementById("dismissBannerBtn").addEventListener("click", () => {
  scannedBanner.classList.remove("visible");
});

// ---------- Regroupement du texte en lignes, mots et caractères ----------
let measureCanvas = null;
function getMeasureCtx() {
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  return measureCanvas.getContext("2d");
}

/** Répartit la largeur totale connue (item.width, en points PDF) entre les caractères, au prorata de leur largeur mesurée. */
function layoutItemChars(item, fontFamily, bold, italic) {
  const text = item.str;
  const n = text.length;
  if (n === 0) return [];
  const ctx = getMeasureCtx();
  let f = "";
  if (italic) f += "italic ";
  if (bold) f += "bold ";
  f += "100px " + fontCssFamily(fontFamily);
  ctx.font = f;
  const rawWidths = [];
  let rawTotal = 0;
  for (let i = 0; i < n; i++) {
    const w = ctx.measureText(text[i]).width;
    rawWidths.push(w);
    rawTotal += w;
  }
  const targetTotal = typeof item.width === "number" && item.width > 0 ? item.width : rawTotal;
  const scale = rawTotal > 0 ? targetTotal / rawTotal : 0;
  let x = item.transform[4];
  const chars = [];
  for (let i = 0; i < n; i++) {
    const w = rawWidths[i] * scale;
    chars.push({ ch: text[i], x, width: w });
    x += w;
  }
  return chars;
}

function splitIntoWords(chars) {
  const words = [];
  let current = null;
  for (let i = 0; i < chars.length; i++) {
    const isSpace = /\s/.test(chars[i].ch);
    if (isSpace) {
      if (current) { words.push(current); current = null; }
      continue;
    }
    if (!current) current = { text: "", startIdx: i, endIdx: i, x: chars[i].x, width: 0 };
    current.text += chars[i].ch;
    current.endIdx = i + 1;
    current.width = chars[i].x + chars[i].width - current.x;
  }
  if (current) words.push(current);
  return words;
}

function buildLines(items, styles) {
  const rawLines = [];
  for (const item of items) {
    if (!item.str) continue;
    const y = item.transform[5];
    let line = rawLines.find((l) => Math.abs(l.y - y) < 2);
    if (!line) { line = { y, items: [] }; rawLines.push(line); }
    line.items.push(item);
  }
  rawLines.sort((a, b) => b.y - a.y);
  return rawLines.map((rl, idx) => {
    rl.items.sort((a, b) => a.transform[4] - b.transform[4]);
    const first = rl.items.find((it) => it.str && it.str.trim()) || rl.items[0];
    const style = styles[first.fontName] || {};
    const fontHeight = Math.max.apply(null, rl.items.map((it) => Math.abs(it.transform[3]) || it.height || 10));
    const detected = detectStyle(first.fontName, style, first.transform);
    let chars = [];
    for (const it of rl.items) chars = chars.concat(layoutItemChars(it, detected.family, detected.bold, detected.italic));
    chars.sort((a, b) => a.x - b.x);
    const words = splitIntoWords(chars);
    const x0 = chars.length ? chars[0].x : first.transform[4];
    const x1 = chars.length ? chars[chars.length - 1].x + chars[chars.length - 1].width : x0;
    return {
      id: "line" + idx + "_" + Math.round(rl.y),
      baseline: rl.y,
      x: x0,
      y: rl.y - fontHeight * 0.22,
      width: Math.max(x1 - x0, fontHeight * 0.6),
      height: fontHeight * 1.2,
      fontSize: fontHeight,
      fontFamily: detected.family,
      bold: detected.bold,
      italic: detected.italic,
      chars,
      words,
      text: chars.map((c) => c.ch).join(""),
    };
  });
}

function detectStyle(rawFontName, style, transform) {
  const name = (rawFontName || "") + " " + (style.fontFamily || "");
  const lower = name.toLowerCase();
  let family = "sans";
  if (/serif/.test(lower) && !/sans-serif/.test(lower)) family = "serif";
  if (/mono|courier|consolas/.test(lower)) family = "mono";
  if (/times|georgia|garamond|cambria/.test(lower)) family = "serif";
  const bold = /bold|black|heavy|semibold/.test(lower);
  const italic = /italic|oblique/.test(lower) || Math.abs(transform[2]) > 0.001;
  return { family, bold, italic };
}

/** Trouve l'indice du caractère le plus proche d'une abscisse PDF donnée (avec tolérance tactile). */
function charIndexAtX(line, pdfX) {
  const chars = line.chars;
  if (!chars.length) return 0;
  if (pdfX <= chars[0].x) return 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (pdfX >= c.x && pdfX < c.x + c.width) {
      return pdfX - c.x > c.width / 2 ? i + 1 : i;
    }
  }
  return chars.length;
}

function wordIndexAtCharIndex(line, charIdx) {
  if (!line.words.length) return -1;
  for (let i = 0; i < line.words.length; i++) {
    const w = line.words[i];
    if (charIdx >= w.startIdx && charIdx < w.endIdx) return i;
  }
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < line.words.length; i++) {
    const w = line.words[i];
    const dist = charIdx < w.startIdx ? w.startIdx - charIdx : charIdx - w.endIdx;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

// ---------- Regroupement des lignes en BLOCS (paragraphe / titre / sous-titre / ligne isolée) ----------
/**
 * Deux lignes consécutives ne fusionnent dans le même bloc "paragraphe" que si
 * elles ont la MÊME taille de police (tolérance ≤8%) et un interligne cohérent.
 * Une ligne de taille différente (>1.3x la taille du corps de texte de la page)
 * devient son propre bloc titre (la plus grande taille de la page) ou sous-titre ;
 * une ligne isolée de taille proche du corps de texte, mais sans voisine avec
 * laquelle fusionner (rupture d'interligne), devient une "ligne isolée".
 */
function buildBlocks(lines) {
  if (!lines.length) return [];
  const maxFont = Math.max.apply(null, lines.map((l) => l.fontSize));
  const sortedSizes = lines.map((l) => l.fontSize).sort((a, b) => a - b);
  const medianFont = sortedSizes[Math.floor(sortedSizes.length / 2)];

  const groups = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : null;
    let canMerge = false;
    if (prev && current) {
      const sizeRatio = Math.max(line.fontSize, prev.fontSize) / Math.max(0.01, Math.min(line.fontSize, prev.fontSize));
      const gap = prev.baseline - line.baseline;
      const gapOk = gap > 0 && gap < Math.max(line.fontSize, prev.fontSize) * 1.9;
      let gapConsistent = true;
      if (current.lines.length >= 2) {
        const prevGap = current.lines[current.lines.length - 2].baseline - current.lines[current.lines.length - 1].baseline;
        gapConsistent = Math.abs(gap - prevGap) < Math.max(3, prevGap * 0.35);
      }
      const boldOk = line.bold === prev.bold;
      canMerge = sizeRatio <= 1.08 && gapOk && gapConsistent && boldOk;
    }
    if (canMerge) current.lines.push(line);
    else { if (current) groups.push(current); current = { lines: [line] }; }
  }
  if (current) groups.push(current);

  return groups.map((g, idx) => finalizeBlock(g.lines, idx, maxFont, medianFont));
}

function finalizeBlock(blockLines, idx, maxFont, medianFont) {
  const x = Math.min.apply(null, blockLines.map((l) => l.x));
  const right = Math.max.apply(null, blockLines.map((l) => l.x + l.width));
  const y = Math.min.apply(null, blockLines.map((l) => l.y));
  const top = Math.max.apply(null, blockLines.map((l) => l.y + l.height));
  const fontSize = blockLines[0].fontSize;
  let type = "paragraphe";
  if (blockLines.length === 1) {
    const ratioToBody = fontSize / Math.max(0.01, medianFont);
    if (fontSize >= maxFont - 0.4 && ratioToBody > 1.3) type = "titre";
    else if (ratioToBody > 1.3) type = "sous-titre";
    else if (ratioToBody > 1.08) type = "sous-titre";
    else type = "ligne isolée";
  }
  const block = {
    id: "block" + idx + "_" + Math.round(blockLines[0].baseline),
    type,
    lines: blockLines,
    x, y, width: right - x, height: top - y,
    fontSize,
    fontFamily: blockLines[0].fontFamily,
    bold: blockLines[0].bold,
    italic: blockLines[0].italic,
    text: blockLines.map((l) => l.text).join("\n"),
  };
  block.dateMatches = collectDateMatches(block);
  block.emailMatches = collectEmailMatches(block);
  return block;
}

function collectDateMatches(block) {
  const matches = [];
  block.lines.forEach((line, lineIndex) => {
    for (const pat of DATE_PATTERNS) {
      const m = line.text.match(pat.re);
      if (m) matches.push({ lineIndex, start: m.index, end: m.index + m[0].length, raw: m[0], format: pat.format, sep: pat.sep });
    }
  });
  return matches;
}
function collectEmailMatches(block) {
  const matches = [];
  block.lines.forEach((line, lineIndex) => {
    const re = new RegExp(EMAIL_RE.source, "g");
    let m;
    while ((m = re.exec(line.text))) matches.push({ lineIndex, start: m.index, end: m.index + m[0].length, raw: m[0] });
  });
  return matches;
}
function blockTypeLabel(type) {
  if (type === "titre") return "Titre";
  if (type === "sous-titre") return "Sous-titre";
  if (type === "ligne isolée") return "Ligne isolée";
  return "Paragraphe";
}
async function ensureBlocksForPage(pageIndex) {
  if (pageBlocksCache.has(pageIndex)) return;
  const data = pageTextCache.get(pageIndex);
  pageBlocksCache.set(pageIndex, buildBlocks(data ? data.lines : []));
}

// ---------- Détection des images de la page (getOperatorList + matrice cumulée) ----------
function matMul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}
function matApply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

/** Reconstruit la position/taille de chaque image peinte sur la page en cumulant les matrices de transformation (save/restore/transform) jusqu'à chaque paintImageXObject. */
async function detectPageImagesRaw(pageObj) {
  const opList = await pageObj.getOperatorList();
  const OPS = pdfjsLib.OPS;
  const fnArray = opList.fnArray, argsArray = opList.argsArray;
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const rects = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = matMul(argsArray[i], ctm);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject) {
      const corners = [matApply(ctm, 0, 0), matApply(ctm, 1, 0), matApply(ctm, 1, 1), matApply(ctm, 0, 1)];
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      const x = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      const y = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      const w = x1 - x, h = y1 - y;
      if (w > 3 && h > 3) rects.push({ x, y, width: w, height: h, objId: (argsArray[i] || [])[0] });
    }
  }
  const merged = [];
  for (const r of rects) {
    const dup = merged.find((m) => Math.abs(m.x - r.x) < 1 && Math.abs(m.y - r.y) < 1 && Math.abs(m.width - r.width) < 1 && Math.abs(m.height - r.height) < 1);
    if (!dup) merged.push(r);
  }
  return merged;
}
async function ensureImagesForPage(pageIndex, pageObj) {
  if (pageImagesCache.has(pageIndex)) return;
  try {
    const raw = await detectPageImagesRaw(pageObj);
    pageImagesCache.set(pageIndex, raw.map((r, i) => ({ id: "detimg" + pageIndex + "_" + i, x: r.x, y: r.y, width: r.width, height: r.height, objId: r.objId })));
  } catch (e) {
    pageImagesCache.set(pageIndex, []);
  }
}

// ---------- Overlay permanent des blocs et images détectées (affichage, Partie 1) ----------
function findNearestLineInBlock(block, pdfY) {
  let best = block.lines[0], bestDist = Infinity;
  for (const l of block.lines) {
    const dist = Math.abs((l.y + l.height / 2) - pdfY);
    if (dist < bestDist) { bestDist = dist; best = l; }
  }
  return best;
}
function selectBlockVisual(block) {
  selection = { kind: "block", pageIndex: currentPageIndex, id: block.id };
  document.querySelectorAll(".block-hit").forEach((el) => el.classList.toggle("active", el.dataset.blockId === block.id));
}
function rebuildBlockOverlays() {
  previewWrap.querySelectorAll(".block-hit, .img-hit").forEach((el) => el.remove());
  const blocks = pageBlocksCache.get(currentPageIndex) || [];
  for (const block of blocks) {
    const hit = document.createElement("div");
    hit.className = "block-hit";
    hit.dataset.blockId = block.id;
    hit.dataset.blockType = block.type;
    positionOverlayEl(hit, block.x, block.y, block.width, block.height);
    let label = blockTypeLabel(block.type);
    if (block.dateMatches.length) label += " (contient une date)";
    if (block.emailMatches.length) label += " (contient un e-mail)";
    hit.title = label;
    hit.addEventListener("pointerdown", (e) => { if (currentTool === "select") selectBlockVisual(block); });
    hit.addEventListener("dblclick", (e) => {
      if (currentTool !== "select") return;
      e.preventDefault();
      const c = eventToCanvasPx(e);
      const p = canvasPxToPdf(c.x, c.y);
      const line = findNearestLineInBlock(block, p[1]);
      openLineEditor(line, charIndexAtX(line, p[0]));
    });
    if (block.dateMatches.length) hit.addEventListener("contextmenu", (e) => onBlockContextMenu(e, block));
    previewWrap.appendChild(hit);
  }
  const images = pageImagesCache.get(currentPageIndex) || [];
  for (const img of images) {
    const hit = document.createElement("div");
    hit.className = "img-hit";
    hit.title = "Image";
    positionOverlayEl(hit, img.x, img.y, img.width, img.height);
    previewWrap.appendChild(hit);
  }
}

// ---------- Menu contextuel : modifier une date détectée ----------
function onBlockContextMenu(e, block) {
  if (currentTool !== "select" || !block.dateMatches.length) return;
  e.preventDefault();
  closeDateMenu();
  const menu = document.createElement("div");
  menu.className = "date-context-menu";
  menu.id = "dateContextMenu";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Modifier cette date";
  btn.addEventListener("click", () => openDatePopup(block, block.dateMatches[0]));
  menu.appendChild(btn);
  const cssPos = canvasPxToCssPx(eventToCanvasPx(e).x, eventToCanvasPx(e).y);
  menu.style.left = cssPos.x + "px";
  menu.style.top = cssPos.y + "px";
  previewWrap.appendChild(menu);
  setTimeout(() => document.addEventListener("pointerdown", closeDateMenuOnce), 0);
}
function closeDateMenuOnce(e) {
  if (e.target.closest && e.target.closest("#dateContextMenu")) return;
  closeDateMenu();
}
function closeDateMenu() {
  const el = document.getElementById("dateContextMenu");
  if (el) el.remove();
  document.removeEventListener("pointerdown", closeDateMenuOnce);
}
function openDatePopup(block, match) {
  closeDateMenu();
  closeDatePopup();
  const line = block.lines[match.lineIndex];
  const popup = document.createElement("div");
  popup.className = "date-edit-popup";
  popup.id = "datePopup";
  const input = document.createElement("input");
  input.type = "date";
  input.value = isoFromMatch(match);
  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.textContent = "Valider";
  okBtn.className = "btn-primary";
  okBtn.addEventListener("click", () => {
    const iso = input.value;
    if (iso) {
      const newRaw = reformatDateLikeOriginal(iso, match);
      const newLineText = line.text.slice(0, match.start) + newRaw + line.text.slice(match.end);
      const existing = getPageEdits(currentPageIndex).textEdits.find((t) => t.lineId === line.id);
      const data = existing || { text: line.text, fontSize: line.fontSize, fontFamily: line.fontFamily, bold: line.bold, italic: line.italic, color: INK };
      commitLineEdit(currentPageIndex, line, data, newLineText, false);
    }
    closeDatePopup();
  });
  popup.appendChild(input);
  popup.appendChild(okBtn);
  positionOverlayEl(popup, block.x, block.y - 6, Math.max(block.width, 40), 10);
  popup.style.width = "auto";
  popup.style.height = "auto";
  previewWrap.appendChild(popup);
}
function closeDatePopup() {
  const el = document.getElementById("datePopup");
  if (el) el.remove();
}
function isoFromMatch(match) {
  const parts = match.format === "ymd" ? match.raw.split(match.sep) : match.raw.split(match.sep).reverse();
  return parts[0] + "-" + parts[1] + "-" + parts[2];
}
function reformatDateLikeOriginal(isoValue, match) {
  const bits = isoValue.split("-");
  const Y = bits[0], M = bits[1], D = bits[2];
  if (match.format === "ymd") return Y + match.sep + M + match.sep + D;
  return D + match.sep + M + match.sep + Y;
}

// ---------- Conversion de coordonnées (PDF <-> pixels du canvas) ----------
function pdfToCanvasPx(x, y) { return currentViewport.convertToViewportPoint(x, y); }
function canvasPxToPdf(x, y) { return currentViewport.convertToPdfPoint(x, y); }

function eventToCanvasPx(e) {
  const rect = pageCanvas.getBoundingClientRect();
  const scaleX = pageCanvas.width / rect.width;
  const scaleY = pageCanvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}
function canvasPxToCssPx(x, y) {
  const rect = pageCanvas.getBoundingClientRect();
  return { x: (x / pageCanvas.width) * rect.width, y: (y / pageCanvas.height) * rect.height };
}

// ---------- Échantillonnage de la couleur de fond ----------
function sampleBackgroundColorAt(x0, y0, x1, y1) {
  const ctx = pageCanvas.getContext("2d");
  const corners = [pdfToCanvasPx(x0 - 2, y0 - 2), pdfToCanvasPx(x1 + 2, y0 - 2)];
  const samples = [];
  for (const c of corners) {
    const px = Math.max(0, Math.min(pageCanvas.width - 1, Math.round(c[0])));
    const py = Math.max(0, Math.min(pageCanvas.height - 1, Math.round(c[1])));
    try {
      const d = ctx.getImageData(px, py, 1, 1).data;
      samples.push([d[0], d[1], d[2]]);
    } catch (e) { /* canvas pollué (rare, cross origin), on ignore */ }
  }
  if (!samples.length) return { r: 1, g: 1, b: 1 };
  const avg = samples.reduce((a, s) => [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [0, 0, 0]).map((v) => v / samples.length);
  return { r: avg[0] / 255, g: avg[1] / 255, b: avg[2] / 255 };
}
function sampleBackgroundColorForLine(line) {
  return sampleBackgroundColorAt(line.x, line.y, line.x + line.width, line.y);
}

// ---------- Diff mot à mot (pour ne masquer/redessiner que la zone modifiée) ----------
function splitPlainTextWords(text) {
  return text.split(/\s+/).filter((w) => w.length > 0);
}
function computeWordDiff(oldWords, newWords) {
  let prefixCount = 0;
  const maxPrefix = Math.min(oldWords.length, newWords.length);
  while (prefixCount < maxPrefix && oldWords[prefixCount] === newWords[prefixCount]) prefixCount++;
  let suffixCount = 0;
  const maxSuffix = Math.min(oldWords.length, newWords.length) - prefixCount;
  while (suffixCount < maxSuffix && oldWords[oldWords.length - 1 - suffixCount] === newWords[newWords.length - 1 - suffixCount]) suffixCount++;
  return {
    prefixCount,
    oldMiddleStart: prefixCount,
    oldMiddleEnd: oldWords.length - suffixCount,
    newMiddleStart: prefixCount,
    newMiddleEnd: newWords.length - suffixCount,
  };
}

/** Calcule la zone (en points PDF) à masquer et le texte à dessiner pour un enregistrement d'édition de ligne. */
function computeLineEditRegion(line, editRecord) {
  if (editRecord.deleted) {
    return { deleted: true, maskX: line.x, maskWidth: line.width, drawText: "", drawX: line.x };
  }
  if (editRecord.forceFullLine) {
    return { deleted: false, maskX: line.x, maskWidth: line.width, drawText: editRecord.text, drawX: line.x };
  }
  const oldWords = line.words.map((w) => w.text);
  const newWords = splitPlainTextWords(editRecord.text);
  const diff = computeWordDiff(oldWords, newWords);
  let maskX, maskWidth;
  if (diff.oldMiddleStart < diff.oldMiddleEnd) {
    const firstOld = line.words[diff.oldMiddleStart];
    const lastOld = line.words[diff.oldMiddleEnd - 1];
    maskX = firstOld.x;
    maskWidth = lastOld.x + lastOld.width - firstOld.x;
  } else {
    const afterWord = diff.prefixCount > 0 ? line.words[diff.prefixCount - 1] : null;
    maskX = afterWord ? afterWord.x + afterWord.width : line.x;
    maskWidth = 0;
  }
  const middleWords = newWords.slice(diff.newMiddleStart, diff.newMiddleEnd);
  return { deleted: false, maskX, maskWidth, drawText: middleWords.join(" "), drawX: maskX };
}

// ---------- Rendu de la couche d'édition (overlay) ----------
/**
 * Reconstruit les zones interactives de texte (une fois par page affichée, ou
 * quand les lignes changent réellement, ex. après une reconnaissance OCR).
 * IMPORTANT : ne JAMAIS appeler ceci depuis une simple sélection de mot ou une
 * frappe clavier, sous peine de casser la détection native du double-clic par
 * le navigateur (qui exige que les deux clics visent le même élément DOM ;
 * recréer l'élément entre les deux clics empêche "dblclick" de se déclencher).
 */
function rebuildTextHitAreas() {
  previewWrap.querySelectorAll(".text-block-hit").forEach((el) => el.remove());
  const textData = pageTextCache.get(currentPageIndex);
  if (!textData) return;
  for (const line of textData.lines) {
    const hit = document.createElement("div");
    hit.className = "text-block-hit";
    positionOverlayEl(hit, line.x, line.y, line.width, line.height);
    hit.title = "Cliquer pour sélectionner un mot, double-cliquer pour modifier";
    hit.addEventListener("pointerdown", (e) => onLineHitPointerDown(e, line));
    hit.addEventListener("dblclick", (e) => {
      if (currentTool !== "select") return;
      e.preventDefault();
      const c = eventToCanvasPx(e);
      const p = canvasPxToPdf(c.x, c.y);
      openLineEditor(line, charIndexAtX(line, p[0]));
    });
    previewWrap.appendChild(hit);
  }
}

function rebuildImageAnnotations() {
  previewWrap.querySelectorAll(".img-annotation").forEach((el) => el.remove());
  const edits = getPageEdits(currentPageIndex);
  for (const img of edits.images) renderImageAnnotation(img);
}

/** Redessine uniquement le canevas transparent (texte édité, sélection, décorations, formes). Ne touche jamais au DOM des zones cliquables. */
function redrawOverlayCanvas() {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const edits = getPageEdits(currentPageIndex);
  const textData = pageTextCache.get(currentPageIndex);

  if (textData) {
    for (const line of textData.lines) {
      const edit = edits.textEdits.find((t) => t.lineId === line.id);
      if (edit) drawLineEditOnCanvas(ctx, line, edit);
    }
    if (wordSelection) {
      const line = textData.lines.find((l) => l.id === wordSelection.lineId);
      if (line) {
        for (let i = wordSelection.startWordIdx; i <= wordSelection.endWordIdx; i++) {
          const w = line.words[i];
          if (w) drawWordHighlight(ctx, line, w);
        }
      }
    }
  }

  for (const deco of edits.decorations) {
    const line = (textData || { lines: [] }).lines.find((l) => l.id === deco.lineId);
    if (!line) continue;
    drawDecoration(ctx, line, deco.type);
  }

  for (const ann of edits.annotations) drawAnnotation(ctx, ann);
}

/** Rendu complet : canevas + images (les zones cliquables de texte ne sont PAS reconstruites ici, voir rebuildTextHitAreas). */
function renderOverlay() {
  redrawOverlayCanvas();
  rebuildImageAnnotations();
  updateContextBarVisibility();
}

function positionOverlayEl(el, pdfX, pdfY, pdfW, pdfH) {
  const topLeft = pdfToCanvasPx(pdfX, pdfY + pdfH);
  const bottomRight = pdfToCanvasPx(pdfX + pdfW, pdfY);
  const a = canvasPxToCssPx(topLeft[0], topLeft[1]);
  const b = canvasPxToCssPx(bottomRight[0], bottomRight[1]);
  el.style.position = "absolute";
  el.style.left = Math.min(a.x, b.x) + "px";
  el.style.top = Math.min(a.y, b.y) + "px";
  el.style.width = Math.abs(b.x - a.x) + "px";
  el.style.height = Math.abs(b.y - a.y) + "px";
}

function fontCssFamily(family) {
  if (family === "serif") return "'Liberation Serif', Georgia, serif";
  if (family === "mono") return "'Liberation Mono', Consolas, monospace";
  return "'Liberation Sans', Arial, sans-serif";
}

function drawWordHighlight(ctx, line, word) {
  const tl = pdfToCanvasPx(word.x - 1, line.y + line.height);
  const br = pdfToCanvasPx(word.x + word.width + 1, line.y);
  ctx.fillStyle = "rgba(37, 99, 235, 0.30)";
  ctx.fillRect(Math.min(tl[0], br[0]), Math.min(tl[1], br[1]), Math.abs(br[0] - tl[0]), Math.abs(br[1] - tl[1]));
}

function drawLineEditOnCanvas(ctx, line, editRecord) {
  const region = computeLineEditRegion(line, editRecord);
  const bg = editRecord.bgColor || { r: 1, g: 1, b: 1 };
  if (region.deleted || region.maskWidth > 0) {
    const tl = pdfToCanvasPx(region.maskX - 1, line.y - 1);
    const br = pdfToCanvasPx(region.maskX + region.maskWidth + 1, line.y + line.height + 1);
    ctx.fillStyle = rgbCss(bg, 1);
    ctx.fillRect(Math.min(tl[0], br[0]), Math.min(tl[1], br[1]), Math.abs(br[0] - tl[0]), Math.abs(br[1] - tl[1]));
  }
  if (region.deleted || !region.drawText) return;
  const baseline = pdfToCanvasPx(region.drawX, line.baseline);
  const scalePx = Math.abs(pdfToCanvasPx(0, 0)[1] - pdfToCanvasPx(0, 1)[1]);
  const color = editRecord.color || INK;
  ctx.fillStyle = rgbCss(color, 1);
  let fontStr = "";
  if (editRecord.italic) fontStr += "italic ";
  if (editRecord.bold) fontStr += "bold ";
  fontStr += Math.round(editRecord.fontSize * scalePx) + "px " + fontCssFamily(editRecord.fontFamily);
  ctx.font = fontStr;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(region.drawText, baseline[0], baseline[1]);
}

function drawDecoration(ctx, line, type) {
  const y = type === "strikethrough" ? line.baseline + line.height * 0.28 : line.baseline - line.height * 0.08;
  const p1 = pdfToCanvasPx(line.x, y);
  const p2 = pdfToCanvasPx(line.x + line.width, y);
  ctx.strokeStyle = "rgb(" + Math.round(BLUE.r * 255) + "," + Math.round(BLUE.g * 255) + "," + Math.round(BLUE.b * 255) + ")";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
}

function rgbCss(c, alpha) { return "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + (alpha != null ? alpha : 1) + ")"; }

function drawAnnotation(ctx, ann) {
  if (ann.type === "newtext") {
    const p = pdfToCanvasPx(ann.x, ann.y);
    const scalePx = Math.abs(pdfToCanvasPx(0, 0)[1] - pdfToCanvasPx(0, 1)[1]);
    ctx.fillStyle = rgbCss(ann.color || INK, 1);
    ctx.font = Math.round(ann.size * scalePx) + "px " + fontCssFamily("sans");
    ctx.textBaseline = "alphabetic";
    ctx.fillText(ann.text, p[0], p[1]);
    return;
  }
  const color = ann.color || BLUE;
  ctx.strokeStyle = rgbCss(color, 1);
  ctx.lineWidth = (ann.thickness || 2) * Math.abs(pdfToCanvasPx(0, 0)[1] - pdfToCanvasPx(0, 1)[1]);

  if (ann.type === "whiteout" || ann.type === "highlight") {
    const tl = pdfToCanvasPx(ann.x, ann.y + ann.height);
    const br = pdfToCanvasPx(ann.x + ann.width, ann.y);
    ctx.fillStyle = ann.type === "whiteout" ? "#ffffff" : rgbCss(color, 0.35);
    ctx.fillRect(Math.min(tl[0], br[0]), Math.min(tl[1], br[1]), Math.abs(br[0] - tl[0]), Math.abs(br[1] - tl[1]));
  } else if (ann.type === "rect") {
    const tl = pdfToCanvasPx(ann.x, ann.y + ann.height);
    const br = pdfToCanvasPx(ann.x + ann.width, ann.y);
    ctx.strokeRect(Math.min(tl[0], br[0]), Math.min(tl[1], br[1]), Math.abs(br[0] - tl[0]), Math.abs(br[1] - tl[1]));
  } else if (ann.type === "circle") {
    const c = pdfToCanvasPx(ann.x + ann.width / 2, ann.y + ann.height / 2);
    const edge = pdfToCanvasPx(ann.x + ann.width, ann.y + ann.height / 2);
    const rx = Math.abs(edge[0] - c[0]);
    const edgeY = pdfToCanvasPx(ann.x + ann.width / 2, ann.y);
    const ry = Math.abs(edgeY[1] - c[1]);
    ctx.beginPath(); ctx.ellipse(c[0], c[1], rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (ann.type === "line" || ann.type === "arrow") {
    const p1 = pdfToCanvasPx(ann.x1, ann.y1);
    const p2 = pdfToCanvasPx(ann.x2, ann.y2);
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    if (ann.type === "arrow") {
      const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
      const headLen = 12;
      ctx.beginPath();
      ctx.moveTo(p2[0], p2[1]);
      ctx.lineTo(p2[0] - headLen * Math.cos(angle - Math.PI / 7), p2[1] - headLen * Math.sin(angle - Math.PI / 7));
      ctx.moveTo(p2[0], p2[1]);
      ctx.lineTo(p2[0] - headLen * Math.cos(angle + Math.PI / 7), p2[1] - headLen * Math.sin(angle + Math.PI / 7));
      ctx.stroke();
    }
  } else if (ann.type === "freehand") {
    ctx.beginPath();
    ann.points.forEach((pt, i) => {
      const p = pdfToCanvasPx(pt.x, pt.y);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    });
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.stroke();
  }
}

// ---------- Interaction : sélection de mot(s) et édition de ligne ----------
function onLineHitPointerDown(e, line) {
  if (currentTool !== "select") return;
  // Ne bloque pas le comportement par défaut ici : cela pourrait empêcher le
  // navigateur de synthétiser les événements click/dblclick à partir des
  // événements pointer (certains moteurs suppriment les événements souris de
  // compatibilité si preventDefault est appelé sur pointerdown).
  const startClientX = e.clientX, startClientY = e.clientY;
  const startCanvas = eventToCanvasPx(e);
  const startPdf = canvasPxToPdf(startCanvas.x, startCanvas.y);
  const startCharIdx = charIndexAtX(line, startPdf[0]);
  const startWordIdx = wordIndexAtCharIndex(line, startCharIdx);
  let dragged = false;

  function onMove(ev) {
    if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 4) dragged = true;
    if (!dragged) return;
    const c = eventToCanvasPx(ev);
    const p = canvasPxToPdf(c.x, c.y);
    const charIdx = charIndexAtX(line, p[0]);
    const wordIdx = wordIndexAtCharIndex(line, charIdx);
    if (wordIdx >= 0 && startWordIdx >= 0) setWordSelection(line, Math.min(startWordIdx, wordIdx), Math.max(startWordIdx, wordIdx));
  }
  function onUp(ev) {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    // Un simple clic (sans glissement) sélectionne toujours le mot sous le curseur.
    // Le double-clic (édition) est géré séparément par l'écouteur natif "dblclick",
    // beaucoup plus fiable qu'une détection maison basée sur un chronomètre.
    if (!dragged && startWordIdx >= 0) setWordSelection(line, startWordIdx, startWordIdx);
  }
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

function setWordSelection(line, startIdx, endIdx) {
  wordSelection = { lineId: line.id, startWordIdx: startIdx, endWordIdx: endIdx };
  selection = null;
  contextBar.classList.remove("visible");
  // Ne redessine que le canevas : ne jamais reconstruire les zones cliquables ici,
  // cela casserait la détection du double-clic natif par le navigateur.
  redrawOverlayCanvas();
}

let activeEditArea = null;
function openLineEditor(line, initialCharIdx) {
  closeTextEditor();
  wordSelection = null;
  const edits = getPageEdits(currentPageIndex);
  const existing = edits.textEdits.find((t) => t.lineId === line.id);
  const data = existing || {
    text: line.text, fontSize: line.fontSize, fontFamily: line.fontFamily,
    bold: line.bold, italic: line.italic, color: INK,
  };

  const area = document.createElement("textarea");
  area.className = "text-edit-area";
  area.value = data.text;
  area.spellcheck = false;
  positionOverlayEl(area, line.x, line.y, Math.max(line.width, 40), line.height * 1.4);
  const scalePx = Math.abs(pdfToCanvasPx(0, 0)[1] - pdfToCanvasPx(0, 1)[1]);
  const rect = pageCanvas.getBoundingClientRect();
  const cssScale = rect.width / pageCanvas.width;
  area.style.fontSize = data.fontSize * scalePx * cssScale + "px";
  area.style.fontStyle = data.italic ? "italic" : "normal";
  area.style.fontWeight = data.bold ? "700" : "400";
  area.style.fontFamily = fontCssFamily(data.fontFamily);
  previewWrap.appendChild(area);
  area.focus();
  const idx = Math.max(0, Math.min(area.value.length, initialCharIdx));
  area.setSelectionRange(idx, idx);

  const commit = () => {
    const newText = area.value;
    if (newText !== data.text) commitLineEdit(currentPageIndex, line, data, newText, false);
  };
  area.addEventListener("blur", () => { commit(); closeTextEditor(); });
  area.addEventListener("keydown", (e) => {
    // Empêche tout raccourci global (annuler, outils...) d'intercepter la frappe pendant l'édition.
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); area.value = data.text; closeTextEditor(); }
    else if (e.key === "Enter") { e.preventDefault(); area.blur(); }
  });
  activeEditArea = { area, line };
  selection = { kind: "text", pageIndex: currentPageIndex, id: line.id };
  showContextBarForLine(line, data);
}
function closeTextEditor() {
  if (!activeEditArea) return;
  const a = activeEditArea.area;
  activeEditArea = null;
  if (a && a.parentNode) a.parentNode.removeChild(a);
}

/** Enregistre une édition de ligne dans l'historique (utilisé par l'éditeur de ligne et le remplacement global). */
function commitLineEdit(pageIndex, line, data, newText, forceFullLine) {
  withHistory(pageIndex, (pe) => {
    const idx = pe.textEdits.findIndex((t) => t.lineId === line.id);
    const bgColor = (idx >= 0 && pe.textEdits[idx].bgColor) || sampleBackgroundColorForLine(line);
    const record = Object.assign({}, data, { lineId: line.id, text: newText, bgColor, forceFullLine: !!forceFullLine });
    if (idx >= 0) pe.textEdits[idx] = record; else pe.textEdits.push(record);
  });
}

// ---------- Barre contextuelle (affichée pendant l'édition d'une ligne) ----------
function showContextBarForLine(line, data) {
  contextBar.innerHTML = "";
  contextBar.classList.add("visible");
  const famSel = document.createElement("select");
  ["sans", "serif", "mono"].forEach((f) => {
    const o = document.createElement("option");
    o.value = f; o.textContent = f === "sans" ? "Sans serif" : f === "serif" ? "Serif" : "Monospace";
    if (f === data.fontFamily) o.selected = true;
    famSel.appendChild(o);
  });
  famSel.addEventListener("change", () => updateLineStyle(line, { fontFamily: famSel.value }));

  const sizeInput = document.createElement("input");
  sizeInput.type = "number"; sizeInput.min = "6"; sizeInput.max = "96"; sizeInput.style.width = "58px";
  sizeInput.value = Math.round(data.fontSize);
  sizeInput.addEventListener("change", () => updateLineStyle(line, { fontSize: parseFloat(sizeInput.value) || data.fontSize }));

  const boldBtn = document.createElement("button");
  boldBtn.type = "button"; boldBtn.textContent = "G"; boldBtn.title = "Gras";
  if (data.bold) boldBtn.classList.add("active");
  boldBtn.addEventListener("click", () => updateLineStyle(line, { bold: !getCurrentLineData(line).bold }));

  const italicBtn = document.createElement("button");
  italicBtn.type = "button"; italicBtn.textContent = "I"; italicBtn.title = "Italique";
  if (data.italic) italicBtn.classList.add("active");
  italicBtn.addEventListener("click", () => updateLineStyle(line, { italic: !getCurrentLineData(line).italic }));

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.title = "Couleur du texte";
  colorInput.value = rgbToHex(data.color || INK);
  colorInput.addEventListener("input", () => updateLineStyle(line, { color: hexToRgb(colorInput.value) }));

  const delBtn = document.createElement("button");
  delBtn.className = "del-btn"; delBtn.title = "Supprimer cette ligne"; delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => {
    closeTextEditor();
    withHistory(currentPageIndex, (pe) => {
      const idx = pe.textEdits.findIndex((t) => t.lineId === line.id);
      const bgColor = sampleBackgroundColorForLine(line);
      if (idx >= 0) { pe.textEdits[idx].deleted = true; } else pe.textEdits.push({ lineId: line.id, deleted: true, bgColor, text: "" });
    });
    deselect();
  });

  [famSel, sizeInput, boldBtn, italicBtn, colorInput, delBtn].forEach((el) => contextBar.appendChild(el));
  positionOverlayEl(contextBar, line.x, line.y + line.height + 4, 10, 10);
  contextBar.style.width = "auto";
  contextBar.style.height = "auto";
}
function getCurrentLineData(line) {
  const e = getPageEdits(currentPageIndex).textEdits.find((t) => t.lineId === line.id);
  return e || { bold: line.bold, italic: line.italic };
}

function updateLineStyle(line, patch) {
  const edits = getPageEdits(currentPageIndex);
  const existing = edits.textEdits.find((t) => t.lineId === line.id);
  const base = existing || { text: activeEditArea ? activeEditArea.area.value : line.text, fontSize: line.fontSize, fontFamily: line.fontFamily, bold: line.bold, italic: line.italic, color: INK };
  const newData = Object.assign({}, base, patch);
  withHistory(currentPageIndex, (pe) => {
    const idx = pe.textEdits.findIndex((t) => t.lineId === line.id);
    const bgColor = (idx >= 0 && pe.textEdits[idx].bgColor) || sampleBackgroundColorForLine(line);
    const record = Object.assign({}, newData, { lineId: line.id, bgColor, forceFullLine: true });
    if (idx >= 0) pe.textEdits[idx] = record; else pe.textEdits.push(record);
  });
  if (activeEditArea && activeEditArea.line.id === line.id) {
    const scalePx = Math.abs(pdfToCanvasPx(0, 0)[1] - pdfToCanvasPx(0, 1)[1]);
    const rect = pageCanvas.getBoundingClientRect();
    const cssScale = rect.width / pageCanvas.width;
    activeEditArea.area.style.fontSize = newData.fontSize * scalePx * cssScale + "px";
    activeEditArea.area.style.fontStyle = newData.italic ? "italic" : "normal";
    activeEditArea.area.style.fontWeight = newData.bold ? "700" : "400";
    activeEditArea.area.style.fontFamily = fontCssFamily(newData.fontFamily);
  }
  showContextBarForLine(line, newData);
}

function rgbToHex(c) {
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 };
}

function updateContextBarVisibility() {
  if (!selection || selection.pageIndex !== currentPageIndex) contextBar.classList.remove("visible");
}
function deselect() {
  selection = null;
  wordSelection = null;
  contextBar.classList.remove("visible");
  closeTextEditor();
}

// ---------- Outils de dessin (formes, surlignage, masquage, souligné, barré) ----------
document.getElementById("sideTools").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tool]");
  if (!btn) return;
  setTool(btn.dataset.tool);
});
function setTool(tool) {
  if (tool === "image") { imageInput.click(); return; }
  currentTool = tool;
  document.querySelectorAll("#sideTools button[data-tool], #mobileToolbar button[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  overlayCanvas.className = tool === "select" ? "tool-select" : tool === "text" ? "tool-text" : "";
  deselect();
  const hints = {
    select: "Cliquez sur un mot pour le sélectionner, cliquez-glissez pour sélectionner plusieurs mots, double-cliquez pour modifier le texte de la ligne.",
    text: "Cliquez sur la page pour ajouter du texte neuf.",
    whiteout: "Cliquez et glissez pour masquer une zone en blanc.",
    highlight: "Cliquez et glissez pour surligner une zone.",
    underline: "Cliquez sur une ligne de texte existante pour la souligner.",
    strikethrough: "Cliquez sur une ligne de texte existante pour la barrer.",
    rect: "Cliquez et glissez pour dessiner un rectangle.",
    circle: "Cliquez et glissez pour dessiner un cercle.",
    arrow: "Cliquez et glissez pour dessiner une flèche.",
    line: "Cliquez et glissez pour dessiner un trait.",
    freehand: "Cliquez et glissez pour dessiner librement.",
  };
  toolHint.textContent = hints[tool] || "";
}

(function buildMobileToolbar() {
  const mobile = document.getElementById("mobileToolbar");
  document.querySelectorAll("#sideTools button[data-tool]").forEach((b) => {
    const clone = b.cloneNode(true);
    clone.addEventListener("click", () => setTool(clone.dataset.tool));
    mobile.appendChild(clone);
  });
})();

overlayCanvas.addEventListener("pointerdown", (e) => {
  if (currentTool === "select" || currentTool === "text") return;
  const c = eventToCanvasPx(e);
  const p = canvasPxToPdf(c.x, c.y);

  if (currentTool === "underline" || currentTool === "strikethrough") {
    const textData = pageTextCache.get(currentPageIndex);
    if (!textData) return;
    const line = textData.lines.find((l) => p[0] >= l.x && p[0] <= l.x + l.width && p[1] >= l.y && p[1] <= l.y + l.height);
    if (line) {
      withHistory(currentPageIndex, (pe) => {
        const existingIdx = pe.decorations.findIndex((d) => d.lineId === line.id && d.type === currentTool);
        if (existingIdx >= 0) pe.decorations.splice(existingIdx, 1);
        else pe.decorations.push({ lineId: line.id, type: currentTool });
      });
    }
    return;
  }

  const drawStart = p;
  const freehandPoints = currentTool === "freehand" ? [p] : null;

  function onMove(ev) {
    const cc = eventToCanvasPx(ev);
    const pp = canvasPxToPdf(cc.x, cc.y);
    if (freehandPoints) freehandPoints.push(pp);
    renderOverlay();
    const ctx = overlayCanvas.getContext("2d");
    const preview = buildAnnotationFromDrag(currentTool, drawStart, pp, freehandPoints);
    if (preview) drawAnnotation(ctx, preview);
  }
  function onUp(ev) {
    overlayCanvas.removeEventListener("pointermove", onMove);
    overlayCanvas.removeEventListener("pointerup", onUp);
    const cc = eventToCanvasPx(ev);
    const pp = canvasPxToPdf(cc.x, cc.y);
    if (freehandPoints) freehandPoints.push(pp);
    const ann = buildAnnotationFromDrag(currentTool, drawStart, pp, freehandPoints);
    if (ann) withHistory(currentPageIndex, (pe) => pe.annotations.push(ann));
  }
  overlayCanvas.addEventListener("pointermove", onMove);
  overlayCanvas.addEventListener("pointerup", onUp);
});

function buildAnnotationFromDrag(tool, start, end, freehandPoints) {
  if (tool === "freehand") {
    if (!freehandPoints || freehandPoints.length < 2) return null;
    return { type: "freehand", points: freehandPoints.slice(), color: BLUE };
  }
  if (tool === "line" || tool === "arrow") {
    return { type: tool, x1: start[0], y1: start[1], x2: end[0], y2: end[1], color: BLUE, thickness: 2.5 };
  }
  const x = Math.min(start[0], end[0]);
  const y = Math.min(start[1], end[1]);
  const width = Math.abs(end[0] - start[0]);
  const height = Math.abs(end[1] - start[1]);
  if (width < 1 || height < 1) return null;
  if (tool === "whiteout") return { type: "whiteout", x, y, width, height };
  if (tool === "highlight") return { type: "highlight", x, y, width, height, color: BLUE };
  if (tool === "rect") return { type: "rect", x, y, width, height, color: BLUE, thickness: 2 };
  if (tool === "circle") return { type: "circle", x, y, width, height, color: BLUE, thickness: 2 };
  return null;
}

// ---------- Ajout d'image ----------
imageInput.addEventListener("change", async () => {
  const file = imageInput.files[0];
  imageInput.value = "";
  if (!file || !pdfjsDoc) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blob = new Blob([bytes], { type: file.type });
    const bitmap = await createImageBitmap(blob);
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    const pageW = currentPageObj.getViewport({ scale: 1 }).width;
    const pageH = currentPageObj.getViewport({ scale: 1 }).height;
    const w = Math.min(pageW * 0.4, bitmap.width);
    const h = w * (bitmap.height / bitmap.width);
    const img = { id: "img" + Date.now(), dataUrl, mime: file.type, x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h };
    withHistory(currentPageIndex, (pe) => pe.images.push(img));
  } catch (e) {
    showMsg("Impossible de lire cette image.");
  }
});

function renderImageAnnotation(img) {
  const el = document.createElement("div");
  el.className = "img-annotation";
  positionOverlayEl(el, img.x, img.y, img.width, img.height);
  const imgEl = document.createElement("img");
  imgEl.src = img.dataUrl;
  imgEl.draggable = false;
  el.appendChild(imgEl);
  const handle = document.createElement("div");
  handle.className = "img-resize-handle";
  el.appendChild(handle);

  el.addEventListener("pointerdown", (e) => {
    if (currentTool !== "select" || e.target === handle) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origX = img.x, origY = img.y;
    function onMove(ev) {
      const c1 = eventToCanvasPx({ clientX: startX, clientY: startY });
      const c2 = eventToCanvasPx(ev);
      const p1 = canvasPxToPdf(c1.x, c1.y);
      const p2 = canvasPxToPdf(c2.x, c2.y);
      positionOverlayEl(el, origX + (p2[0] - p1[0]), origY + (p2[1] - p1[1]), img.width, img.height);
    }
    function onUp(ev) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const c1 = eventToCanvasPx({ clientX: startX, clientY: startY });
      const c2 = eventToCanvasPx(ev);
      const p1 = canvasPxToPdf(c1.x, c1.y);
      const p2 = canvasPxToPdf(c2.x, c2.y);
      withHistory(currentPageIndex, (pe) => {
        const im = pe.images.find((x) => x.id === img.id);
        if (im) { im.x = origX + (p2[0] - p1[0]); im.y = origY + (p2[1] - p1[1]); }
      });
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const origW = img.width, origH = img.height, ratio = img.height / img.width;
    function onMove(ev) {
      const rect = pageCanvas.getBoundingClientRect();
      const dxCss = ev.clientX - startX;
      const dxPdf = dxCss / rect.width * currentPageObj.getViewport({ scale: 1 }).width;
      const newW = Math.max(20, origW + dxPdf);
      positionOverlayEl(el, img.x, img.y - (newW * ratio - origH), newW, newW * ratio);
    }
    function onUp(ev) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const rect = pageCanvas.getBoundingClientRect();
      const dxCss = ev.clientX - startX;
      const dxPdf = dxCss / rect.width * currentPageObj.getViewport({ scale: 1 }).width;
      const newW = Math.max(20, origW + dxPdf);
      withHistory(currentPageIndex, (pe) => {
        const im = pe.images.find((x) => x.id === img.id);
        if (im) { im.y = im.y - (newW * ratio - im.height); im.width = newW; im.height = newW * ratio; }
      });
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  previewWrap.appendChild(el);
}

// ---------- Outil texte neuf ----------
overlayCanvas.addEventListener("click", (e) => {
  if (currentTool !== "text") return;
  const c = eventToCanvasPx(e);
  const p = canvasPxToPdf(c.x, c.y);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-annotation-input";
  const cssPos = canvasPxToCssPx(c.x, c.y);
  input.style.left = cssPos.x + "px";
  input.style.top = cssPos.y - 10 + "px";
  previewWrap.appendChild(input);
  input.focus();
  function commit() {
    const val = input.value;
    if (input.parentNode) input.parentNode.removeChild(input);
    if (!val) return;
    withHistory(currentPageIndex, (pe) => pe.annotations.push({ type: "newtext", x: p[0], y: p[1], text: val, size: 14, color: INK }));
  }
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); input.blur(); } if (ev.key === "Escape") { input.value = ""; input.blur(); } });
});

// ---------- Zoom ----------
document.getElementById("zoomInBtn").addEventListener("click", () => setZoom(zoomFactor + 0.15));
document.getElementById("zoomOutBtn").addEventListener("click", () => setZoom(zoomFactor - 0.15));
function setZoom(z) {
  zoomFactor = Math.max(0.5, Math.min(2.5, z));
  updateZoomLabel();
  if (pdfjsDoc) renderCurrentPage();
}
function updateZoomLabel() { document.getElementById("zoomValue").textContent = Math.round(zoomFactor * 100) + " %"; }

// ---------- Recherche et remplacement ----------
document.getElementById("searchToggleBtn").addEventListener("click", () => {
  document.getElementById("searchBox").classList.toggle("visible");
  document.getElementById("searchInput").focus();
});
let searchMatches = [];
let searchIndex = -1;
async function runSearch(term) {
  searchMatches = [];
  if (!term) { updateSearchCount(); return; }
  const lower = term.toLowerCase();
  for (let i = 0; i < numPages; i++) {
    let data = pageTextCache.get(i);
    if (!data) {
      const page = await pdfjsDoc.getPage(i + 1);
      const content = await page.getTextContent();
      data = { lines: buildLines(content.items, content.styles), isOcr: false };
      pageTextCache.set(i, data);
    }
    data.lines.forEach((l) => { if (l.text.toLowerCase().includes(lower)) searchMatches.push({ pageIndex: i, lineId: l.id }); });
  }
  searchIndex = searchMatches.length ? 0 : -1;
  updateSearchCount();
  if (searchIndex >= 0) jumpToSearchMatch();
}
function updateSearchCount() {
  document.getElementById("searchCount").textContent = searchMatches.length ? searchIndex + 1 + " / " + searchMatches.length : "Aucun résultat";
}
async function jumpToSearchMatch() {
  const m = searchMatches[searchIndex];
  if (!m) return;
  if (m.pageIndex !== currentPageIndex) await goToPage(m.pageIndex);
}
document.getElementById("searchInput").addEventListener("input", (e) => runSearch(e.target.value));
document.getElementById("searchNextBtn").addEventListener("click", () => { if (searchMatches.length) { searchIndex = (searchIndex + 1) % searchMatches.length; updateSearchCount(); jumpToSearchMatch(); } });
document.getElementById("searchPrevBtn").addEventListener("click", () => { if (searchMatches.length) { searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length; updateSearchCount(); jumpToSearchMatch(); } });
document.getElementById("replaceToggleBtn").addEventListener("click", () => {
  const input = document.getElementById("replaceInput");
  const btn = document.getElementById("replaceAllBtn");
  const show = input.style.display === "none";
  input.style.display = show ? "inline-block" : "none";
  btn.style.display = show ? "inline-block" : "none";
});
document.getElementById("replaceAllBtn").addEventListener("click", async () => {
  const term = document.getElementById("searchInput").value;
  const replacement = document.getElementById("replaceInput").value;
  if (!term) return;
  for (const m of searchMatches) {
    const data = pageTextCache.get(m.pageIndex);
    const line = data.lines.find((l) => l.id === m.lineId);
    if (!line) continue;
    const edits = getPageEdits(m.pageIndex);
    const existing = edits.textEdits.find((t) => t.lineId === line.id);
    const currentText = existing ? existing.text : line.text;
    const newText = currentText.replace(new RegExp(escapeRegExp(term), "gi"), replacement);
    const data2 = existing || { text: line.text, fontSize: line.fontSize, fontFamily: line.fontFamily, bold: line.bold, italic: line.italic, color: INK };
    commitLineEdit(m.pageIndex, line, data2, newText, false);
  }
  showMsg("Remplacement effectué dans " + searchMatches.length + " ligne(s).");
});
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ---------- OCR (pages scannées ou texte de mauvaise qualité) ----------
let tesseractPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error("Impossible de charger le moteur de reconnaissance de texte (problème réseau)."));
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

document.getElementById("ocrBannerBtn").addEventListener("click", async () => {
  const btn = document.getElementById("ocrBannerBtn");
  btn.disabled = true;
  hideMsg();
  try {
    setProgress(5, "Chargement du moteur de reconnaissance de texte…");
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker(["fra", "eng"], 1, {
      logger: (m) => {
        if (m.status && typeof m.progress === "number") setProgress(Math.round(m.progress * 100), "Reconnaissance du texte de la page " + (currentPageIndex + 1) + "…");
      },
    });
    const ocrScale = 2;
    const viewport = currentPageObj.getViewport({ scale: ocrScale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await currentPageObj.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const { data } = await worker.recognize(canvas);
    await worker.terminate();

    const lines = buildLinesFromOcrWords(data.words || [], ocrScale);
    pageTextCache.set(currentPageIndex, { lines, isOcr: true });
    hideProgress();
    scannedBanner.classList.remove("visible");
    rebuildTextHitAreas();
    renderOverlay();
    const wordCount = lines.reduce((n, l) => n + l.words.length, 0);
    showMsg(wordCount > 0
      ? "Reconnaissance terminée : " + wordCount + " mot(s) détecté(s) sur cette page. Vous pouvez maintenant cliquer sur le texte pour le modifier."
      : "Aucun mot n'a pu être reconnu sur cette page. Vous pouvez continuer en mode annotation (texte neuf, formes, masquage).");
  } catch (e) {
    hideProgress();
    showMsg(e.message || "La reconnaissance de texte a échoué.");
  } finally {
    btn.disabled = false;
  }
});

/** Construit un modèle de lignes/mots à partir des mots reconnus par Tesseract (bbox en pixels du rendu OCR). */
function buildLinesFromOcrWords(words, renderScale) {
  const usable = words.filter((w) => w.text && w.text.trim());
  const rawLines = [];
  for (const w of usable) {
    const cyPx = (w.bbox.y0 + w.bbox.y1) / 2;
    const h = w.bbox.y1 - w.bbox.y0;
    let line = rawLines.find((l) => Math.abs(l.cyPx - cyPx) < h * 0.6);
    if (!line) { line = { cyPx, items: [] }; rawLines.push(line); }
    line.items.push(w);
  }
  rawLines.sort((a, b) => a.cyPx - b.cyPx);
  const pageHeightPt = currentPageObj.getViewport({ scale: 1 }).height;
  return rawLines.map((rl, idx) => {
    rl.items.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const chars = [];
    const words2 = [];
    let charCursor = 0;
    let text = "";
    rl.items.forEach((w, wi) => {
      if (wi > 0) { text += " "; chars.push({ ch: " ", x: 0, width: 0 }); charCursor++; }
      const pdfX0 = w.bbox.x0 / renderScale;
      const pdfX1 = w.bbox.x1 / renderScale;
      const wStart = charCursor;
      const per = w.text.length ? (pdfX1 - pdfX0) / w.text.length : 0;
      for (let ci = 0; ci < w.text.length; ci++) chars.push({ ch: w.text[ci], x: pdfX0 + per * ci, width: per });
      charCursor += w.text.length;
      text += w.text;
      words2.push({ text: w.text, startIdx: wStart, endIdx: charCursor, x: pdfX0, width: pdfX1 - pdfX0 });
    });
    const y0Px = Math.min.apply(null, rl.items.map((w) => w.bbox.y0));
    const y1Px = Math.max.apply(null, rl.items.map((w) => w.bbox.y1));
    const x0Px = Math.min.apply(null, rl.items.map((w) => w.bbox.x0));
    const x1Px = Math.max.apply(null, rl.items.map((w) => w.bbox.x1));
    const baseline = pageHeightPt - y1Px / renderScale;
    const heightPt = (y1Px - y0Px) / renderScale;
    return {
      id: "ocrline" + idx + "_" + Math.round(baseline),
      baseline,
      x: x0Px / renderScale,
      y: baseline - heightPt * 0.15,
      width: (x1Px - x0Px) / renderScale,
      height: heightPt * 1.2,
      fontSize: heightPt,
      fontFamily: "sans",
      bold: false,
      italic: false,
      chars,
      words: words2,
      text,
    };
  });
}

// ---------- Plein écran, aide, raccourcis clavier ----------
document.getElementById("fullscreenBtn").addEventListener("click", () => {
  document.getElementById("editorLayout").classList.toggle("fullscreen");
});
document.getElementById("helpBtn").addEventListener("click", () => document.getElementById("helpModal").classList.add("visible"));
document.getElementById("closeHelpBtn").addEventListener("click", () => document.getElementById("helpModal").classList.remove("visible"));
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);

document.addEventListener("keydown", (e) => {
  if (activeEditArea) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || e.shiftKey && e.key.toLowerCase() === "z")) { e.preventDefault(); redo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); document.getElementById("searchBox").classList.add("visible"); document.getElementById("searchInput").focus(); }
  else if (e.key === "v") setTool("select");
  else if (e.key === "t") setTool("text");
  else if (e.key === "i") imageInput.click();
  else if (e.key === "?") document.getElementById("helpModal").classList.add("visible");
  else if (e.key === "Escape") {
    document.getElementById("helpModal").classList.remove("visible");
    document.getElementById("editorLayout").classList.remove("fullscreen");
  }
});

// ---------- Polices : chargement (Liberation, sous-ensembles au moment de l'export) ----------
const fontBytesCache = {};
async function fetchFontBytes(family, bold, italic) {
  const key = family + "-" + (bold ? "b" : "") + (italic ? "i" : "");
  if (fontBytesCache[key]) return fontBytesCache[key];
  const files = FONT_FILES[family] || FONT_FILES.sans;
  const name = bold && italic ? files.boldItalic : bold ? files.bold : italic ? files.italic : files.regular;
  const resp = await fetch(LIBERATION_BASE + name);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  fontBytesCache[key] = bytes;
  return bytes;
}

/** Charge fontkit (nécessaire uniquement à l'enregistrement) à la demande, une seule fois. */
let fontkitPromise = null;
function loadFontkit() {
  if (window.fontkit) return Promise.resolve(window.fontkit);
  if (fontkitPromise) return fontkitPromise;
  fontkitPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";
    script.onload = () => resolve(window.fontkit);
    script.onerror = () => reject(new Error("Impossible de charger le module de polices (problème réseau)."));
    document.head.appendChild(script);
  });
  return fontkitPromise;
}

// ---------- Enregistrement final ----------
saveBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  saveBtn.disabled = true;
  try {
    setProgress(5, "Chargement du document…");
    const { PDFDocument, rgb } = PDFLib;
    const doc = await PDFDocument.load(srcBytes);
    doc.registerFontkit(await loadFontkit());

    const fontObjCache = {};
    async function getEmbeddedFont(family, bold, italic) {
      const key = family + "-" + (bold ? "b" : "") + (italic ? "i" : "");
      if (fontObjCache[key]) return fontObjCache[key];
      const bytes = await fetchFontBytes(family, bold, italic);
      const font = await doc.embedFont(bytes, { subset: true });
      fontObjCache[key] = font;
      return font;
    }

    const pages = doc.getPages();
    const pageIndices = Array.from(pageEditsMap.keys()).filter((i) => {
      const e = pageEditsMap.get(i);
      return e.textEdits.length || e.decorations.length || e.annotations.length || e.images.length;
    });

    for (let n = 0; n < pageIndices.length; n++) {
      const pageIndex = pageIndices[n];
      setProgress(5 + Math.round((n + 1) / Math.max(1, pageIndices.length) * 80), "Application des modifications, page " + (pageIndex + 1) + "…");
      const page = pages[pageIndex];
      const edits = getPageEdits(pageIndex);
      const textData = pageTextCache.get(pageIndex);

      for (const t of edits.textEdits) {
        const line = textData ? textData.lines.find((l) => l.id === t.lineId) : null;
        if (!line) continue;
        const region = computeLineEditRegion(line, t);
        const bg = t.bgColor || { r: 1, g: 1, b: 1 };
        if (region.deleted || region.maskWidth > 0) {
          page.drawRectangle({ x: region.maskX - 1, y: line.y - 1, width: region.maskWidth + 2, height: line.height + 2, color: rgb(bg.r, bg.g, bg.b) });
        }
        if (region.deleted || !region.drawText) continue;
        const font = await getEmbeddedFont(t.fontFamily || "sans", !!t.bold, !!t.italic);
        const color = t.color || INK;
        wrapAndDrawText(page, font, region.drawText, region.drawX, line.baseline, Math.max(line.width - (region.drawX - line.x), 40), t.fontSize, rgb(color.r, color.g, color.b));
      }

      for (const deco of edits.decorations) {
        const line = textData ? textData.lines.find((l) => l.id === deco.lineId) : null;
        if (!line) continue;
        const y = deco.type === "strikethrough" ? line.baseline + line.height * 0.28 : line.baseline - line.height * 0.08;
        page.drawLine({ start: { x: line.x, y }, end: { x: line.x + line.width, y }, thickness: 1, color: rgb(BLUE.r, BLUE.g, BLUE.b) });
      }

      for (const ann of edits.annotations) drawAnnotationOnPdfPage(page, ann, rgb);

      for (const img of edits.images) {
        const bytes = dataUrlToBytes(img.dataUrl);
        const embedded = img.mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        page.drawImage(embedded, { x: img.x, y: img.y, width: img.width, height: img.height });
      }
    }

    setProgress(90, "Génération du fichier final…");
    const out = await doc.save();
    hideProgress();
    hasUnsavedChanges = false;
    offerDownload(out, "tchadiapdf-modifie.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "L'enregistrement a échoué. Réessayez avec un autre fichier.");
  } finally {
    saveBtn.disabled = false;
  }
});

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function wrapAndDrawText(page, font, text, x, baseline, maxWidth, fontSize, color) {
  const words = text.split(" ");
  let line = "";
  const lineHeight = fontSize * 1.15;
  const linesToDraw = [];
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    let widthOk = true;
    try { widthOk = font.widthOfTextAtSize(candidate, fontSize) <= maxWidth; } catch (e) { widthOk = true; }
    if (!widthOk && line) { linesToDraw.push(line); line = word; } else { line = candidate; }
  }
  if (line) linesToDraw.push(line);
  linesToDraw.forEach((l, i) => {
    try {
      page.drawText(l, { x, y: baseline - i * lineHeight, size: fontSize, font, color });
    } catch (e) { /* caractère non supporté par la police de substitution, ignore ce fragment */ }
  });
}

function drawAnnotationOnPdfPage(page, ann, rgb) {
  const c = ann.color || BLUE;
  if (ann.type === "whiteout") {
    page.drawRectangle({ x: ann.x, y: ann.y, width: ann.width, height: ann.height, color: rgb(1, 1, 1) });
  } else if (ann.type === "highlight") {
    page.drawRectangle({ x: ann.x, y: ann.y, width: ann.width, height: ann.height, color: rgb(c.r, c.g, c.b), opacity: 0.35 });
  } else if (ann.type === "rect") {
    page.drawRectangle({ x: ann.x, y: ann.y, width: ann.width, height: ann.height, borderColor: rgb(c.r, c.g, c.b), borderWidth: ann.thickness || 2 });
  } else if (ann.type === "circle") {
    page.drawEllipse({ x: ann.x + ann.width / 2, y: ann.y + ann.height / 2, xScale: ann.width / 2, yScale: ann.height / 2, borderColor: rgb(c.r, c.g, c.b), borderWidth: ann.thickness || 2 });
  } else if (ann.type === "line") {
    page.drawLine({ start: { x: ann.x1, y: ann.y1 }, end: { x: ann.x2, y: ann.y2 }, thickness: ann.thickness || 2, color: rgb(c.r, c.g, c.b) });
  } else if (ann.type === "arrow") {
    page.drawLine({ start: { x: ann.x1, y: ann.y1 }, end: { x: ann.x2, y: ann.y2 }, thickness: ann.thickness || 2, color: rgb(c.r, c.g, c.b) });
    const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
    const headLen = 10;
    const a1x = ann.x2 - headLen * Math.cos(angle - Math.PI / 7), a1y = ann.y2 - headLen * Math.sin(angle - Math.PI / 7);
    const a2x = ann.x2 - headLen * Math.cos(angle + Math.PI / 7), a2y = ann.y2 - headLen * Math.sin(angle + Math.PI / 7);
    page.drawLine({ start: { x: ann.x2, y: ann.y2 }, end: { x: a1x, y: a1y }, thickness: ann.thickness || 2, color: rgb(c.r, c.g, c.b) });
    page.drawLine({ start: { x: ann.x2, y: ann.y2 }, end: { x: a2x, y: a2y }, thickness: ann.thickness || 2, color: rgb(c.r, c.g, c.b) });
  } else if (ann.type === "freehand") {
    for (let i = 0; i < ann.points.length - 1; i++) {
      page.drawLine({ start: { x: ann.points[i].x, y: ann.points[i].y }, end: { x: ann.points[i + 1].x, y: ann.points[i + 1].y }, thickness: 2.5, color: rgb(c.r, c.g, c.b) });
    }
  } else if (ann.type === "newtext") {
    page.drawText(ann.text, { x: ann.x, y: ann.y, size: ann.size, color: rgb((ann.color || INK).r, (ann.color || INK).g, (ann.color || INK).b) });
  }
}

setTool("select");
