/* tchadiaPdf : PDF en Word (reconstruction d'un DOCX à partir du texte et des images d'un PDF) */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const MAX_BATCH_FILES = 20;
// Protection contre un PDF "bombe" (des dizaines de milliers de pages) qui gèlerait l'onglet :
// cet outil lit le texte ET reconstruit les images de chaque page, coût non négligeable par page.
const MAX_PAGES = 3000;

let srcBytes = null;
let currentFile = null;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
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

/* ===================== Regroupement du texte en lignes ===================== */

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

/** Détecte des positions de colonnes récurrentes sur un ensemble de lignes (tolérance de quelques points). */
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

/** Découpe les lignes d'une page en blocs "table" (au moins 3 lignes à 2 colonnes ou plus) ou "line" (paragraphe). */
function buildBlocksForPage(lines) {
  const boundaries = detectColumnBoundaries(lines);
  if (!boundaries) return lines.map((l) => ({ type: "line", line: l }));

  const marked = lines.map((l) => {
    if (!l.text.trim()) return { type: "line", line: l };
    const cells = splitLineByBoundaries(l, boundaries);
    const nonEmpty = cells.filter((c) => c).length;
    return nonEmpty >= 2 ? { type: "row", cells, line: l } : { type: "line", line: l };
  });

  const blocks = [];
  let i = 0;
  while (i < marked.length) {
    if (marked[i].type === "row") {
      let j = i;
      while (j < marked.length && marked[j].type === "row") j++;
      if (j - i >= 3) {
        blocks.push({ type: "table", rows: marked.slice(i, j).map((m) => m.cells) });
      } else {
        for (let k = i; k < j; k++) blocks.push({ type: "line", line: marked[k].line });
      }
      i = j;
    } else {
      blocks.push({ type: "line", line: marked[i].line });
      i++;
    }
  }
  return blocks;
}

function classifyLine(line, median) {
  const t = line.text.trim();
  if (!t) return { kind: "empty" };
  const ratio = median > 0 ? line.fontSize / median : 1;
  if (ratio > 1.6) return { kind: "h1" };
  if (ratio > 1.3) return { kind: "h2" };
  if (/^[•\-\*]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) return { kind: "bullet" };
  return { kind: "p" };
}

/* ===================== Extraction des images embarquées, réparties par page ===================== */
/* Technique reprise de js/extraire-images-pdf.js : lecture directe des flux /Subtype /Image via pdf-lib. */

