/* tchadiaPdf : Pièces jointes PDF (lister, extraire, ajouter, supprimer les fichiers embarqués) */

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 Mo
const MAX_ATTACH_SIZE = 50 * 1024 * 1024; // 50 Mo par fichier joint

let srcBytes = null;
let currentFile = null;
let existing = []; // pièces jointes déjà présentes dans le PDF chargé
let added = []; // fichiers à joindre lors de l'enregistrement
let addedSeq = 0;

const fileInfo = document.getElementById("fileInfo");
const fileNameEl = document.getElementById("fileName");
const fileMetaEl = document.getElementById("fileMeta");
const pjPanel = document.getElementById("pjPanel");
const pjTitle = document.getElementById("pjTitle");
const pjEmpty = document.getElementById("pjEmpty");
const pjList = document.getElementById("pjList");
const pjAddList = document.getElementById("pjAddList");
const extractAllBtn = document.getElementById("extractAllBtn");
const addDropzone = document.getElementById("addDropzone");
const addInput = document.getElementById("addInput");
const saveBtn = document.getElementById("saveBtn");
const resultEl = document.getElementById("result");
const resultText = document.getElementById("resultText");

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

/* ------------------------------------------------------------------ */
/* Chargement du PDF                                                   */
/* ------------------------------------------------------------------ */

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");
  const file = newFiles[0];

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_PDF_SIZE) {
    showMsg("Ce fichier dépasse la limite de 100 Mo. Choisissez un PDF plus léger.");
    return;
  }

  try {
    setProgress(10, "Lecture du fichier…");
    const bytes = new Uint8Array(await readAsArrayBuffer(file));

    if (sniffFileType(bytes) !== "pdf") {
      hideProgress();
      resetState();
      showMsg("Ce fichier n'est pas un PDF valide (sa signature interne ne correspond pas à un PDF).");
      return;
    }

    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      const details = (err && err.message ? err.message : "").toLowerCase();
      hideProgress();
      resetState();
      if (details.indexOf("encrypt") !== -1) {
        showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant de gérer ses pièces jointes.");
      } else {
        showMsg("Ce fichier est corrompu ou n'est pas un PDF valide.");
      }
      return;
    }

    setProgress(40, "Recherche des pièces jointes…");
    const entries = collectAttachments(doc);
    setProgress(70, "Lecture du contenu des pièces jointes…");
    await fillContents(bytes, entries);

    srcBytes = bytes;
    currentFile = file;
    existing = entries;
    added = [];

    const numPages = doc.getPageCount();
    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = fmtSize(file.size) + " · " + numPages + (numPages > 1 ? " pages" : " page");
    fileInfo.classList.add("visible");
    pjPanel.classList.add("visible");
    renderLists();
    hideProgress();
  } catch (e) {
    hideProgress();
    resetState();
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
});

function resetState() {
  srcBytes = null;
  currentFile = null;
  existing = [];
  added = [];
  fileInfo.classList.remove("visible");
  pjPanel.classList.remove("visible");
  pjList.innerHTML = "";
  pjAddList.innerHTML = "";
  saveBtn.disabled = true;
}

/* ------------------------------------------------------------------ */
/* Lecture bas niveau (pdf-lib) : arbre /EmbeddedFiles et annotations  */
/* ------------------------------------------------------------------ */

function textOf(obj) {
  if (!obj) return "";
  if (typeof obj.decodeText === "function") {
    try {
      return obj.decodeText();
    } catch (e) {
      return obj.toString ? obj.toString() : "";
    }
  }
  return obj.toString ? obj.toString() : "";
}

/** Convertit une date PDF ("D:AAAAMMJJHHmmSS+HH'mm'") en Date, ou null. */
function parsePdfDate(str) {
  if (!str) return null;
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(str.trim());
  if (!m) return null;
  const year = +m[1];
  const month = m[2] ? +m[2] - 1 : 0;
  const day = m[3] ? +m[3] : 1;
  const hour = m[4] ? +m[4] : 0;
  const min = m[5] ? +m[5] : 0;
  const sec = m[6] ? +m[6] : 0;
  let ts = Date.UTC(year, month, day, hour, min, sec);
  if (m[7] === "+" || m[7] === "-") {
    const offset = ((+m[8] || 0) * 60 + (+m[9] || 0)) * 60000;
    ts += m[7] === "+" ? -offset : offset;
  } else if (!m[7]) {
    // Sans fuseau indiqué : heure locale
    ts = new Date(year, month, day, hour, min, sec).getTime();
  }
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  return d ? dateFormatter.format(d) : "";
}

