/* tchadiaPdf : Modifier PDF, éditeur complet
 *
 * Architecture : pdf.js rend la page courante dans un canvas ; un second
 * canvas transparent superposé sert de zone d'interaction pour les formes
 * (rectangle, cercle, flèche, trait, dessin libre, surlignage, masquage) ;
 * des éléments HTML positionnés par-dessus servent de zones interactives
 * pour les blocs de texte existants (détectés via pdf.js getTextContent)
 * et pour les images ajoutées, qui ont besoin d'être de vrais éléments du
 * DOM pour capter le survol, le clic et la saisie de texte.
 *
 * Toutes les modifications sont conservées en mémoire, par page, sous
 * forme de données en points PDF (pas en pixels d'écran), et ne sont
 * transformées en instructions pdf-lib qu'au moment de l'enregistrement
 * final. L'historique annuler/rétablir fonctionne par instantané de ces
 * données page par page : simple et fiable, largement suffisant vu la
 * taille modeste de ces listes de modifications.
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

// ---------- État global ----------
let currentFile = null;
let srcBytes = null;
let pdfjsDoc = null;
let numPages = 0;
let currentPageIndex = 0;
let zoomFactor = 1;
let currentTool = "select";
let hasUnsavedChanges = false;

const pageTextCache = new Map(); // pageIndex -> { items, styles, blocks }
const pageEditsMap = new Map(); // pageIndex -> { textEdits: [], decorations: [], annotations: [], images: [] }
const history = []; // { pageIndex, before, after }
let historyIndex = -1;

let selection = null; // { kind: 'text'|'image'|'annotation', pageIndex, id }

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

  // Détection PDF scanné (aucun texte sur les premières pages)
  let hasAnyText = false;
  const pagesToCheck = Math.min(numPages, 3);
  for (let i = 1; i <= pagesToCheck; i++) {
    const page = await pdfjsDoc.getPage(i);
    const content = await page.getTextContent();
    if (content.items.some((it) => it.str && it.str.trim())) { hasAnyText = true; break; }
  }
  if (!hasAnyText) scannedBanner.classList.add("visible");

  pageTextCache.clear();
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
  // Rendu progressif (non bloquant) des vignettes, page par page.
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
    const blocks = groupIntoBlocks(content.items, content.styles);
    pageTextCache.set(currentPageIndex, { items: content.items, styles: content.styles, blocks });
  }
  renderOverlay();
}

// ---------- Regroupement du texte en blocs modifiables ----------
function groupIntoBlocks(items, styles) {
  const lines = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const y = item.transform[5];
    let line = lines.find((l) => Math.abs(l.y - y) < 2);
    if (!line) { line = { y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((line, idx) => {
    line.items.sort((a, b) => a.transform[4] - b.transform[4]);
    const text = line.items.map((it) => it.str).join("");
    const first = line.items[0];
    const last = line.items[line.items.length - 1];
    const x0 = first.transform[4];
    const x1 = last.transform[4] + (last.width || 0);
    const fontHeight = Math.max.apply(null, line.items.map((it) => Math.abs(it.transform[3]) || it.height || 10));
    const style = styles[first.fontName] || {};
    const detected = detectStyle(first.fontName, style, first.transform);
    return {
      id: "blk" + idx + "_" + Math.round(line.y),
      text,
      x: x0,
      y: line.y - fontHeight * 0.22,
      width: Math.max(x1 - x0, fontHeight * 0.6),
      height: fontHeight * 1.2,
      baseline: line.y,
      fontSize: fontHeight,
      fontFamily: detected.family,
      bold: detected.bold,
      italic: detected.italic,
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

// ---------- Conversion de coordonnées (PDF <-> pixels du canvas) ----------
function pdfToCanvasPx(x, y) { return currentViewport.convertToViewportPoint(x, y); }
function canvasPxToPdf(x, y) { return currentViewport.convertToPdfPoint(x, y); }

/** Convertit une position d'événement pointeur en pixels internes du canvas (indépendant du redimensionnement CSS). */
function eventToCanvasPx(e) {
  const rect = pageCanvas.getBoundingClientRect();
  const scaleX = pageCanvas.width / rect.width;
  const scaleY = pageCanvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}
/** Facteur pour positionner des éléments DOM (en pixels CSS) à partir de coordonnées canvas internes. */
function canvasPxToCssPx(x, y) {
  const rect = pageCanvas.getBoundingClientRect();
  return { x: (x / pageCanvas.width) * rect.width, y: (y / pageCanvas.height) * rect.height };
}

