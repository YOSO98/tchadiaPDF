/* tchadiaPdf : Métadonnées PDF (dictionnaire Info + paquet XMP)
 *
 * Affiche et modifie les métadonnées d'un PDF au niveau d'Acrobat Pro :
 * le dictionnaire /Info (Title, Author, Subject, Keywords, Creator,
 * Producer, CreationDate, ModDate) ET le paquet XMP du flux /Metadata
 * (dc:title, dc:creator, dc:description, dc:subject, xmp:CreatorTool,
 * pdf:Producer, pdf:Keywords, xmp:CreateDate, xmp:ModifyDate), écrits de
 * façon synchronisée. Les divergences Info / XMP du fichier d'origine sont
 * signalées à l'utilisateur. L'outil gère aussi la langue du document
 * (/Lang), le mode d'ouverture (/PageMode) et la mise en page (/PageLayout)
 * du catalogue.
 *
 * Point d'attention important : par défaut, PDFDocument.load() de pdf-lib
 * réécrit lui-même Producer, Creator et ModDate dès le chargement, avant
 * même qu'on affiche le formulaire, ce qui masquerait les vraies valeurs
 * d'origine du fichier. On charge donc avec
 * PDFDocument.load(bytes, { updateMetadata: false }) pour lire les valeurs
 * réellement présentes dans le fichier. Côté save(), pdf-lib n'écrase rien
 * d'autre que ce qu'on lui demande explicitement : les valeurs écrites dans
 * Info ci-dessous sont donc exactement celles du fichier produit, et le
 * paquet XMP est construit à partir des mêmes valeurs (même instant pour
 * la date de modification), ce qui garantit la cohérence Info / XMP.
 *
 * Les clés d'Info sont écrites directement (PDFHexString.fromText) plutôt
 * que via setKeywords() de pdf-lib, qui joint les mots-clés par des espaces
 * et perdrait la séparation par virgules attendue par Acrobat.
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const XMP_PADDING_BYTES = 2048;

const NS = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  dc: "http://purl.org/dc/elements/1.1/",
  xmp: "http://ns.adobe.com/xap/1.0/",
  pdf: "http://ns.adobe.com/pdf/1.3/",
  pdfaid: "http://www.aiim.org/pdfa/ns/id/",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/"
};

/* Propriétés XMP gérées par l'outil : elles sont retirées du paquet
 * d'origine puis réécrites ; toutes les autres (pdfaid, photoshop, xmpMM…)
 * sont conservées telles quelles. */
const MANAGED_XMP_PROPS = [
  [NS.dc, "title"], [NS.dc, "creator"], [NS.dc, "description"], [NS.dc, "subject"],
  [NS.xmp, "CreatorTool"], [NS.xmp, "CreateDate"], [NS.xmp, "ModifyDate"], [NS.xmp, "MetadataDate"],
  [NS.pdf, "Producer"], [NS.pdf, "Keywords"]
];

const PAGE_MODE_DEFAULT = "UseNone";
const PAGE_LAYOUT_DEFAULT = "SinglePage";

let currentFile = null;
let currentDoc = null;
let originalXmp = null; // { xml: string, ref: PDFRef|null, parsed: object|null }
let hadCatalogKey = { PageMode: false, PageLayout: false };

const fileListEl = document.getElementById("fileList");
const metaForm = document.getElementById("metaForm");
const saveBtn = document.getElementById("saveBtn");
const clearAllCheck = document.getElementById("clearAll");
const useXmpBtn = document.getElementById("useXmpBtn");
const xmpStatusEl = document.getElementById("xmpStatus");
const xmpDiffListEl = document.getElementById("xmpDiffList");

const titleInput = document.getElementById("metaTitle");
const authorInput = document.getElementById("metaAuthor");
const subjectInput = document.getElementById("metaSubject");
const keywordsInput = document.getElementById("metaKeywords");
const creatorInput = document.getElementById("metaCreator");
const producerInput = document.getElementById("metaProducer");
const creationDateInput = document.getElementById("metaCreationDate");
const modDateInput = document.getElementById("metaModDate");
const autoModDateCheck = document.getElementById("autoModDate");
const langInput = document.getElementById("metaLang");
const pageModeSelect = document.getElementById("metaPageMode");
const pageLayoutSelect = document.getElementById("metaPageLayout");