/** Parcourt récursivement un arbre de noms et renvoie ses couples { key, value } à plat. */
function flattenNameTree(ctx, nodeObj, out, depth) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  depth = depth || 0;
  if (depth > 32) return out;
  const node = ctx.lookup(nodeObj);
  if (!(node instanceof PDFDict)) return out;
  const names = node.lookup(PDFName.of("Names"));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      out.push({ key: textOf(names.lookup(i)), value: names.get(i + 1) });
    }
  }
  const kids = node.lookup(PDFName.of("Kids"));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) flattenNameTree(ctx, kids.get(i), out, depth + 1);
  }
  return out;
}

/** Identité stable d'un descripteur de fichier (réf. indirecte ou, à défaut, clé + nom). */
function specIdentity(specObj, key, name) {
  const { PDFRef } = PDFLib;
  if (specObj instanceof PDFRef) return "ref:" + specObj.toString();
  return "direct:" + key + "|" + name;
}

/** Lit un dictionnaire /Filespec : nom, description, flux embarqué et ses paramètres. */
function readFileSpec(ctx, specObj, fallbackName) {
  const { PDFName, PDFDict, PDFRef, PDFStream, PDFNumber } = PDFLib;
  const spec = ctx.lookup(specObj);
  if (!(spec instanceof PDFDict)) return null;

  const name = textOf(spec.lookup(PDFName.of("UF"))) || textOf(spec.lookup(PDFName.of("F"))) || fallbackName || "sans-nom";
  const desc = textOf(spec.lookup(PDFName.of("Desc")));

  const streamRefs = [];
  let stream = null;
  const ef = spec.lookup(PDFName.of("EF"));
  if (ef instanceof PDFDict) {
    ["UF", "F", "DOS", "Mac", "Unix"].forEach((k) => {
      const raw = ef.get(PDFName.of(k));
      if (raw instanceof PDFRef) streamRefs.push(raw);
      const s = ef.lookup(PDFName.of(k));
      if (!stream && s instanceof PDFStream) stream = s;
    });
  }

  let mime = "";
  let size = null;
  let creationDate = null;
  let modDate = null;
  if (stream) {
    const subtype = stream.dict.lookup(PDFName.of("Subtype"));
    if (subtype instanceof PDFName) mime = subtype.decodeText();
    const params = stream.dict.lookup(PDFName.of("Params"));
    if (params instanceof PDFDict) {
      const sz = params.lookup(PDFName.of("Size"));
      if (sz instanceof PDFNumber) size = sz.asNumber();
      creationDate = parsePdfDate(textOf(params.lookup(PDFName.of("CreationDate"))));
      modDate = parsePdfDate(textOf(params.lookup(PDFName.of("ModDate"))));
    }
  }

  return { name, desc, mime, size, creationDate, modDate, stream, streamRefs, specObj };
}

/**
 * Liste toutes les pièces jointes d'un document pdf-lib : celles de l'arbre
 * /Names /EmbeddedFiles du catalogue et celles des annotations /FileAttachment
 * des pages. Un même descripteur référencé aux deux endroits n'apparaît qu'une fois.
 */
function collectAttachments(doc) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const ctx = doc.context;
  const byIdentity = new Map();
  const out = [];

  const namesDict = doc.catalog.lookup(PDFName.of("Names"));
  if (namesDict instanceof PDFDict) {
    const efTree = namesDict.get(PDFName.of("EmbeddedFiles"));
    if (efTree) {
      flattenNameTree(ctx, efTree, []).forEach((pair) => {
        const spec = readFileSpec(ctx, pair.value, pair.key);
        if (!spec) return;
        const identity = specIdentity(pair.value, pair.key, spec.name);
        let item = byIdentity.get(identity);
        if (!item) {
          item = makeItem(spec, identity);
          byIdentity.set(identity, item);
          out.push(item);
        }
        item.nameKeys.push(pair.key);
        item.inDocument = true;
      });
    }
  }

  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) return;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = annot.lookup(PDFName.of("Subtype"));
      if (!(subtype instanceof PDFName) || subtype.decodeText() !== "FileAttachment") continue;
      const fsObj = annot.get(PDFName.of("FS"));
      if (!fsObj) continue;
      const spec = readFileSpec(ctx, fsObj, "");
      if (!spec) continue;
      const identity = specIdentity(fsObj, "annot-" + pageIndex + "-" + i, spec.name);
      let item = byIdentity.get(identity);
      if (!item) {
        item = makeItem(spec, identity);
        byIdentity.set(identity, item);
        out.push(item);
      }
      if (!item.desc) item.desc = textOf(annot.lookup(PDFName.of("Contents")));
      if (!item.modDate) item.modDate = parsePdfDate(textOf(annot.lookup(PDFName.of("M"))));
      item.annots.push({ pageIndex, annotIndex: i, annotRef: annots.get(i) });
      item.pages.push(pageIndex + 1);
    }
  });

  return out;
}