// ---------- Échantillonnage de la couleur de fond ----------
function sampleBackgroundColor(block) {
  const ctx = pageCanvas.getContext("2d");
  const corners = [
    pdfToCanvasPx(block.x - 2, block.y - 2),
    pdfToCanvasPx(block.x + block.width + 2, block.y - 2),
  ];
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

// ---------- Rendu de la couche d'édition (overlay) ----------
function renderOverlay() {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  previewWrap.querySelectorAll(".text-block-hit, .img-annotation").forEach((el) => el.remove());

  const edits = getPageEdits(currentPageIndex);
  const textData = pageTextCache.get(currentPageIndex);

  if (textData) {
    for (const block of textData.blocks) {
      const edit = edits.textEdits.find((t) => t.blockId === block.id);
      if (edit && edit.deleted) continue;
      const displayBlock = edit ? Object.assign({}, block, edit) : block;
      if (edit) drawTextBlockOnCanvas(ctx, displayBlock);
      const hit = document.createElement("div");
      hit.className = "text-block-hit";
      positionOverlayEl(hit, block.x, block.y, block.width, block.height);
      hit.title = "Cliquer pour modifier ce texte";
      hit.addEventListener("pointerdown", (e) => onTextBlockPointerDown(e, block));
      previewWrap.appendChild(hit);
    }
  }

  for (const deco of edits.decorations) {
    const block = (textData || { blocks: [] }).blocks.find((b) => b.id === deco.blockId);
    if (!block) continue;
    drawDecoration(ctx, block, deco.type);
  }

  for (const ann of edits.annotations) drawAnnotation(ctx, ann);

  for (const img of edits.images) renderImageAnnotation(img);

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

function drawTextBlockOnCanvas(ctx, block) {
  const bg = block.bgColor || { r: 1, g: 1, b: 1 };
  const tl = pdfToCanvasPx(block.x - 1, block.y + block.height + 1);
  const br = pdfToCanvasPx(block.x + block.width + 1, block.y - 1);
  ctx.fillStyle = "rgb(" + Math.round(bg.r * 255) + "," + Math.round(bg.g * 255) + "," + Math.round(bg.b * 255) + ")";
  ctx.fillRect(Math.min(tl[0], br[0]), Math.min(tl[1], br[1]), Math.abs(br[0] - tl[0]), Math.abs(br[1] - tl[1]));

  if (block.deleted || !block.text) return;
  const baseline = pdfToCanvasPx(block.x, block.baseline);
  const scalePx = Math.abs(pdfToCanvasPx(0, 0)[1] - pdfToCanvasPx(0, 1)[1]);
  const color = block.color || INK;
  ctx.fillStyle = "rgb(" + Math.round(color.r * 255) + "," + Math.round(color.g * 255) + "," + Math.round(color.b * 255) + ")";
  let fontStr = "";
  if (block.italic) fontStr += "italic ";
  if (block.bold) fontStr += "bold ";
  fontStr += Math.round(block.fontSize * scalePx) + "px " + fontCssFamily(block.fontFamily);
  ctx.font = fontStr;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(block.text, baseline[0], baseline[1]);
}

function drawDecoration(ctx, block, type) {
  const y = type === "strikethrough" ? block.baseline + block.height * 0.28 : block.baseline - block.height * 0.08;
  const p1 = pdfToCanvasPx(block.x, y);
  const p2 = pdfToCanvasPx(block.x + block.width, y);
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
  ctx.lineWidth = (ann.thickness || 2) * (Math.abs(pdfToCanvasPx(0, 0)[1] - pdfToCanvasPx(0, 1)[1]));

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

// ---------- Interaction : édition d'un bloc de texte existant ----------
function onTextBlockPointerDown(e, block) {
  if (currentTool !== "select") return;
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  let moved = false;
  const edits = getPageEdits(currentPageIndex);
  const existing = edits.textEdits.find((t) => t.blockId === block.id);
  const origX = existing ? existing.x : block.x;
  const origY = existing ? existing.y : block.y;

  function onMove(ev) {
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) moved = true;
    if (!moved) return;
    const c1 = eventToCanvasPx({ clientX: startX, clientY: startY });
    const c2 = eventToCanvasPx(ev);
    const p1 = canvasPxToPdf(c1.x, c1.y);
    const p2 = canvasPxToPdf(c2.x, c2.y);
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    renderOverlay();
    const ctx = overlayCanvas.getContext("2d");
    const moved2 = Object.assign({}, block, { x: origX + dx, y: origY + dy, baseline: origY + dy + block.height * 0.22 });
    drawTextBlockOnCanvas(ctx, Object.assign({ bgColor: existing ? existing.bgColor : { r: 1, g: 1, b: 1 }, color: INK }, moved2));
  }
  function onUp(ev) {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (moved) {
      const c1 = eventToCanvasPx({ clientX: startX, clientY: startY });
      const c2 = eventToCanvasPx(ev);
      const p1 = canvasPxToPdf(c1.x, c1.y);
      const p2 = canvasPxToPdf(c2.x, c2.y);
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      withHistory(currentPageIndex, (pe) => {
        const t = pe.textEdits.find((x) => x.blockId === block.id);
        if (t) { t.x = origX + dx; t.y = origY + dy; t.baseline = (t.baseline != null ? t.baseline : block.baseline) + dy; }
        else pe.textEdits.push({ blockId: block.id, text: block.text, fontSize: block.fontSize, fontFamily: block.fontFamily, bold: block.bold, italic: block.italic, color: INK, bgColor: sampleBackgroundColor(block), baseline: block.baseline + dy, x: origX + dx, y: origY + dy, width: block.width, height: block.height });
      });
    } else {
      openTextEditor(block);
    }
  }
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

let activeEditArea = null;
function openTextEditor(block) {
  closeTextEditor();
  const edits = getPageEdits(currentPageIndex);
  const existing = edits.textEdits.find((t) => t.blockId === block.id);
  const data = existing || { text: block.text, fontSize: block.fontSize, fontFamily: block.fontFamily, bold: block.bold, italic: block.italic, color: INK, x: block.x, y: block.y, baseline: block.baseline, width: block.width, height: block.height };

  const area = document.createElement("textarea");
  area.className = "text-edit-area";
  area.value = data.text;
  area.spellcheck = false;
  positionOverlayEl(area, data.x, data.y, Math.max(data.width, 40), data.height * 1.4);
  const scalePx = Math.abs(pdfToCanvasPx(0, 0)[1] - pdfToCanvasPx(0, 1)[1]);
  const rect = pageCanvas.getBoundingClientRect();
  const cssScale = rect.width / pageCanvas.width;
  area.style.fontSize = (data.fontSize * scalePx * cssScale) + "px";
  area.style.fontStyle = data.italic ? "italic" : "normal";
  area.style.fontWeight = data.bold ? "700" : "400";
  area.style.fontFamily = fontCssFamily(data.fontFamily);
  previewWrap.appendChild(area);
  area.focus();
  area.select();

  const commit = () => {
    const newText = area.value;
    withHistory(currentPageIndex, (pe) => {
      const idx = pe.textEdits.findIndex((t) => t.blockId === block.id);
      const bgColor = existing ? existing.bgColor : sampleBackgroundColor(block);
      const record = Object.assign({}, data, { blockId: block.id, text: newText, bgColor });
      if (idx >= 0) pe.textEdits[idx] = record; else pe.textEdits.push(record);
    });
  };
  area.addEventListener("blur", () => { commit(); closeTextEditor(); });
  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); area.value = data.text; closeTextEditor(); }
  });
  activeEditArea = { area, block };
  selection = { kind: "text", pageIndex: currentPageIndex, id: block.id, block };
  showContextBarForText(block, data);
}
function closeTextEditor() {
  if (!activeEditArea) return;
  const a = activeEditArea.area;
  activeEditArea = null;
  if (a && a.parentNode) a.parentNode.removeChild(a);
}