async function inflateBytes(bytes) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function extractOneImageBytes(obj, PDFName) {
  const filterObj = obj.dict.lookup(PDFName.of("Filter"));
  let filterNames = [];
  if (filterObj) {
    if (typeof filterObj.asArray === "function") {
      filterNames = filterObj.asArray().map((f) => (f && f.toString ? f.toString() : ""));
    } else if (filterObj.toString) {
      filterNames = [filterObj.toString()];
    }
  }

  if (filterNames.length === 1 && filterNames[0] === "/DCTDecode") {
    return { bytes: obj.contents, ext: "jpg" };
  }

  const isRawOrFlate = filterNames.length === 0 || (filterNames.length === 1 && filterNames[0] === "/FlateDecode");
  if (!isRawOrFlate) return null;

  const colorSpaceObj = obj.dict.lookup(PDFName.of("ColorSpace"));
  const bpcObj = obj.dict.lookup(PDFName.of("BitsPerComponent"));
  const widthObj = obj.dict.lookup(PDFName.of("Width"));
  const heightObj = obj.dict.lookup(PDFName.of("Height"));
  if (!colorSpaceObj || !bpcObj || !widthObj || !heightObj) return null;

  const colorSpaceName = colorSpaceObj.toString ? colorSpaceObj.toString() : "";
  const bpc = typeof bpcObj.asNumber === "function" ? bpcObj.asNumber() : NaN;
  const width = typeof widthObj.asNumber === "function" ? widthObj.asNumber() : NaN;
  const height = typeof heightObj.asNumber === "function" ? heightObj.asNumber() : NaN;
  if (bpc !== 8 || !width || !height) return null;

  let channels;
  if (colorSpaceName === "/DeviceRGB") channels = 3;
  else if (colorSpaceName === "/DeviceGray") channels = 1;
  else return null;

  let raw = obj.contents;
  if (filterNames.length === 1 && filterNames[0] === "/FlateDecode") {
    if (typeof DecompressionStream === "undefined") return null;
    raw = await inflateBytes(raw);
  }

  const expectedLength = width * height * channels;
  if (raw.length < expectedLength) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;
  if (channels === 3) {
    for (let p = 0; p < width * height; p++) {
      data[p * 4] = raw[p * 3];
      data[p * 4 + 1] = raw[p * 3 + 1];
      data[p * 4 + 2] = raw[p * 3 + 2];
      data[p * 4 + 3] = 255;
    }
  } else {
    for (let p = 0; p < width * height; p++) {
      const v = raw[p];
      data[p * 4] = v; data[p * 4 + 1] = v; data[p * 4 + 2] = v; data[p * 4 + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, ext: "png", width, height };
}

function sameRef(a, b) {
  return a && b && typeof a.objectNumber === "number" && a.objectNumber === b.objectNumber && a.generationNumber === b.generationNumber;
}

/** Extrait les images embarquées et tente de les rattacher à la page qui les référence (via Resources/XObject). */
async function extractImagesByPage(bytes, numPages) {
  const byPage = [];
  for (let i = 0; i < numPages; i++) byPage.push([]);

  let doc;
  try {
    const { PDFDocument } = PDFLib;
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return byPage; // Document illisible par pdf-lib : on continue sans images plutôt que d'échouer toute la conversion.
  }

  const { PDFName, PDFRawStream } = PDFLib;
  const pages = doc.getPages();
  const candidates = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.lookup(PDFName.of("Subtype"));
    if (!subtype || subtype.toString() !== "/Image") continue;
    candidates.push({ ref, obj });
  }

  for (const cand of candidates) {
    let assignedPage = -1;
    for (let i = 0; i < pages.length; i++) {
      try {
        const resources = pages[i].node.Resources ? pages[i].node.Resources() : null;
        if (!resources) continue;
        const xobj = resources.lookup(PDFName.of("XObject"));
        if (!xobj || typeof xobj.entries !== "function") continue;
        let matched = false;
        for (const [, val] of xobj.entries()) {
          if (sameRef(val, cand.ref)) { matched = true; break; }
        }
        if (matched) { assignedPage = i; break; }
      } catch (e) { /* page sans ressources exploitables : on l'ignore */ }
    }
    let found;
    try {
      found = await extractOneImageBytes(cand.obj, PDFName);
    } catch (e) {
      found = null;
    }
    if (!found) continue;
    if (assignedPage >= 0) byPage[assignedPage].push(found);
    else byPage[numPages - 1].push(found); // Image non rattachée avec certitude : placée en fin de dernière page plutôt qu'ignorée.
  }
  return byPage;
}

/* ===================== Construction du document DOCX ===================== */

function paragraphForLine(line, median) {
  const info = classifyLine(line, median);
  const t = line.text.trim();
  if (info.kind === "h1") {
    return new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun(t)] });
  }
  if (info.kind === "h2") {
    return new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: [new docx.TextRun(t)] });
  }
  if (info.kind === "bullet") {
    const cleaned = t.replace(/^[•\-\*]\s+/, "").replace(/^\d+[.)]\s+/, "");
    return new docx.Paragraph({ bullet: { level: 0 }, children: [new docx.TextRun(cleaned)] });
  }
  return new docx.Paragraph({ children: [new docx.TextRun(t)], spacing: { after: 120 } });
}

function tableForRows(rows) {
  const colCount = Math.max.apply(null, rows.map((r) => r.length));
  const docxRows = rows.map((r) => {
    const cells = [];
    for (let c = 0; c < colCount; c++) {
      cells.push(new docx.TableCell({
        children: [new docx.Paragraph(r[c] || "")],
        width: { size: Math.round(9000 / colCount), type: docx.WidthType.DXA },
      }));
    }
    return new docx.TableRow({ children: cells });
  });
  return new docx.Table({ rows: docxRows, width: { size: 9000, type: docx.WidthType.DXA } });
}