function makeItem(spec, identity) {
  return {
    identity,
    name: spec.name,
    desc: spec.desc,
    mime: spec.mime,
    size: spec.size,
    creationDate: spec.creationDate,
    modDate: spec.modDate,
    stream: spec.stream,
    streamRefs: spec.streamRefs,
    specObj: spec.specObj,
    rawContents: spec.stream && spec.stream.contents ? spec.stream.contents : null,
    nameKeys: [],
    inDocument: false,
    annots: [],
    pages: [],
    content: null,
    deleted: false,
  };
}

/**
 * Récupère les octets de chaque pièce jointe : d'abord via pdf.js (robuste
 * à tous les filtres), puis, à défaut, par décodage pdf-lib du flux brut.
 */
async function fillContents(bytes, entries) {
  const byName = new Map();
  try {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    try {
      const att = await pdf.getAttachments();
      if (att) {
        Object.keys(att).forEach((k) => {
          const a = att[k];
          if (a && a.content) pushNamed(byName, a.filename || k, a.content);
        });
      }
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const annots = await page.getAnnotations();
        annots.forEach((a) => {
          if (a.subtype === "FileAttachment" && a.file && a.file.content) {
            pushNamed(byName, a.file.filename, a.file.content);
          }
        });
      }
    } finally {
      pdf.destroy();
    }
  } catch (e) {
    // pdf.js n'a pas pu lire le document : on se rabat sur pdf-lib seul.
  }

  entries.forEach((item) => {
    const list = byName.get(item.name);
    if (list && list.length) {
      item.content = list.shift();
    } else if (item.stream && item.stream instanceof PDFLib.PDFRawStream) {
      try {
        item.content = PDFLib.decodePDFRawStream(item.stream).decode();
      } catch (e) {
        item.content = null;
      }
    }
    if (item.size == null && item.content) item.size = item.content.length;
  });
}

function pushNamed(map, name, content) {
  if (!map.has(name)) map.set(name, []);
  map.get(name).push(content instanceof Uint8Array ? content : new Uint8Array(content));
}

/* ------------------------------------------------------------------ */
/* Affichage                                                           */
/* ------------------------------------------------------------------ */

const ICON_FILE = '<svg class="pj-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

function makeButton(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn-secondary";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function describeItem(item) {
  const parts = [];
  parts.push(item.size != null ? fmtSize(item.size) : "taille inconnue");
  if (item.mime) parts.push(item.mime);
  if (item.inDocument) parts.push("document");
  if (item.pages.length) parts.push("page " + item.pages.join(", "));
  const d = item.modDate || item.creationDate;
  if (d) parts.push(fmtDate(d));
  return parts.join(" · ");
}