const META_INPUTS = [titleInput, authorInput, subjectInput, keywordsInput, creatorInput, producerInput, creationDateInput];

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

/** Décalage horaire local sous la forme { sign, hh, mm } pour une date donnée. */
function tzParts(date) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return { sign, hh: pad2(Math.floor(abs / 60)), mm: pad2(abs % 60) };
}

/** Date PDF : D:YYYYMMDDHHmmSS+HH'mm' (heure locale avec fuseau). */
function toPdfDate(date) {
  const tz = tzParts(date);
  return "D:" + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
    pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds()) +
    tz.sign + tz.hh + "'" + tz.mm + "'";
}

/** Date XMP : ISO 8601 YYYY-MM-DDTHH:mm:ss+HH:mm (heure locale avec fuseau). */
function toXmpDate(date) {
  const tz = tzParts(date);
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
    "T" + pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds()) +
    tz.sign + tz.hh + ":" + tz.mm;
}

/** Valeur pour un champ datetime-local (heure locale, à la seconde). */
function toInputValue(date) {
  if (!date || isNaN(date.getTime())) return "";
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
    "T" + pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds());
}

/** Lit un champ datetime-local ; renvoie null si vide ou invalide. */
function fromInputValue(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Décode une date PDF (D:…) ou ISO 8601 ; renvoie null si impossible. */
function parseAnyDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^D:/.test(s)) {
    try {
      const d = PDFLib.PDFString.of(s).decodeDate();
      return isNaN(d.getTime()) ? null : d;
    } catch (e) {
      return null;
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ */
/* Dictionnaire Info et catalogue                                      */
/* ------------------------------------------------------------------ */

function readInfoText(doc, key) {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (!info || !(info instanceof PDFLib.PDFDict)) return "";
  const val = info.lookup(PDFLib.PDFName.of(key));
  if (!val) return "";
  if (val instanceof PDFLib.PDFString || val instanceof PDFLib.PDFHexString) return val.decodeText();
  return "";
}

function readInfoDate(doc, key) {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (!info || !(info instanceof PDFLib.PDFDict)) return null;
  const val = info.lookup(PDFLib.PDFName.of(key));
  if (!val) return null;
  if (val instanceof PDFLib.PDFString || val instanceof PDFLib.PDFHexString) {
    try {
      return parseAnyDate(val.decodeText());
    } catch (e) {
      return null;
    }
  }
  return null;
}

function setInfoText(info, key, value) {
  const name = PDFLib.PDFName.of(key);
  if (value && value.length > 0) info.set(name, PDFLib.PDFHexString.fromText(value));
  else info.delete(name);
}

function setInfoDate(info, key, date) {
  const name = PDFLib.PDFName.of(key);
  if (date) info.set(name, PDFLib.PDFString.of(toPdfDate(date)));
  else info.delete(name);
}

function readCatalogName(doc, key) {
  const val = doc.catalog.lookup(PDFLib.PDFName.of(key));
  if (val instanceof PDFLib.PDFName) return val.decodeText();
  return "";
}

function readCatalogText(doc, key) {
  const val = doc.catalog.lookup(PDFLib.PDFName.of(key));
  if (val instanceof PDFLib.PDFString || val instanceof PDFLib.PDFHexString) return val.decodeText();
  return "";
}

/* ------------------------------------------------------------------ */
/* Lecture du paquet XMP                                               */
/* ------------------------------------------------------------------ */

/** Renvoie { xml, ref } du flux /Metadata, ou null s'il n'existe pas. */
function readXmpStream(doc) {
  const ref = doc.catalog.get(PDFLib.PDFName.of("Metadata"));
  if (!ref) return null;
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFLib.PDFRawStream)) return null;
  let bytes;
  try {
    bytes = PDFLib.decodePDFRawStream(stream).decode();
  } catch (e) {
    bytes = stream.contents;
  }
  let xml;
  try {
    xml = new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    return null;
  }
  return { xml, ref: ref instanceof PDFLib.PDFRef ? ref : null };
}