// ---------- Barre contextuelle ----------
function showContextBarForText(block, data) {
  contextBar.innerHTML = "";
  contextBar.classList.add("visible");
  const famSel = document.createElement("select");
  ["sans", "serif", "mono"].forEach((f) => {
    const o = document.createElement("option");
    o.value = f; o.textContent = f === "sans" ? "Sans serif" : f === "serif" ? "Serif" : "Monospace";
    if (f === data.fontFamily) o.selected = true;
    famSel.appendChild(o);
  });
  famSel.addEventListener("change", () => updateTextStyle(block, { fontFamily: famSel.value }));

  const sizeInput = document.createElement("input");
  sizeInput.type = "number"; sizeInput.min = "6"; sizeInput.max = "96"; sizeInput.style.width = "58px";
  sizeInput.value = Math.round(data.fontSize);
  sizeInput.addEventListener("change", () => updateTextStyle(block, { fontSize: parseFloat(sizeInput.value) || data.fontSize }));

  const boldBtn = document.createElement("button");
  boldBtn.type = "button"; boldBtn.textContent = "G"; boldBtn.title = "Gras";
  if (data.bold) boldBtn.classList.add("active");
  boldBtn.addEventListener("click", () => updateTextStyle(block, { bold: !getCurrentTextData(block).bold }));

  const italicBtn = document.createElement("button");
  italicBtn.type = "button"; italicBtn.textContent = "I"; italicBtn.title = "Italique";
  if (data.italic) italicBtn.classList.add("active");
  italicBtn.addEventListener("click", () => updateTextStyle(block, { italic: !getCurrentTextData(block).italic }));

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.title = "Couleur du texte";
  colorInput.value = rgbToHex(data.color || INK);
  colorInput.addEventListener("input", () => updateTextStyle(block, { color: hexToRgb(colorInput.value) }));

  const delBtn = document.createElement("button");
  delBtn.className = "del-btn"; delBtn.title = "Supprimer ce texte"; delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => {
    withHistory(currentPageIndex, (pe) => {
      const idx = pe.textEdits.findIndex((t) => t.blockId === block.id);
      const bgColor = sampleBackgroundColor(block);
      if (idx >= 0) pe.textEdits[idx].deleted = true; else pe.textEdits.push({ blockId: block.id, deleted: true, bgColor, text: "", x: block.x, y: block.y, width: block.width, height: block.height });
    });
    deselect();
  });

  [famSel, sizeInput, boldBtn, italicBtn, colorInput, delBtn].forEach((el) => contextBar.appendChild(el));
  positionOverlayEl(contextBar, block.x, block.y + block.height + 4, 10, 10);
  contextBar.style.width = "auto";
  contextBar.style.height = "auto";
}
function getCurrentTextData(block) {
  const e = getPageEdits(currentPageIndex).textEdits.find((t) => t.blockId === block.id);
  return e || { bold: block.bold, italic: block.italic };
}