function renderLists() {
  pjList.innerHTML = "";
  const count = existing.length;
  pjTitle.textContent = count ? "Pièces jointes (" + count + ")" : "Pièces jointes";
  pjEmpty.hidden = count > 0;
  extractAllBtn.hidden = !existing.some((it) => it.content);

  existing.forEach((item) => {
    const li = document.createElement("li");
    li.className = "pj-item" + (item.deleted ? " pj-deleted" : "");
    li.innerHTML = ICON_FILE;

    const body = document.createElement("div");
    body.className = "pj-body";
    const name = document.createElement("span");
    name.className = "pj-name";
    name.textContent = item.name;
    body.appendChild(name);
    const meta = document.createElement("span");
    meta.className = "pj-meta";
    meta.textContent = describeItem(item);
    body.appendChild(meta);
    if (item.desc) {
      const desc = document.createElement("span");
      desc.className = "pj-desc";
      desc.textContent = item.desc;
      body.appendChild(desc);
    }
    if (item.deleted) {
      const tag = document.createElement("span");
      tag.className = "pj-tag";
      tag.textContent = "Sera supprimée à l'enregistrement";
      body.appendChild(tag);
    }
    li.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "pj-actions";
    if (item.content) {
      const extractBtn = makeButton("Extraire", () => {
        triggerDownload(item.content, safeFileName(item.name), item.mime || "application/octet-stream");
      });
      extractBtn.setAttribute("aria-label", "Extraire " + item.name);
      actions.appendChild(extractBtn);
    }
    const delBtn = makeButton(item.deleted ? "Annuler" : "Supprimer", () => {
      item.deleted = !item.deleted;
      hideMsg();
      resultEl.classList.remove("visible");
      renderLists();
    });
    delBtn.setAttribute("aria-label", (item.deleted ? "Annuler la suppression de " : "Supprimer ") + item.name);
    actions.appendChild(delBtn);
    li.appendChild(actions);
    pjList.appendChild(li);
  });

  pjAddList.innerHTML = "";
  added.forEach((item) => {
    const li = document.createElement("li");
    li.className = "pj-item";
    li.innerHTML = ICON_FILE;

    const body = document.createElement("div");
    body.className = "pj-body";
    const name = document.createElement("span");
    name.className = "pj-name";
    name.textContent = item.name;
    body.appendChild(name);
    const meta = document.createElement("span");
    meta.className = "pj-meta";
    meta.textContent = fmtSize(item.bytes.length) + " · " + item.mime + " · à ajouter";
    body.appendChild(meta);
    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.className = "pj-desc-input";
    descInput.placeholder = "Description (facultatif)";
    descInput.maxLength = 500;
    descInput.value = item.desc;
    descInput.setAttribute("aria-label", "Description de " + item.name);
    descInput.addEventListener("input", () => {
      item.desc = descInput.value;
    });
    body.appendChild(descInput);
    li.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "pj-actions";
    const rm = makeButton("Retirer", () => {
      added = added.filter((a) => a.id !== item.id);
      hideMsg();
      renderLists();
    });
    rm.setAttribute("aria-label", "Retirer " + item.name);
    actions.appendChild(rm);
    li.appendChild(actions);
    pjAddList.appendChild(li);
  });

  saveBtn.disabled = !(srcBytes && (added.length > 0 || existing.some((it) => it.deleted)));
}

function safeFileName(name) {
  const base = String(name || "fichier").split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").trim();
  return base || "fichier";
}

/** Nom tel qu'il sera écrit dans le PDF : sans antislash ni parenthèse non appariée (chaîne PDF littérale). */
function pdfSafeName(name) {
  let s = safeFileName(name).replace(/\\/g, "_");
  let depth = 0;
  let balanced = true;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) balanced = false;
  }
  if (!balanced || depth !== 0) s = s.replace(/[()]/g, "_");
  return s;
}

function triggerDownload(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ------------------------------------------------------------------ */
/* Extraction en ZIP                                                   */
/* ------------------------------------------------------------------ */

extractAllBtn.addEventListener("click", async () => {
  const items = existing.filter((it) => it.content);
  if (!items.length) return;
  hideMsg();
  extractAllBtn.disabled = true;
  try {
    setProgress(5, "Préparation de l'archive ZIP…");
    const zip = new JSZip();
    const used = new Set();
    items.forEach((it) => {
      let name = safeFileName(it.name);
      let n = 2;
      while (used.has(name)) {
        name = withSuffix(safeFileName(it.name), n++);
      }
      used.add(name);
      zip.file(name, it.content);
    });
    const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
      setProgress(5 + Math.round(meta.percent * 0.95), "Génération de l'archive ZIP…");
    });
    hideProgress();
    const base = currentFile ? currentFile.name.replace(/\.pdf$/i, "") : "pieces-jointes";
    triggerDownload(blob, "tchadiapdf-" + base + "-pieces-jointes.zip", "application/zip");
  } catch (e) {
    hideProgress();
    showMsg("La création de l'archive a échoué. Essayez d'extraire les pièces jointes une par une.");
  } finally {
    extractAllBtn.disabled = false;
  }
});

function withSuffix(name, n) {
  const dot = name.lastIndexOf(".");
  if (dot > 0) return name.slice(0, dot) + " (" + n + ")" + name.slice(dot);
  return name + " (" + n + ")";
}