/** Lit une propriété XMP (attribut ou élément) dans la liste des rdf:Description.
 * Renvoie un tableau de chaînes (vide si absente). Pour rdf:Alt, la valeur
 * x-default est placée en premier. */
function xmpProp(descriptions, ns, local) {
  for (const desc of descriptions) {
    const attr = desc.getAttributeNS(ns, local);
    if (attr !== null && attr !== "") return [attr];
    for (const child of Array.from(desc.children)) {
      if (child.namespaceURI !== ns || child.localName !== local) continue;
      const container = Array.from(child.children).find((c) => c.namespaceURI === NS.rdf &&
        (c.localName === "Alt" || c.localName === "Seq" || c.localName === "Bag"));
      if (!container) return [child.textContent.trim()];
      const items = Array.from(container.children).filter((c) => c.namespaceURI === NS.rdf && c.localName === "li");
      const values = items.map((li) => li.textContent.trim());
      if (container.localName === "Alt") {
        const idx = items.findIndex((li) => li.getAttributeNS(NS.xml, "lang") === "x-default");
        if (idx > 0) values.unshift(values.splice(idx, 1)[0]);
      }
      return values;
    }
  }
  return [];
}

/** Analyse le XML du paquet XMP ; renvoie null si le XML est mal formé. */
function parseXmp(xml) {
  let dom;
  try {
    dom = new DOMParser().parseFromString(xml, "application/xml");
  } catch (e) {
    return null;
  }
  if (dom.getElementsByTagName("parsererror").length > 0) return null;
  const descriptions = Array.from(dom.getElementsByTagNameNS(NS.rdf, "Description"));
  const first = (arr) => (arr.length ? arr[0] : "");
  return {
    dom,
    title: first(xmpProp(descriptions, NS.dc, "title")),
    creator: xmpProp(descriptions, NS.dc, "creator").join(", "),
    description: first(xmpProp(descriptions, NS.dc, "description")),
    subject: xmpProp(descriptions, NS.dc, "subject"),
    creatorTool: first(xmpProp(descriptions, NS.xmp, "CreatorTool")),
    createDate: first(xmpProp(descriptions, NS.xmp, "CreateDate")),
    modifyDate: first(xmpProp(descriptions, NS.xmp, "ModifyDate")),
    producer: first(xmpProp(descriptions, NS.pdf, "Producer")),
    keywords: first(xmpProp(descriptions, NS.pdf, "Keywords")),
    pdfaPart: first(xmpProp(descriptions, NS.pdfaid, "part")),
    pdfaConformance: first(xmpProp(descriptions, NS.pdfaid, "conformance"))
  };
}

/* ------------------------------------------------------------------ */
/* Écriture du paquet XMP                                              */
/* ------------------------------------------------------------------ */

function splitKeywords(str) {
  return String(str || "").split(/[,;]/).map((k) => k.trim()).filter((k) => k.length > 0);
}

/** Supprime les propriétés gérées d'un rdf:Description (attributs et éléments). */
function stripManagedProps(desc) {
  for (const [ns, local] of MANAGED_XMP_PROPS) {
    if (desc.hasAttributeNS(ns, local)) desc.removeAttributeNS(ns, local);
    for (const child of Array.from(desc.children)) {
      if (child.namespaceURI === ns && child.localName === local) desc.removeChild(child);
    }
  }
}

/** Un rdf:Description est vide s'il ne porte plus que rdf:about et des xmlns. */
function isEmptyDescription(desc) {
  if (desc.children.length > 0) return false;
  for (const attr of Array.from(desc.attributes)) {
    if (attr.namespaceURI === NS.xmlns || attr.name === "xmlns") continue;
    if (attr.namespaceURI === NS.rdf && attr.localName === "about") continue;
    return false;
  }
  return true;
}