function updateTextStyle(block, patch) {
  withHistory(currentPageIndex, (pe) => {
    const idx = pe.textEdits.findIndex((t) => t.blockId === block.id);
    if (idx >= 0) Object.assign(pe.textEdits[idx], patch);
    else pe.textEdits.push(Object.assign({ blockId: block.id, text: block.text, fontSize: block.fontSize, fontFamily: block.fontFamily, bold: block.bold, italic: block.italic, color: INK, x: block.x, y: block.y, baseline: block.baseline, width: block.width, height: block.height, bgColor: sampleBackgroundColor(block) }, patch));
  });
  const e = getPageEdits(currentPageIndex).textEdits.find((t) => t.blockId === block.id);
  if (e) showContextBarForText(block, e);
}

function rgbToHex(c) {
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function updateContextBarVisibility() {
  if (!selection || selection.pageIndex !== currentPageIndex) {
    contextBar.classList.remove("visible");
  }
}
function deselect() {
  selection = null;
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
    select: "Cliquez sur un texte existant pour le modifier directement, ou choisissez un outil dans la barre de gauche.",
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
    const block = textData.blocks.find((b) => p[0] >= b.x && p[0] <= b.x + b.width && p[1] >= b.y && p[1] <= b.y + b.height);
    if (block) {
      withHistory(currentPageIndex, (pe) => {
        const existingIdx = pe.decorations.findIndex((d) => d.blockId === block.id && d.type === currentTool);
        if (existingIdx >= 0) pe.decorations.splice(existingIdx, 1);
        else pe.decorations.push({ blockId: block.id, type: currentTool });
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
    const img = {
      id: "img" + Date.now(),
      dataUrl,
      mime: file.type,
      x: (pageW - w) / 2,
      y: (pageH - h) / 2,
      width: w,
      height: h,
    };
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
      const dxPdf = (dxCss / rect.width) * currentPageObj.getViewport({ scale: 1 }).width;
      const newW = Math.max(20, origW + dxPdf);
      positionOverlayEl(el, img.x, img.y - (newW * ratio - origH), newW, newW * ratio);
    }
    function onUp(ev) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const rect = pageCanvas.getBoundingClientRect();
      const dxCss = ev.clientX - startX;
      const dxPdf = (dxCss / rect.width) * currentPageObj.getViewport({ scale: 1 }).width;
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
  input.style.top = (cssPos.y - 10) + "px";
  previewWrap.appendChild(input);
  input.focus();
  function commit() {
    const val = input.value;
    if (input.parentNode) input.parentNode.removeChild(input);
    if (!val) return;
    withHistory(currentPageIndex, (pe) => pe.annotations.push({ type: "newtext", x: p[0], y: p[1], text: val, size: 14, color: INK }));
  }
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); input.blur(); } if (ev.key === "Escape") { input.value = ""; input.blur(); } });
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
      const blocks = groupIntoBlocks(content.items, content.styles);
      data = { items: content.items, styles: content.styles, blocks };
      pageTextCache.set(i, data);
    }
    data.blocks.forEach((b) => { if (b.text.toLowerCase().includes(lower)) searchMatches.push({ pageIndex: i, blockId: b.id }); });
  }
  searchIndex = searchMatches.length ? 0 : -1;
  updateSearchCount();
  if (searchIndex >= 0) jumpToSearchMatch();
}
function updateSearchCount() {
  document.getElementById("searchCount").textContent = searchMatches.length ? (searchIndex + 1) + " / " + searchMatches.length : "Aucun résultat";
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
    const block = data.blocks.find((b) => b.id === m.blockId);
    if (!block) continue;
    const edits = getPageEdits(m.pageIndex);
    const existing = edits.textEdits.find((t) => t.blockId === block.id);
    const currentText = existing ? existing.text : block.text;
    const newText = currentText.replace(new RegExp(escapeRegExp(term), "gi"), replacement);
    withHistory(m.pageIndex, (pe) => {
      const idx = pe.textEdits.findIndex((t) => t.blockId === block.id);
      const bgColor = existing ? existing.bgColor : sampleBackgroundColor(block);
      const record = Object.assign({ blockId: block.id, fontSize: block.fontSize, fontFamily: block.fontFamily, bold: block.bold, italic: block.italic, color: INK, x: block.x, y: block.y, baseline: block.baseline, width: block.width, height: block.height }, existing || {}, { text: newText, bgColor });
      if (idx >= 0) pe.textEdits[idx] = record; else pe.textEdits.push(record);
    });
  }
  showMsg("Remplacement effectué dans " + searchMatches.length + " ligne(s).");
});
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

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
  else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); }
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

