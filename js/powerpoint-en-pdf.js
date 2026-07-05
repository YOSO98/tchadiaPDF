/* tchadiaPdf : PowerPoint en PDF */

const MAX_SIZE = 40 * 1024 * 1024; // 40 Mo
const MAX_BATCH_FILES = 20;
const RENDER_PX_W = 960; // largeur de rendu hors écran, avant rasterisation

let currentFile = null;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
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

function isPptxFile(file) {
  return (
    file.name.toLowerCase().endsWith(".pptx") ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

function hasZipSignature(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  return b.length > 2 && b[0] === 0x50 && b[1] === 0x4b; // "PK"
}

/** Attend que toutes les images d'un conteneur soient chargées avant la rasterisation. */
function waitForImages(container) {
  const imgs = Array.from(container.querySelectorAll("img"));
  return Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    })
  );
}

function relsPathFor(slidePath) {
  const parts = slidePath.split("/");
  const file = parts.pop();
  return parts.join("/") + "/_rels/" + file + ".rels";
}

/** Résout un chemin cible relatif (rels) par rapport au chemin d'un fichier de base. */
function resolveRelTarget(basePath, target) {
  const baseParts = basePath.split("/");
  baseParts.pop();
  target.split("/").forEach((part) => {
    if (part === "..") baseParts.pop();
    else if (part === "." || part === "") { /* ignore */ }
    else baseParts.push(part);
  });
  return baseParts.join("/");
}

function parseRelationships(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const map = {};
  Array.from(doc.getElementsByTagName("Relationship")).forEach((r) => {
    map[r.getAttribute("Id")] = r.getAttribute("Target");
  });
  return map;
}

/** Cherche un <a:xfrm> (position/taille en EMU), qu'il soit sous <p:spPr> ou direct sous <p:xfrm>. */
function getXfrm(node) {
  let xfrmEl = null;
  const spPr = Array.from(node.childNodes).find(
    (c) => c.nodeType === 1 && (c.tagName === "p:spPr" || c.tagName === "p:grpSpPr")
  );
  if (spPr) {
    xfrmEl = Array.from(spPr.childNodes).find((c) => c.nodeType === 1 && c.tagName === "a:xfrm");
  }
  if (!xfrmEl) {
    xfrmEl = Array.from(node.childNodes).find((c) => c.nodeType === 1 && c.tagName === "p:xfrm");
  }
  if (!xfrmEl) return null;
  const off = xfrmEl.getElementsByTagName("a:off")[0];
  const ext = xfrmEl.getElementsByTagName("a:ext")[0];
  if (!off || !ext) return null;
  return {
    x: parseInt(off.getAttribute("x"), 10) || 0,
    y: parseInt(off.getAttribute("y"), 10) || 0,
    cx: parseInt(ext.getAttribute("cx"), 10) || 0,
    cy: parseInt(ext.getAttribute("cy"), 10) || 0,
  };
}

function extractAllText(node) {
  return Array.from(node.getElementsByTagName("a:t"))
    .map((t) => t.textContent)
    .join(" ");
}

/** true si la forme a une géométrie visible (rectangle, ellipse...) mais aucun texte : élément visuel non restitué. */
function isNonEmptyDecorativeShape(node) {
  if (node.getElementsByTagName("p:ph")[0]) return false;
  return !!node.getElementsByTagName("a:prstGeom")[0];
}

/** Convertit une forme <p:sp> en descripteur de texte, ou null si vide et non significative. */
function parseShapeSp(node) {
  const ph = node.getElementsByTagName("p:ph")[0];
  const phType = ph ? ph.getAttribute("type") || "body" : null;
  const xfrm = getXfrm(node);

  const txBody = node.getElementsByTagName("p:txBody")[0];
  const paragraphs = [];
  if (txBody) {
    Array.from(txBody.getElementsByTagName("a:p")).forEach((p) => {
      const text = Array.from(p.getElementsByTagName("a:t"))
        .map((t) => t.textContent)
        .join("");
      if (text.trim() === "") return;
      const pPr = p.getElementsByTagName("a:pPr")[0];
      const lvl = pPr ? parseInt(pPr.getAttribute("lvl") || "0", 10) : 0;
      const rPr = p.getElementsByTagName("a:rPr")[0];
      const bold = rPr ? rPr.getAttribute("b") === "1" : false;
      const szAttr = rPr ? rPr.getAttribute("sz") : null;
      const sz = szAttr ? parseInt(szAttr, 10) / 100 : null;
      paragraphs.push({ text, lvl, bold, sz });
    });
  }

  if (paragraphs.length === 0) return null;
  return { type: "text", xfrm, category: phType, paragraphs };
}

function parseShapePic(node) {
  const xfrm = getXfrm(node);
  const blip = node.getElementsByTagName("a:blip")[0];
  const embedId = blip ? blip.getAttribute("r:embed") : null;
  if (!embedId) return null;
  return { type: "image", xfrm, embedId };
}