function newEmptyXmpDom() {
  const src = '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="tchadiaPdf">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF></x:xmpmeta>';
  return new DOMParser().parseFromString(src, "application/xml");
}

/**
 * Construit le paquet XMP complet (octets UTF-8) à partir des valeurs du
 * formulaire. Si le paquet d'origine est bien formé, ses autres espaces de
 * noms (pdfaid, photoshop, xmpMM…) sont conservés : seules les propriétés
 * gérées sont remplacées.
 */
function buildXmpPacket(values, originalDom) {
  let dom = null;
  if (originalDom) {
    dom = originalDom.cloneNode(true);
    if (dom.getElementsByTagNameNS(NS.rdf, "RDF").length === 0) dom = null;
  }
  if (!dom) dom = newEmptyXmpDom();

  const rdf = dom.getElementsByTagNameNS(NS.rdf, "RDF")[0];
  for (const desc of Array.from(rdf.children)) {
    if (desc.namespaceURI !== NS.rdf || desc.localName !== "Description") continue;
    stripManagedProps(desc);
    if (isEmptyDescription(desc)) rdf.removeChild(desc);
  }

  const desc = dom.createElementNS(NS.rdf, "rdf:Description");
  desc.setAttributeNS(NS.rdf, "rdf:about", "");
  desc.setAttributeNS(NS.xmlns, "xmlns:dc", NS.dc);
  desc.setAttributeNS(NS.xmlns, "xmlns:xmp", NS.xmp);
  desc.setAttributeNS(NS.xmlns, "xmlns:pdf", NS.pdf);

  const el = (ns, qname, text) => {
    const e = dom.createElementNS(ns, qname);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const addAlt = (qname, text) => {
    if (!text) return;
    const p = el(NS.dc, qname);
    const alt = el(NS.rdf, "rdf:Alt");
    const li = el(NS.rdf, "rdf:li", text);
    li.setAttributeNS(NS.xml, "xml:lang", "x-default");
    alt.appendChild(li);
    p.appendChild(alt);
    desc.appendChild(p);
  };
  const addList = (qname, containerName, items) => {
    if (!items || items.length === 0) return;
    const p = el(NS.dc, qname);
    const c = el(NS.rdf, containerName);
    for (const it of items) c.appendChild(el(NS.rdf, "rdf:li", it));
    p.appendChild(c);
    desc.appendChild(p);
  };
  const addSimple = (ns, qname, text) => {
    if (!text) return;
    desc.appendChild(el(ns, qname, text));
  };

  addAlt("dc:title", values.title);
  addList("dc:creator", "rdf:Seq", values.author ? [values.author] : []);
  addAlt("dc:description", values.subject);
  addList("dc:subject", "rdf:Bag", splitKeywords(values.keywords));
  addSimple(NS.xmp, "xmp:CreatorTool", values.creator);
  if (values.creationDate) addSimple(NS.xmp, "xmp:CreateDate", toXmpDate(values.creationDate));
  if (values.modDate) {
    addSimple(NS.xmp, "xmp:ModifyDate", toXmpDate(values.modDate));
    addSimple(NS.xmp, "xmp:MetadataDate", toXmpDate(values.modDate));
  }
  addSimple(NS.pdf, "pdf:Producer", values.producer);
  addSimple(NS.pdf, "pdf:Keywords", values.keywords);

  rdf.appendChild(desc);

  const body = new XMLSerializer().serializeToString(dom.documentElement);
  // Zone de remplissage normalisée (XMP spec) : des espaces en lignes de
  // 100 caractères, pour permettre une mise à jour sur place par d'autres
  // logiciels sans réécrire le fichier.
  let padding = "";
  const line = " ".repeat(99) + "\n";
  while (padding.length < XMP_PADDING_BYTES) padding += line;
  const packet = '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    body + "\n" + padding + '<?xpacket end="w"?>';
  return new TextEncoder().encode(packet);
}

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

/** Formate une date en français lisible. */
function formatDateFr(date) {
  if (!date || isNaN(date.getTime())) return "Non renseignée";
  const datePart = date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const timePart = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return datePart + " à " + timePart;
}

function resetForm() {
  currentDoc = null;
  originalXmp = null;
  hadCatalogKey = { PageMode: false, PageLayout: false };
  metaForm.classList.remove("visible");
  for (const input of META_INPUTS) input.value = "";
  modDateInput.value = "";
  autoModDateCheck.checked = true;
  modDateInput.disabled = true;
  langInput.value = "";
  pageModeSelect.value = PAGE_MODE_DEFAULT;
  pageLayoutSelect.value = PAGE_LAYOUT_DEFAULT;
  clearAllCheck.checked = false;
  applyClearAllState();
  xmpStatusEl.textContent = "";
  xmpDiffListEl.innerHTML = "";
  useXmpBtn.hidden = true;
}

function applyClearAllState() {
  const off = clearAllCheck.checked;
  for (const input of META_INPUTS) input.disabled = off;
  autoModDateCheck.disabled = off;
  modDateInput.disabled = off || autoModDateCheck.checked;
  useXmpBtn.disabled = off;
}

function renderFile() {
  fileListEl.innerHTML = "";
  if (!currentFile) return;
  const row = document.createElement("div");
  row.className = "file-item";
  row.innerHTML =
    '<span class="f-name"></span><span class="f-meta"></span>' +
    '<button class="icon-btn" title="Retirer" aria-label="Retirer">✕</button>';
  row.querySelector(".f-name").textContent = currentFile.name;
  row.querySelector(".f-meta").textContent = fmtSize(currentFile.size);
  row.querySelector("button").addEventListener("click", () => {
    currentFile = null;
    fileListEl.innerHTML = "";
    resetForm();
    updateState();
  });
  fileListEl.appendChild(row);
}

function updateState() {
  saveBtn.disabled = !currentFile || !currentDoc;
}

/** Ajoute dynamiquement une option au select si la valeur du fichier n'y figure pas. */
function selectValueOrAdd(select, value, fallback) {
  if (!value) {
    select.value = fallback;
    return;
  }
  if (!Array.from(select.options).some((o) => o.value === value)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = "Autre (" + value + ")";
    select.appendChild(opt);
  }
  select.value = value;
}

/** Compare Info et XMP et affiche l'état du paquet ainsi que les divergences. */
function renderXmpStatus(info, xmp) {
  xmpDiffListEl.innerHTML = "";
  useXmpBtn.hidden = true;

  if (!originalXmp) {
    xmpStatusEl.textContent = "Aucun paquet XMP dans ce fichier : il sera créé à l'enregistrement, synchronisé avec le dictionnaire Info.";
    return;
  }
  if (!xmp) {
    xmpStatusEl.textContent = "Paquet XMP présent mais illisible (XML mal formé) : il sera remplacé par un paquet propre à l'enregistrement.";
    return;
  }

  let status = "Paquet XMP présent (" + fmtSize(originalXmp.xml.length) + ").";
  if (xmp.pdfaPart) {
    status += " Déclaré PDF/A-" + xmp.pdfaPart + (xmp.pdfaConformance ? xmp.pdfaConformance.toLowerCase() : "") +
      " (déclaration lue dans le XMP, conformité non vérifiée).";
  }

  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const checks = [
    ["titre", info.title, xmp.title],
    ["auteur", info.author, xmp.creator],
    ["sujet", info.subject, xmp.description],
    ["mots-clés", info.keywords, xmp.keywords || xmp.subject.join(", ")],
    ["créateur", info.creator, xmp.creatorTool],
    ["producteur", info.producer, xmp.producer]
  ];
  let diffs = 0;
  for (const [label, a, b] of checks) {
    const na = norm(a);
    const nb = norm(b);
    if (na === nb || (!na && !nb)) continue;
    diffs++;
    const li = document.createElement("li");
    const article = /^[aeiouy]/i.test(label) ? "L'" : "Le ";
    const info1 = na ? "« " + na + " »" : "absent";
    const xmp1 = nb ? "« " + nb + " »" : "absent";
    li.textContent = article + label + " XMP (" + xmp1 + ") diffère du " + label + " Info (" + info1 + ").";
    xmpDiffListEl.appendChild(li);
  }
  if (diffs > 0) {
    status += " " + diffs + (diffs > 1 ? " divergences" : " divergence") +
      " entre Info et XMP : le formulaire affiche les valeurs Info ; à l'enregistrement, les deux seront alignés.";
    useXmpBtn.hidden = false;
  } else {
    status += " Info et XMP sont cohérents.";
  }
  xmpStatusEl.textContent = status;
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  resetForm();

  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    updateState();
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo).");
    updateState();
    return;
  }

  currentFile = file;
  renderFile();

  try {
    const bytes = await readAsArrayBuffer(file);
    const { PDFDocument } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      const detail = (e && e.message) ? e.message.toLowerCase() : "";
      if (detail.indexOf("encrypt") !== -1) {
        throw new Error("Ce PDF est protégé par mot de passe. Utilisez d'abord l'outil Déverrouiller PDF, puis revenez ici pour modifier ses métadonnées.");
      }
      throw new Error("Impossible de lire ce PDF. Il est peut-être endommagé ou n'est pas un fichier PDF valide. Essayez l'outil Réparer PDF si besoin.");
    }

    currentDoc = doc;

    const info = {
      title: readInfoText(doc, "Title"),
      author: readInfoText(doc, "Author"),
      subject: readInfoText(doc, "Subject"),
      keywords: readInfoText(doc, "Keywords"),
      creator: readInfoText(doc, "Creator"),
      producer: readInfoText(doc, "Producer"),
      creationDate: readInfoDate(doc, "CreationDate"),
      modDate: readInfoDate(doc, "ModDate")
    };

    originalXmp = readXmpStream(doc);
    const xmp = originalXmp ? parseXmp(originalXmp.xml) : null;
    if (originalXmp) originalXmp.parsed = xmp;

    titleInput.value = info.title;
    authorInput.value = info.author;
    subjectInput.value = info.subject;
    keywordsInput.value = info.keywords;
    creatorInput.value = info.creator;
    producerInput.value = info.producer;
    const creation = info.creationDate || (xmp ? parseAnyDate(xmp.createDate) : null);
    creationDateInput.value = toInputValue(creation);
    modDateInput.value = toInputValue(info.modDate || (xmp ? parseAnyDate(xmp.modifyDate) : null));
    document.getElementById("metaDatesInfo").textContent =
      "Fichier : création " + formatDateFr(info.creationDate) + ", modification " + formatDateFr(info.modDate) + ".";

    langInput.value = readCatalogText(doc, "Lang");
    const pageMode = readCatalogName(doc, "PageMode");
    const pageLayout = readCatalogName(doc, "PageLayout");
    hadCatalogKey = { PageMode: !!pageMode, PageLayout: !!pageLayout };
    selectValueOrAdd(pageModeSelect, pageMode, PAGE_MODE_DEFAULT);
    selectValueOrAdd(pageLayoutSelect, pageLayout, PAGE_LAYOUT_DEFAULT);

    renderXmpStatus(info, xmp);
    metaForm.classList.add("visible");
  } catch (err) {
    currentFile = null;
    fileListEl.innerHTML = "";
    showMsg(err.message || "Impossible de lire ce PDF.");
  }

  updateState();
});