async function buildDocxFromPdf(bytes, onProgress) {
  // Validation par octets magiques : indépendante du nom de fichier ou du type MIME du navigateur.
  const sniffed = sniffFileType(bytes);
  if (sniffed !== "pdf") {
    throw new Error("Ce fichier ne semble pas être un PDF valide (contenu détecté : " + sniffed + ").");
  }

  const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const numPages = pdfDoc.numPages;
  const pagesLimit = enforceLimits({ pageCount: numPages, maxPages: MAX_PAGES });
  if (!pagesLimit.ok) throw new Error(pagesLimit.message);

  const pagesLines = [];
  const allFontSizes = [];
  for (let p = 1; p <= numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    const lines = buildLines(content.items);
    pagesLines.push(lines);
    lines.forEach((l) => { if (l.text.trim()) allFontSizes.push(l.fontSize); });
    if (onProgress) onProgress(p, numPages * 2, "Lecture du texte, page " + p + " / " + numPages);
  }
  allFontSizes.sort((a, b) => a - b);
  const median = allFontSizes.length ? allFontSizes[Math.floor(allFontSizes.length / 2)] : 11;

  const imagesByPage = await extractImagesByPage(bytes, numPages);

  const children = [];
  for (let p = 0; p < numPages; p++) {
    if (onProgress) onProgress(numPages + p + 1, numPages * 2, "Construction du document, page " + (p + 1) + " / " + numPages);
    const lines = pagesLines[p];
    const blocks = buildBlocksForPage(lines);
    for (const block of blocks) {
      if (block.type === "table") {
        children.push(tableForRows(block.rows));
        children.push(new docx.Paragraph({ children: [] }));
      } else if (block.line.text.trim()) {
        children.push(paragraphForLine(block.line, median));
      }
    }
    for (const img of imagesByPage[p]) {
      try {
        const maxWidthEmu = 500;
        const ratio = img.height / img.width;
        const w = Math.min(maxWidthEmu, img.width);
        const h = w * ratio;
        children.push(new docx.Paragraph({
          alignment: docx.AlignmentType.CENTER,
          children: [new docx.ImageRun({ type: img.ext === "jpg" ? "jpg" : "png", data: img.bytes, transformation: { width: w, height: h } })],
        }));
      } catch (e) { /* image non insérable (format inattendu) : on continue sans elle */ }
    }
  }
  if (children.length === 0) {
    children.push(new docx.Paragraph({ children: [new docx.TextRun("")] }));
  }

  const doc = new docx.Document({ sections: [{ children }] });
  return await docx.Packer.toBlob(doc);
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

    const sniffed = sniffFileType(srcBytes);
    if (sniffed !== "pdf") {
      hideProgress();
      srcBytes = null;
      showMsg("Ce fichier ne semble pas être un PDF valide (contenu détecté : " + sniffed + ").");
      return;
    }

    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;

    const pagesLimit = enforceLimits({ pageCount: pdf.numPages, maxPages: MAX_PAGES });
    if (!pagesLimit.ok) {
      hideProgress();
      srcBytes = null;
      showMsg(pagesLimit.message);
      return;
    }

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
  convertBtn.disabled = true;

  try {
    setProgress(0, "Ouverture du PDF…");
    const blob = await buildDocxFromPdf(srcBytes, (i, total, label) => {
      setProgress(Math.round((i / total) * 100), label);
    });
    hideProgress();
    const baseName = (currentFile ? currentFile.name.replace(/\.pdf$/i, "") : "document").replace(/[\/\\]/g, "_");
    offerDownload(blob, "tchadiapdf-" + baseName + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
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
      const blob = await buildDocxFromPdf(bytes, (i, totalSteps, label) => {
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
      offerDownload(only.blob, "tchadiapdf-" + only.baseName + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } else {
      setProgress(0, "Génération de l'archive ZIP du lot...");
      const zip = new JSZip();
      succeeded.forEach((entry) => {
        zip.file(entry.baseName + ".docx", entry.blob);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(Math.round(meta.percent), "Génération de l'archive ZIP du lot...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-documents-word-lot.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