/** Attribue une position par défaut (approximative) aux textes de titre/contenu sans coordonnées explicites. */
function applyFallbackPositions(shapes, cx, cy) {
  shapes.forEach((s) => {
    if (s.xfrm) return;
    if (s.type === "text") {
      if (s.category === "title" || s.category === "ctrTitle") {
        s.xfrm = { x: cx * 0.07, y: cy * 0.05, cx: cx * 0.86, cy: cy * 0.2 };
      } else {
        s.xfrm = { x: cx * 0.07, y: cy * 0.27, cx: cx * 0.86, cy: cy * 0.65 };
      }
    } else if (s.type === "image") {
      s.xfrm = { x: cx * 0.25, y: cy * 0.25, cx: cx * 0.5, cy: cy * 0.5 };
    }
  });
}

/** Résout les images (embedId -> data URL base64) utilisées par les formes d'une diapositive. */
async function resolveImagesForShapes(zip, slidePath, slideRelMap, shapes) {
  const map = {};
  for (const s of shapes) {
    if (s.type === "image" && s.embedId && !map[s.embedId]) {
      const target = slideRelMap[s.embedId];
      if (!target) continue;
      const mediaPath = resolveRelTarget(slidePath, target);
      const file = zip.file(mediaPath);
      if (!file) continue;
      const base64 = await file.async("base64");
      const ext = mediaPath.split(".").pop().toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : "image/jpeg";
      map[s.embedId] = "data:" + mime + ";base64," + base64;
    }
  }
  return map;
}

/** Construit le conteneur hors écran d'une diapositive à partir des formes extraites. */
function buildSlideContainer(cx, cy, shapes, imagesMap, pxPerEmu) {
  const container = document.createElement("div");
  container.className = "slide-render";
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = Math.round(cx * pxPerEmu) + "px";
  container.style.height = Math.round(cy * pxPerEmu) + "px";
  document.body.appendChild(container);

  shapes.forEach((s) => {
    if (!s.xfrm) return;
    const box = document.createElement("div");
    box.className = "shape-box";
    box.style.left = Math.round(s.xfrm.x * pxPerEmu) + "px";
    box.style.top = Math.round(s.xfrm.y * pxPerEmu) + "px";
    box.style.width = Math.round(s.xfrm.cx * pxPerEmu) + "px";
    box.style.height = Math.round(s.xfrm.cy * pxPerEmu) + "px";

    if (s.type === "image") {
      const src = imagesMap[s.embedId];
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        box.appendChild(img);
      }
    } else if (s.type === "text") {
      const isTitle = s.category === "title" || s.category === "ctrTitle";
      s.paragraphs.forEach((p) => {
        const pEl = document.createElement("p");
        pEl.textContent = p.text;
        pEl.style.marginLeft = p.lvl * 16 + "px";
        if (p.bold || isTitle) pEl.style.fontWeight = "700";
        if (isTitle) pEl.classList.add("shape-title");
        const fontSizePt = p.sz || (isTitle ? 28 : 18);
        pEl.style.fontSize = Math.max(6, Math.round(fontSizePt * 12700 * pxPerEmu)) + "px";
        box.appendChild(pEl);
      });
    }
    container.appendChild(box);
  });

  return container;
}