/* ------------------------------------------------------------------ */
/* Ajout de fichiers                                                   */
/* ------------------------------------------------------------------ */

const MIME_BY_SNIFF = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  webp: "image/webp",
  heic: "image/heic",
  zip: "application/zip",
  ooxml: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  epub: "application/epub+zip",
  ole: "application/x-ole-storage",
};

const MIME_BY_EXT_TEXT = {
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  json: "application/json",
  svg: "image/svg+xml",
  js: "text/javascript",
  css: "text/css",
};

/** Type MIME détecté par les octets magiques, affiné par l'extension pour les fichiers texte. */
function detectMime(bytes, name) {
  const sniffed = sniffFileType(bytes);
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (sniffed === "texte") return MIME_BY_EXT_TEXT[ext] || "text/plain";
  if (sniffed === "ole") {
    if (ext === "doc") return "application/msword";
    if (ext === "xls") return "application/vnd.ms-excel";
    if (ext === "ppt") return "application/vnd.ms-powerpoint";
  }
  return MIME_BY_SNIFF[sniffed] || "application/octet-stream";
}

function uniqueAttachmentName(name) {
  const taken = new Set();
  existing.forEach((it) => {
    if (!it.deleted) taken.add(it.name);
  });
  added.forEach((it) => taken.add(it.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(withSuffix(name, n))) n++;
  return withSuffix(name, n);
}

async function addFiles(files) {
  if (!srcBytes) {
    showMsg("Chargez d'abord un PDF avant d'y joindre des fichiers.");
    return;
  }
  hideMsg();
  resultEl.classList.remove("visible");
  const notes = [];
  for (const file of files) {
    const limit = enforceLimits({ sizeBytes: file.size, maxSizeBytes: MAX_ATTACH_SIZE });
    if (!limit.ok) {
      notes.push("« " + file.name + " » dépasse 50 Mo et n'a pas été ajouté.");
      continue;
    }
    if (file.size === 0) {
      notes.push("« " + file.name + " » est vide et n'a pas été ajouté.");
      continue;
    }
    let bytes;
    try {
      bytes = new Uint8Array(await readAsArrayBuffer(file));
    } catch (e) {
      notes.push("« " + file.name + " » n'a pas pu être lu.");
      continue;
    }
    const cleanName = pdfSafeName(file.name);
    const name = uniqueAttachmentName(cleanName);
    if (name !== cleanName) notes.push("« " + cleanName + " » existe déjà : le fichier sera joint sous le nom « " + name + " ».");
    added.push({
      id: ++addedSeq,
      name,
      bytes,
      mime: detectMime(bytes, cleanName),
      desc: "",
      modDate: file.lastModified ? new Date(file.lastModified) : new Date(),
    });
  }
  renderLists();
  if (notes.length) showMsg(notes.join(" "));
}

addDropzone.addEventListener("click", () => addInput.click());
addDropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    addInput.click();
  }
});
addInput.addEventListener("change", () => {
  if (addInput.files.length) addFiles(Array.from(addInput.files));
  addInput.value = "";
});
["dragover", "dragenter"].forEach((ev) =>
  addDropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    addDropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  addDropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    addDropzone.classList.remove("dragover");
  })
);
addDropzone.addEventListener("drop", (e) => {
  const files = Array.from(e.dataTransfer.files);
  if (files.length) addFiles(files);
});

/* ------------------------------------------------------------------ */
/* Enregistrement : suppressions puis ajouts                           */
/* ------------------------------------------------------------------ */