// ---------- Enregistrement final ----------
saveBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  saveBtn.disabled = true;
  try {
    setProgress(5, "Chargement du document…");
    const { PDFDocument, rgb } = PDFLib;
    const doc = await PDFDocument.load(srcBytes);
    doc.registerFontkit(window.fontkit);

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
      setProgress(5 + Math.round(((n + 1) / Math.max(1, pageIndices.length)) * 80), "Application des modifications, page " + (pageIndex + 1) + "…");
      const page = pages[pageIndex];
      const edits = getPageEdits(pageIndex);

      for (const t of edits.textEdits) {
        const bg = t.bgColor || { r: 1, g: 1, b: 1 };
        const w = t.width || 100, h = t.height || (t.fontSize * 1.3);
        page.drawRectangle({ x: t.x - 1, y: t.y - 1, width: w + 2, height: h + 2, color: rgb(bg.r, bg.g, bg.b) });
        if (t.deleted || !t.text) continue;
        const font = await getEmbeddedFont(t.fontFamily || "sans", !!t.bold, !!t.italic);
        const color = t.color || INK;
        wrapAndDrawText(page, font, t.text, t.x, t.baseline != null ? t.baseline : t.y, w, t.fontSize, rgb(color.r, color.g, color.b));
      }

      const textData = pageTextCache.get(pageIndex);
      for (const deco of edits.decorations) {
        const block = textData ? textData.blocks.find((b) => b.id === deco.blockId) : null;
        if (!block) continue;
        const y = deco.type === "strikethrough" ? block.baseline + block.height * 0.28 : block.baseline - block.height * 0.08;
        page.drawLine({ start: { x: block.x, y }, end: { x: block.x + block.width, y }, thickness: 1, color: rgb(BLUE.r, BLUE.g, BLUE.b) });
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