/** Convertit un fichier PPTX (ArrayBuffer) en PDF, une page par diapositive. */
async function convertPptxToPdf(arrayBuffer, onProgress) {
  if (!hasZipSignature(arrayBuffer)) {
    throw new Error("Ce fichier ne semble pas être une présentation PowerPoint valide.");
  }

  const zip = await JSZip.loadAsync(arrayBuffer);
  const presFile = zip.file("ppt/presentation.xml");
  if (!presFile) throw new Error("Ce fichier ne semble pas être une présentation PowerPoint valide.");

  const presXml = await presFile.async("text");
  const presDoc = new DOMParser().parseFromString(presXml, "application/xml");
  if (presDoc.getElementsByTagName("parsererror").length) {
    throw new Error("Le fichier de présentation est illisible.");
  }

  const sldSzEl = presDoc.getElementsByTagName("p:sldSz")[0];
  const cx = sldSzEl ? parseInt(sldSzEl.getAttribute("cx"), 10) : 9144000;
  const cy = sldSzEl ? parseInt(sldSzEl.getAttribute("cy"), 10) : 6858000;

  const relsFile = zip.file("ppt/_rels/presentation.xml.rels");
  const relMap = relsFile ? parseRelationships(await relsFile.async("text")) : {};

  const sldIdEls = Array.from(presDoc.getElementsByTagName("p:sldId"));
  const slidePaths = sldIdEls
    .map((el) => el.getAttribute("r:id"))
    .filter((rId) => rId && relMap[rId])
    .map((rId) => "ppt/" + relMap[rId].replace(/^\.\//, ""));

  if (slidePaths.length === 0) throw new Error("Aucune diapositive trouvée dans ce fichier.");

  const pxPerEmu = RENDER_PX_W / cx;
  const pdfW = cx / 12700;
  const pdfH = cy / 12700;

  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const simplifiedSlides = [];

  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;
    const xmlText = await slideFile.async("text");
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      simplifiedSlides.push(i + 1);
      continue;
    }

    const relsPath = relsPathFor(slidePath);
    const slideRelsFile = zip.file(relsPath);
    const slideRelMap = slideRelsFile ? parseRelationships(await slideRelsFile.async("text")) : {};

    const spTree = doc.getElementsByTagName("p:spTree")[0];
    const shapes = [];
    let hasUnsupported = false;

    if (spTree) {
      Array.from(spTree.childNodes).forEach((node) => {
        if (node.nodeType !== 1) return;
        const tag = node.tagName;
        if (tag === "p:sp") {
          const shape = parseShapeSp(node);
          if (shape) shapes.push(shape);
          else if (isNonEmptyDecorativeShape(node)) hasUnsupported = true;
        } else if (tag === "p:pic") {
          const pic = parseShapePic(node);
          if (pic) shapes.push(pic);
        } else if (tag === "p:graphicFrame" || tag === "p:grpSp") {
          hasUnsupported = true;
          const text = extractAllText(node).trim();
          if (text) {
            shapes.push({ type: "text", xfrm: getXfrm(node), category: "body", paragraphs: [{ text, lvl: 0, bold: false, sz: null }] });
          }
        }
        // p:cxnSp (connecteurs/lignes) : purement décoratif, ignoré silencieusement.
      });
    }

    applyFallbackPositions(shapes, cx, cy);
    const imagesMap = await resolveImagesForShapes(zip, slidePath, slideRelMap, shapes);
    const container = buildSlideContainer(cx, cy, shapes, imagesMap, pxPerEmu);

    let bytes;
    try {
      await waitForImages(container);
      const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      bytes = new Uint8Array(await blob.arrayBuffer());
    } finally {
      document.body.removeChild(container);
    }

    const img = await pdfDoc.embedJpg(bytes);
    const page = pdfDoc.addPage([pdfW, pdfH]);
    page.drawImage(img, { x: 0, y: 0, width: pdfW, height: pdfH });

    if (hasUnsupported) simplifiedSlides.push(i + 1);
    if (onProgress) onProgress(i + 1, slidePaths.length);
  }

  return { bytes: await pdfDoc.save(), simplifiedSlides, totalSlides: slidePaths.length };
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

  if (!isPptxFile(file)) {
    showMsg("Veuillez choisir un fichier PowerPoint au format .pptx.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 40 Mo. Choisissez un fichier plus léger.");
    return;
  }

  currentFile = file;
  fileName.textContent = file.name;
  fileMeta.textContent = fmtSize(file.size);
  fileInfo.classList.add("visible");
  convertBtn.disabled = false;
}

convertBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;

  try {
    setProgress(5, "Lecture du fichier...");
    const arrayBuffer = await readAsArrayBuffer(currentFile);
    setProgress(10, "Analyse de la présentation...");
    const { bytes, simplifiedSlides } = await convertPptxToPdf(arrayBuffer, (p, total) => {
      setProgress(10 + Math.round((p / total) * 85), "Diapositive " + p + " / " + total);
    });
    setProgress(100, "Terminé");
    hideProgress();
    const baseName = currentFile.name.replace(/\.pptx$/i, "");
    offerDownload(bytes, "tchadiapdf-" + baseName + ".pdf", "application/pdf");
    if (simplifiedSlides.length > 0) {
      showMsg(
        "Conversion terminée. La ou les diapositive(s) n° " +
          simplifiedSlides.join(", ") +
          " contenaient des éléments non pris en charge (graphiques natifs, tableaux natifs, SmartArt ou formes décoratives) qui ont été simplifiés."
      );
    }
  } catch (e) {
    hideProgress();
    showMsg("Impossible de convertir ce fichier. Vérifiez qu'il s'agit bien d'un fichier .pptx valide et non protégé par un mot de passe.");
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
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: file.name.replace(/\.pptx$/i, "").replace(/[\/\\]/g, "_"),
    status: "attente",
    error: null,
    bytes: null,
  }));

  batchQueue.forEach((entry) => {
    if (!isPptxFile(entry.file)) {
      entry.status = "erreur";
      entry.error = "Ce n'est pas un fichier .pptx.";
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
      const arrayBuffer = await readAsArrayBuffer(entry.file);
      const { bytes } = await convertPptxToPdf(arrayBuffer, (p, totalSlides) => {
        setProgress(
          Math.round((p / totalSlides) * 100),
          "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name + ", diapositive " + p + " / " + totalSlides
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
      offerDownload(zipBlob, "tchadiapdf-presentations.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