saveBtn.addEventListener("click", async () => {
  if (!srcBytes) return;
  hideMsg();
  resultEl.classList.remove("visible");
  saveBtn.disabled = true;
  extractAllBtn.disabled = true;

  const toDelete = existing.filter((it) => it.deleted);
  const kept = existing.filter((it) => !it.deleted);

  try {
    setProgress(10, "Préparation du PDF…");
    let outBytes = await buildModifiedPdf(toDelete);

    setProgress(80, "Vérification du fichier produit…");
    let rebuilt = false;
    if (toDelete.length) {
      const ok = await verifyRemoval(outBytes, toDelete, kept);
      if (!ok) {
        setProgress(85, "Reconstruction du PDF page par page…");
        outBytes = await rebuildFromScratch(toDelete, kept);
        rebuilt = true;
        // Seules les pièces conservées dont le contenu a pu être lu sont rattachées.
        if (!(await verifyRemoval(outBytes, toDelete, kept.filter((it) => it.content)))) {
          throw new Error("verification");
        }
      }
    }

    hideProgress();
    const base = currentFile ? currentFile.name.replace(/\.pdf$/i, "") : "document";
    const bits = [];
    if (added.length) bits.push(added.length + (added.length > 1 ? " pièces jointes ajoutées" : " pièce jointe ajoutée"));
    if (toDelete.length) bits.push(toDelete.length + (toDelete.length > 1 ? " supprimées" : " supprimée"));
    resultText.textContent = "Votre PDF est prêt : " + bits.join(", ") + ".";
    offerDownload(outBytes, "tchadiapdf-" + base + "-pieces-jointes.pdf", "application/pdf");
    if (rebuilt) {
      showMsg("Le PDF a été reconstruit page par page pour garantir la disparition des pièces jointes supprimées : signets et champs de formulaire éventuels n'ont pas été conservés.");
    }
  } catch (e) {
    hideProgress();
    showMsg("L'enregistrement a échoué. Réessayez avec un autre fichier.");
  } finally {
    extractAllBtn.disabled = false;
    saveBtn.disabled = !(srcBytes && (added.length > 0 || existing.some((it) => it.deleted)));
  }
});

/** Retire les annotations « fichier joint » des entrées supprimées et efface leurs objets. */
function removeAnnotations(doc, toDelete) {
  const { PDFName, PDFDict, PDFRef, PDFArray } = PDFLib;
  const ctx = doc.context;
  const pages = doc.getPages();
  toDelete.forEach((item) => {
    item.annots.forEach((a) => {
      const page = pages[a.pageIndex];
      if (!page) return;
      const annots = page.node.Annots();
      if (!(annots instanceof PDFArray)) return;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const ref = annots.get(i);
        // Annotation indirecte : comparaison par référence ; annotation directe
        // (dictionnaire inséré dans le tableau) : même position dans le tableau.
        const same = ref instanceof PDFRef && a.annotRef instanceof PDFRef ? ref.toString() === a.annotRef.toString() : i === a.annotIndex;
        if (!same) continue;
        const annot = annots.lookup(i);
        annots.remove(i);
        if (annot instanceof PDFDict) {
          const ap = annot.lookup(PDFName.of("AP"));
          if (ap instanceof PDFDict) {
            ["N", "R", "D"].forEach((k) => {
              const apRef = ap.get(PDFName.of(k));
              if (apRef instanceof PDFRef) ctx.delete(apRef);
            });
          }
        }
        if (ref instanceof PDFRef) ctx.delete(ref);
      }
    });
  });
}

/** Retire des entrées supprimées le tableau /AF (fichiers associés) du catalogue. */
function removeFromAssociatedFiles(doc, deletedRefKeys) {
  const { PDFName, PDFArray, PDFRef } = PDFLib;
  const af = doc.catalog.lookup(PDFName.of("AF"));
  if (!(af instanceof PDFArray)) return;
  for (let i = af.size() - 1; i >= 0; i--) {
    const ref = af.get(i);
    if (ref instanceof PDFRef && deletedRefKeys.has("ref:" + ref.toString())) af.remove(i);
  }
  if (af.size() === 0) doc.catalog.delete(PDFName.of("AF"));
}

/**
 * Reconstruit l'arbre /Names /EmbeddedFiles à plat (un seul tableau /Names
 * trié), sans les entrées supprimées. Les entrées ajoutées par pdf-lib y
 * figurent déjà après flush().
 */
function rebuildEmbeddedFilesTree(doc, deletedIdentities) {
  const { PDFName, PDFDict, PDFHexString } = PDFLib;
  const ctx = doc.context;
  const namesDict = doc.catalog.lookup(PDFName.of("Names"));
  if (!(namesDict instanceof PDFDict)) return;
  const efTree = namesDict.get(PDFName.of("EmbeddedFiles"));
  if (!efTree) return;

  const pairs = flattenNameTree(ctx, efTree, []).filter((pair) => {
    const spec = readFileSpec(ctx, pair.value, pair.key);
    if (!spec) return false;
    return !deletedIdentities.has(specIdentity(pair.value, pair.key, spec.name));
  });
  pairs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (!pairs.length) {
    namesDict.delete(PDFName.of("EmbeddedFiles"));
    if (namesDict.keys().length === 0) doc.catalog.delete(PDFName.of("Names"));
    return;
  }
  const arr = ctx.obj([]);
  pairs.forEach((pair) => {
    arr.push(PDFHexString.fromText(pair.key));
    arr.push(pair.value);
  });
  namesDict.set(PDFName.of("EmbeddedFiles"), ctx.obj({ Names: arr }));
}