/** Reprend dans le formulaire les valeurs du paquet XMP (en cas de divergence). */
useXmpBtn.addEventListener("click", () => {
  const xmp = originalXmp && originalXmp.parsed;
  if (!xmp) return;
  titleInput.value = xmp.title;
  authorInput.value = xmp.creator;
  subjectInput.value = xmp.description;
  keywordsInput.value = xmp.keywords || xmp.subject.join(", ");
  creatorInput.value = xmp.creatorTool;
  producerInput.value = xmp.producer;
  const created = parseAnyDate(xmp.createDate);
  if (created) creationDateInput.value = toInputValue(created);
  titleInput.focus();
});

clearAllCheck.addEventListener("change", applyClearAllState);
autoModDateCheck.addEventListener("change", applyClearAllState);

saveBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");

  if (!currentDoc) {
    showMsg("Veuillez d'abord choisir un fichier PDF.");
    return;
  }

  saveBtn.disabled = true;
  try {
    setProgress(20, "Application des métadonnées…");
    const { PDFName, PDFString } = PDFLib;
    const doc = currentDoc;
    const context = doc.context;
    const metadataName = PDFName.of("Metadata");

    if (clearAllCheck.checked) {
      // Info vide : toutes les clés sont retirées et le trailer ne référence
      // plus de dictionnaire Info ; le flux /Metadata est détaché du catalogue.
      const infoRef = context.trailerInfo.Info;
      const info = doc.getInfoDict();
      for (const key of info.keys()) info.delete(key);
      if (infoRef instanceof PDFLib.PDFRef) context.delete(infoRef);
      context.trailerInfo.Info = undefined;
      // L'objet flux lui-même est retiré du contexte : pdf-lib écrirait sinon
      // l'ancien paquet XMP, orphelin mais toujours lisible, dans le fichier.
      const metadataRef = doc.catalog.get(metadataName);
      if (metadataRef instanceof PDFLib.PDFRef) context.delete(metadataRef);
      doc.catalog.delete(metadataName);
    } else {
      const now = new Date();
      const values = {
        title: titleInput.value.trim(),
        author: authorInput.value.trim(),
        subject: subjectInput.value.trim(),
        keywords: keywordsInput.value.trim(),
        creator: creatorInput.value.trim(),
        producer: producerInput.value.trim(),
        creationDate: fromInputValue(creationDateInput.value),
        modDate: autoModDateCheck.checked ? now : (fromInputValue(modDateInput.value) || now)
      };

      const info = doc.getInfoDict();
      setInfoText(info, "Title", values.title);
      setInfoText(info, "Author", values.author);
      setInfoText(info, "Subject", values.subject);
      setInfoText(info, "Keywords", values.keywords);
      setInfoText(info, "Creator", values.creator);
      setInfoText(info, "Producer", values.producer);
      setInfoDate(info, "CreationDate", values.creationDate);
      setInfoDate(info, "ModDate", values.modDate);

      setProgress(40, "Construction du paquet XMP…");
      const originalDom = originalXmp && originalXmp.parsed ? originalXmp.parsed.dom : null;
      const xmpBytes = buildXmpPacket(values, originalDom);
      const stream = context.stream(xmpBytes, { Type: "Metadata", Subtype: "XML" });
      if (originalXmp && originalXmp.ref) {
        context.assign(originalXmp.ref, stream);
        doc.catalog.set(metadataName, originalXmp.ref);
      } else {
        doc.catalog.set(metadataName, context.register(stream));
      }
    }

    // Propriétés du catalogue (indépendantes de l'option d'effacement).
    const lang = langInput.value.trim();
    if (lang) doc.catalog.set(PDFName.of("Lang"), PDFString.of(lang));
    else doc.catalog.delete(PDFName.of("Lang"));

    const pageMode = pageModeSelect.value;
    if (pageMode !== PAGE_MODE_DEFAULT || hadCatalogKey.PageMode) doc.catalog.set(PDFName.of("PageMode"), PDFName.of(pageMode));
    const pageLayout = pageLayoutSelect.value;
    if (pageLayout !== PAGE_LAYOUT_DEFAULT || hadCatalogKey.PageLayout) doc.catalog.set(PDFName.of("PageLayout"), PDFName.of(pageLayout));

    setProgress(60, "Enregistrement du PDF…");
    const outBytes = await doc.save();

    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(outBytes, "tchadiapdf-metadonnees.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "L'enregistrement des métadonnées a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    updateState();
  }
});