function deleteSpecObjects(doc, toDelete, kept) {
  const { PDFRef } = PDFLib;
  const ctx = doc.context;
  const keptStreamKeys = new Set();
  kept.forEach((it) => it.streamRefs.forEach((r) => keptStreamKeys.add(r.toString())));
  toDelete.forEach((item) => {
    item.streamRefs.forEach((r) => {
      if (!keptStreamKeys.has(r.toString())) ctx.delete(r);
    });
    if (item.specObj instanceof PDFRef) ctx.delete(item.specObj);
  });
}

async function attachAdded(doc) {
  for (const item of added) {
    await doc.attach(item.bytes, item.name, {
      mimeType: item.mime,
      description: item.desc ? item.desc.trim() : undefined,
      creationDate: new Date(),
      modificationDate: item.modDate,
    });
  }
}

async function buildModifiedPdf(toDelete) {
  const doc = await PDFLib.PDFDocument.load(srcBytes, { updateMetadata: false });
  const kept = existing.filter((it) => !it.deleted);
  const deletedIdentities = new Set(toDelete.map((it) => it.identity));

  removeAnnotations(doc, toDelete);
  removeFromAssociatedFiles(doc, deletedIdentities);

  setProgress(30, "Ajout des nouvelles pièces jointes…");
  await attachAdded(doc);
  await doc.flush();

  rebuildEmbeddedFilesTree(doc, deletedIdentities);
  deleteSpecObjects(doc, toDelete, kept);

  setProgress(60, "Enregistrement du PDF…");
  // Sans flux d'objets : chaque objet reste lisible en clair dans le fichier,
  // ce qui permet de vérifier (et à quiconque de constater) l'absence des
  // pièces jointes supprimées.
  return await doc.save({ useObjectStreams: false });
}

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Relit le PDF produit et vérifie que les pièces jointes supprimées ont
 * disparu : aucune entrée portant leur identité, et aucun flux brut dont
 * les octets soient identiques à ceux du flux supprimé (hors doublons
 * légitimement conservés).
 */
async function verifyRemoval(bytes, toDelete, kept) {
  const { PDFDocument, PDFRawStream } = PDFLib;
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return false;
  }
  const remaining = collectAttachments(doc);
  const expectedCount = kept.length + added.length;
  if (remaining.length !== expectedCount) return false;

  const streams = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) streams.push(obj.contents);
  }
  for (const item of toDelete) {
    if (!item.rawContents) continue;
    const found = streams.filter((s) => bytesEqual(s, item.rawContents)).length;
    const legit = kept.filter((k) => bytesEqual(k.rawContents, item.rawContents)).length;
    if (found > legit) return false;
  }
  return true;
}

/**
 * Dernier recours : copie page par page dans un document neuf (seuls les
 * objets réellement référencés par les pages sont copiés), puis rattache les
 * pièces jointes conservées et ajoutées.
 */
async function rebuildFromScratch(toDelete, kept) {
  const { PDFDocument } = PDFLib;
  const src = await PDFDocument.load(srcBytes, { updateMetadata: false });
  removeAnnotations(src, toDelete);

  const fresh = await PDFDocument.create();
  const copied = await fresh.copyPages(src, src.getPageIndices());
  copied.forEach((p) => fresh.addPage(p));

  const title = src.getTitle();
  const author = src.getAuthor();
  const subject = src.getSubject();
  const keywords = src.getKeywords();
  const creator = src.getCreator();
  if (title) fresh.setTitle(title);
  if (author) fresh.setAuthor(author);
  if (subject) fresh.setSubject(subject);
  if (keywords) fresh.setKeywords(keywords.split(/[,;]\s*/).filter(Boolean));
  if (creator) fresh.setCreator(creator);

  for (const item of kept) {
    if (!item.content) continue;
    await fresh.attach(item.content, item.name, {
      mimeType: item.mime || undefined,
      description: item.desc || undefined,
      creationDate: item.creationDate || undefined,
      modificationDate: item.modDate || undefined,
    });
  }
  await attachAdded(fresh);
  return await fresh.save({ useObjectStreams: false });
}
