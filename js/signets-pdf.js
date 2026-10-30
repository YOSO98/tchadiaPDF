/* tchadiaPdf : Signets PDF (table des matières)
 *
 * Lecture de l'arbre de signets existant avec pdf.js (getOutline, destinations
 * résolues en numéro de page), édition dans un arbre accessible au clavier,
 * génération automatique depuis les titres (taille de police relative à la
 * médiane du document) et écriture de /Outlines avec pdf-lib bas niveau.
 *
 * Le modèle interne est une liste plate ordonnée [{ title, page, level }]
 * (level à partir de 1), exactement comme le format texte d'import/export
 * (tabulations pour le niveau). L'arbre PDF est reconstruit à partir de
 * cette liste au moment de l'enregistrement : un item de niveau n+1 est
 * enfant de l'item de niveau n qui le précède. normalizeLevels() garantit
 * qu'aucun niveau ne saute (pas de niveau 3 juste après un niveau 1).
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const MAX_SCAN_PAGES = 500;         // limite de pages analysées pour la génération automatique
const MAX_LEVEL = 6;
const HEADING_RATIO = 1.3;          // un titre est au moins 1,3 fois plus grand que la taille médiane
const HEADING_MAX_CHARS = 120;

let currentFile = null;
let srcBytes = null;      // ArrayBuffer du PDF source (pour pdf-lib à l'enregistrement)
let pdfjsDoc = null;      // document pdf.js (lecture des signets et du texte)
let pageCount = 0;
let items = [];           // [{ title, page, level }] : signets courants, ordre d'affichage
let selectedIndex = -1;   // ligne sélectionnée dans l'arbre (ou -1)
let pendingFocus = null;  // { index, target } : élément à refocaliser après un nouveau rendu
let busy = false;         // génération ou enregistrement en cours

const fileListEl = document.getElementById("fileList");
const panel = document.getElementById("signetsPanel");
const treeEl = document.getElementById("outlineTree");
const saveBtn = document.getElementById("saveBtn");
const generateBtn = document.getElementById("generateBtn");
const numberedChk = document.getElementById("numberedChk");
const clearAllBtn = document.getElementById("clearAllBtn");
const addTitleInput = document.getElementById("addTitle");
const addPageInput = document.getElementById("addPage");
const addLevelSelect = document.getElementById("addLevel");
const addBtn = document.getElementById("addBtn");
const tocText = document.getElementById("tocText");
const exportTextBtn = document.getElementById("exportTextBtn");
const downloadTextBtn = document.getElementById("downloadTextBtn");
const openTextBtn = document.getElementById("openTextBtn");
const importTextBtn = document.getElementById("importTextBtn");
const textFileInput = document.getElementById("textFileInput");
const pageModeChk = document.getElementById("pageModeChk");
const resultEl = document.getElementById("result");

/* ------------------------------------------------------------------ */
/* Modèle                                                              */
/* ------------------------------------------------------------------ */

function clampPage(p) {
  const n = parseInt(p, 10);
  if (!isFinite(n) || n < 1) return 1;
  if (pageCount && n > pageCount) return pageCount;
  return n;
}

/** Garantit une hiérarchie cohérente : premier item au niveau 1, aucun saut
 * de plus d'un niveau entre deux lignes consécutives, bornes 1..MAX_LEVEL. */
function normalizeLevels() {
  let prev = 0;
  for (const it of items) {
    let lvl = parseInt(it.level, 10);
    if (!isFinite(lvl) || lvl < 1) lvl = 1;
    if (lvl > prev + 1) lvl = prev + 1;
    if (lvl > MAX_LEVEL) lvl = MAX_LEVEL;
    it.level = lvl;
    prev = lvl;
  }
}

function resetState() {
  srcBytes = null;
  pdfjsDoc = null;
  pageCount = 0;
  items = [];
  selectedIndex = -1;
  pendingFocus = null;
  panel.classList.remove("visible");
  treeEl.innerHTML = "";
  tocText.value = "";
  pageModeChk.checked = false;
  addPageInput.value = "1";
  addPageInput.removeAttribute("max");
}

function updateState() {
  saveBtn.disabled = busy || !srcBytes;
  generateBtn.disabled = busy || !pdfjsDoc;
}

/* ------------------------------------------------------------------ */
/* Chargement du fichier et lecture des signets existants              */
/* ------------------------------------------------------------------ */

function renderFile() {
  fileListEl.innerHTML = "";
  if (!currentFile) return;
  const row = document.createElement("div");
  row.className = "file-item";
  row.innerHTML =
    '<span class="f-name"></span><span class="f-meta"></span>' +
    '<button type="button" class="icon-btn" title="Retirer" aria-label="Retirer">✕</button>';
  row.querySelector(".f-name").textContent = currentFile.name;
  row.querySelector(".f-meta").textContent = fmtSize(currentFile.size) + " · " + pageCount + " page" + (pageCount > 1 ? "s" : "");
  row.querySelector("button").addEventListener("click", () => {
    currentFile = null;
    fileListEl.innerHTML = "";
    resetState();
    hideMsg();
    resultEl.classList.remove("visible");
    updateState();
  });
  fileListEl.appendChild(row);
}

/** Résout la destination d'un signet pdf.js en numéro de page (1..n), ou 1 en
 * cas de destination introuvable (destination nommée absente, lien externe…). */
async function resolveDestPage(dest) {
  try {
    let arr = dest;
    if (typeof arr === "string") arr = await pdfjsDoc.getDestination(arr);
    if (!Array.isArray(arr) || arr.length === 0) return 1;
    const target = arr[0];
    if (typeof target === "number") return clampPage(target + 1);
    if (target && typeof target === "object" && "num" in target) {
      const idx = await pdfjsDoc.getPageIndex(target);
      return clampPage(idx + 1);
    }
  } catch (e) {
    // Destination non résolvable : on garde la page 1 plutôt que de perdre le titre.
  }
  return 1;
}

/** Aplatit l'arbre renvoyé par getOutline() en liste [{ title, page, level }]. */
async function readExistingOutline() {
  const outline = await pdfjsDoc.getOutline();
  const out = [];
  async function walk(nodes, level) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (out.length >= 5000) return; // garde-fou contre les arbres absurdes
      const page = await resolveDestPage(node.dest);
      out.push({ title: String(node.title || "").trim() || "Sans titre", page, level: Math.min(level, MAX_LEVEL) });
      if (node.items && node.items.length) await walk(node.items, level + 1);
    }
  }
  await walk(outline, 1);
  return out;
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");
  resetState();
  currentFile = null;
  fileListEl.innerHTML = "";

  const file = newFiles[0];
  if (!file) return;
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    updateState();
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo). Choisissez un fichier plus léger.");
    updateState();
    return;
  }

  busy = true;
  updateState();
  try {
    setProgress(10, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(file);

    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") {
        throw new Error("Ce PDF est protégé par mot de passe. Utilisez d'abord l'outil Déverrouiller PDF, puis revenez ici pour modifier ses signets.");
      }
      throw new Error("Impossible de lire ce PDF. Il est peut-être endommagé ou n'est pas un fichier PDF valide. Essayez l'outil Réparer PDF si besoin.");
    }
    if (!pdf.numPages) throw new Error("Ce PDF ne contient aucune page.");

    // pdf-lib doit aussi pouvoir l'ouvrir, sinon l'enregistrement échouerait plus tard.
    try {
      await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      const detail = (e && e.message) ? e.message.toLowerCase() : "";
      if (detail.indexOf("encrypt") !== -1) {
        throw new Error("Ce PDF est protégé par mot de passe. Utilisez d'abord l'outil Déverrouiller PDF, puis revenez ici pour modifier ses signets.");
      }
      throw new Error("Impossible de lire ce PDF. Il est peut-être endommagé. Essayez l'outil Réparer PDF si besoin.");
    }

    srcBytes = bytes;
    pdfjsDoc = pdf;
    pageCount = pdf.numPages;
    currentFile = file;
    addPageInput.max = String(pageCount);
    renderFile();

    setProgress(60, "Lecture des signets existants…");
    items = await readExistingOutline();
    normalizeLevels();

    try {
      const mode = await pdf.getPageMode();
      pageModeChk.checked = mode === "UseOutlines";
    } catch (e) {
      pageModeChk.checked = false;
    }

    hideProgress();
    panel.classList.add("visible");
    renderTree();
    if (items.length === 0) {
      showMsg("Ce PDF ne contient aucun signet. Cliquez sur « Générer depuis les titres » ou ajoutez vos signets à la main.");
    }
  } catch (err) {
    hideProgress();
    currentFile = null;
    fileListEl.innerHTML = "";
    resetState();
    showMsg(err.message || "Impossible de lire ce PDF.");
  } finally {
    busy = false;
    updateState();
  }
});

/* ------------------------------------------------------------------ */
/* Arbre éditable                                                      */
/* ------------------------------------------------------------------ */

function focusRow(index, target) {
  const row = treeEl.querySelector('[data-index="' + index + '"]');
  if (!row) return;
  let el = row;
  if (target === "title") el = row.querySelector(".o-title");
  else if (target) el = row.querySelector('[data-action="' + target + '"]') || row;
  if (el.disabled) el = row;
  el.focus();
}

function selectRow(index) {
  selectedIndex = index;
  treeEl.querySelectorAll(".outline-item").forEach((li) => {
    li.setAttribute("aria-selected", li.dataset.index === String(index) ? "true" : "false");
  });
}

function canIndent(idx) {
  return idx > 0 && items[idx].level < items[idx - 1].level + 1 && items[idx].level < MAX_LEVEL;
}
function canOutdent(idx) {
  return items[idx].level > 1;
}

function moveItem(idx, delta) {
  const to = idx + delta;
  if (to < 0 || to >= items.length) return;
  [items[idx], items[to]] = [items[to], items[idx]];
  normalizeLevels();
  selectedIndex = to;
  pendingFocus = { index: to, target: delta < 0 ? "up" : "down" };
  renderTree();
}
function indentItem(idx, delta) {
  if (delta > 0 && !canIndent(idx)) return;
  if (delta < 0 && !canOutdent(idx)) return;
  items[idx].level += delta;
  normalizeLevels();
  selectedIndex = idx;
  pendingFocus = { index: idx, target: delta > 0 ? "indent" : "outdent" };
  renderTree();
}
function deleteItem(idx) {
  items.splice(idx, 1);
  normalizeLevels();
  const next = Math.min(idx, items.length - 1);
  selectedIndex = next;
  pendingFocus = next >= 0 ? { index: next, target: null } : null;
  renderTree();
}

/** Reconstruit entièrement l'arbre à partir de "items". */
function renderTree() {
  treeEl.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "outline-empty";
    empty.setAttribute("role", "none");
    empty.textContent = "Aucun signet pour l'instant. Générez-les depuis les titres ou ajoutez-en ci-dessous.";
    treeEl.appendChild(empty);
    selectedIndex = -1;
    pendingFocus = null;
    return;
  }

  if (selectedIndex >= items.length) selectedIndex = items.length - 1;

  items.forEach((it, idx) => {
    const li = document.createElement("li");
    li.className = "outline-item";
    li.setAttribute("role", "treeitem");
    li.setAttribute("aria-level", String(it.level));
    li.setAttribute("aria-setsize", String(items.length));
    li.setAttribute("aria-posinset", String(idx + 1));
    li.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false");
    li.setAttribute("aria-label", "Signet « " + it.title + " », niveau " + it.level + ", page " + it.page);
    li.tabIndex = idx === (selectedIndex === -1 ? 0 : selectedIndex) ? 0 : -1;
    li.dataset.index = String(idx);
    li.style.setProperty("--lvl", String(it.level));

    const lvl = document.createElement("span");
    lvl.className = "o-level";
    lvl.textContent = "N" + it.level;
    lvl.title = "Niveau " + it.level;
    li.appendChild(lvl);

    const title = document.createElement("input");
    title.type = "text";
    title.className = "o-title";
    title.value = it.title;
    title.maxLength = 300;
    title.setAttribute("aria-label", "Titre du signet " + (idx + 1));
    title.addEventListener("input", () => { it.title = title.value; });
    title.addEventListener("focus", () => selectRow(idx));
    title.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || (e.key === "Enter" && !e.altKey)) {
        e.preventDefault();
        li.focus();
      }
    });
    li.appendChild(title);

    const pageLabel = document.createElement("span");
    pageLabel.className = "o-page-label";
    pageLabel.textContent = "page";
    li.appendChild(pageLabel);

    const page = document.createElement("input");
    page.type = "number";
    page.className = "o-page";
    page.min = "1";
    if (pageCount) page.max = String(pageCount);
    page.value = String(it.page);
    page.setAttribute("aria-label", "Page cible du signet " + (idx + 1));
    page.addEventListener("input", () => {
      const n = parseInt(page.value, 10);
      if (isFinite(n)) it.page = clampPage(n);
    });
    page.addEventListener("blur", () => { page.value = String(it.page); });
    page.addEventListener("focus", () => selectRow(idx));
    page.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); li.focus(); }
    });
    li.appendChild(page);

    const actions = document.createElement("div");
    actions.className = "o-actions";
    actions.innerHTML =
      '<button type="button" class="icon-btn" data-action="up" title="Monter" aria-label="Monter le signet ' + (idx + 1) + '">↑</button>' +
      '<button type="button" class="icon-btn" data-action="down" title="Descendre" aria-label="Descendre le signet ' + (idx + 1) + '">↓</button>' +
      '<button type="button" class="icon-btn" data-action="outdent" title="Désindenter" aria-label="Désindenter le signet ' + (idx + 1) + '">←</button>' +
      '<button type="button" class="icon-btn" data-action="indent" title="Indenter" aria-label="Indenter le signet ' + (idx + 1) + '">→</button>' +
      '<button type="button" class="icon-btn" data-action="del" title="Supprimer" aria-label="Supprimer le signet ' + (idx + 1) + '">✕</button>';
    li.appendChild(actions);

    const upBtn = actions.querySelector('[data-action="up"]');
    const downBtn = actions.querySelector('[data-action="down"]');
    const outdentBtn = actions.querySelector('[data-action="outdent"]');
    const indentBtn = actions.querySelector('[data-action="indent"]');
    const delBtn = actions.querySelector('[data-action="del"]');
    upBtn.disabled = idx === 0;
    downBtn.disabled = idx === items.length - 1;
    outdentBtn.disabled = !canOutdent(idx);
    indentBtn.disabled = !canIndent(idx);

    upBtn.addEventListener("click", () => moveItem(idx, -1));
    downBtn.addEventListener("click", () => moveItem(idx, 1));
    outdentBtn.addEventListener("click", () => indentItem(idx, -1));
    indentBtn.addEventListener("click", () => indentItem(idx, 1));
    delBtn.addEventListener("click", () => deleteItem(idx));
    actions.querySelectorAll("button").forEach((b) => b.addEventListener("focus", () => selectRow(idx)));

    li.addEventListener("click", (e) => {
      if (e.target === li || e.target === lvl) selectRow(idx);
    });
    li.addEventListener("focus", () => selectRow(idx));
    li.addEventListener("keydown", (e) => {
      // Raccourcis Alt+flèches : valables depuis la ligne comme depuis ses champs.
      if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); moveItem(idx, -1); return; }
      if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); moveItem(idx, 1); return; }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); indentItem(idx, 1); return; }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); indentItem(idx, -1); return; }
      if (e.target !== li) return; // les autres touches sont réservées aux champs de saisie
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (idx < items.length - 1) { selectRow(idx + 1); focusRow(idx + 1); }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (idx > 0) { selectRow(idx - 1); focusRow(idx - 1); }
      } else if (e.key === "Home") {
        e.preventDefault(); selectRow(0); focusRow(0);
      } else if (e.key === "End") {
        e.preventDefault(); selectRow(items.length - 1); focusRow(items.length - 1);
      } else if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault(); title.focus(); title.select();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); deleteItem(idx);
      }
    });

    treeEl.appendChild(li);
  });

  // Un seul élément dans la séquence de tabulation (motif "roving tabindex").
  treeEl.querySelectorAll(".outline-item").forEach((li) => {
    li.tabIndex = li.dataset.index === String(selectedIndex === -1 ? 0 : selectedIndex) ? 0 : -1;
  });

  if (pendingFocus) {
    focusRow(pendingFocus.index, pendingFocus.target);
    pendingFocus = null;
  }
}

/* ------------------------------------------------------------------ */
/* Ajout manuel et suppression globale                                 */
/* ------------------------------------------------------------------ */

function addItem() {
  const title = addTitleInput.value.trim();
  if (!title) {
    showMsg("Indiquez un titre pour le nouveau signet.");
    addTitleInput.focus();
    return;
  }
  hideMsg();
  const page = clampPage(addPageInput.value);
  const level = parseInt(addLevelSelect.value, 10) || 1;
  // Inséré après la ligne sélectionnée (comme Acrobat), sinon en fin de liste.
  const at = selectedIndex >= 0 && selectedIndex < items.length ? selectedIndex + 1 : items.length;
  items.splice(at, 0, { title, page, level });
  normalizeLevels();
  selectedIndex = at;
  renderTree();
  addTitleInput.value = "";
  addTitleInput.focus();
}

addBtn.addEventListener("click", addItem);
addTitleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addItem(); }
});
addPageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addItem(); }
});

clearAllBtn.addEventListener("click", () => {
  hideMsg();
  items = [];
  selectedIndex = -1;
  renderTree();
  showMsg("Tous les signets ont été retirés de la liste. Cliquez sur « Enregistrer les signets » pour produire un PDF sans signet.");
});

/* ------------------------------------------------------------------ */
/* Génération automatique depuis les titres                            */
/* ------------------------------------------------------------------ */

const NUMBERED_RE = /^(\d{1,3}(?:\.\d{1,3}){0,4})[.)]?\s+\S/;
const KEYWORD_RE = /^(chapitre|partie|titre|livre|section|article|annexe)\s+([0-9]{1,4}|[ivxlc]{1,8})\b/i;
const LEVEL1_KEYWORDS = { chapitre: 1, partie: 1, titre: 1, livre: 1, section: 2, article: 2, annexe: 1 };

/** Niveau déduit d'un motif numéroté, ou 0 si la ligne n'en suit aucun. */
function numberedLevel(text) {
  const m = NUMBERED_RE.exec(text);
  if (m) {
    const depth = m[1].split(".").length;
    return Math.min(depth, 3);
  }
  const k = KEYWORD_RE.exec(text);
  if (k) return LEVEL1_KEYWORDS[k[1].toLowerCase()] || 1;
  return 0;
}

/** Regroupe les items pdf.js d'une page en lignes (même ordonnée, à une
 * tolérance près), fusionne leur texte et retient la plus grande taille. */
function groupLines(textContent) {
  const raw = [];
  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    const t = item.transform;
    const size = Math.hypot(t[0], t[1]) || item.height || 0;
    if (!size) continue;
    raw.push({ str: item.str, x: t[4], y: t[5], size });
  }
  raw.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines = [];
  for (const r of raw) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - r.y) <= Math.max(2, 0.35 * Math.max(last.size, r.size))) {
      last.parts.push(r);
      last.size = Math.max(last.size, r.size);
      last.chars += r.str.length;
      last.sizeWeight += r.size * r.str.length;
    } else {
      lines.push({ y: r.y, size: r.size, parts: [r], chars: r.str.length, sizeWeight: r.size * r.str.length });
    }
  }
  for (const line of lines) {
    line.parts.sort((a, b) => a.x - b.x);
    let text = "";
    for (const p of line.parts) {
      const s = p.str;
      if (text && !/\s$/.test(text) && !/^\s/.test(s) && !/[(\[«'’-]$/.test(text) && !/^[,.;:)\]»!?]/.test(s)) text += " ";
      text += s;
    }
    line.text = text.replace(/\s+/g, " ").trim();
  }
  return lines;
}

/** Médiane pondérée par le nombre de caractères : la taille « du corps ». */
function weightedMedian(entries) {
  if (!entries.length) return 0;
  entries.sort((a, b) => a.size - b.size);
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let acc = 0;
  for (const e of entries) {
    acc += e.weight;
    if (acc >= total / 2) return e.size;
  }
  return entries[entries.length - 1].size;
}

generateBtn.addEventListener("click", async () => {
  if (!pdfjsDoc || busy) return;
  hideMsg();
  resultEl.classList.remove("visible");
  busy = true;
  updateState();

  try {
    const total = Math.min(pageCount, MAX_SCAN_PAGES);
    const pagesLines = [];
    const sizeEntries = [];

    for (let i = 1; i <= total; i++) {
      setProgress(Math.round((i / total) * 90), "Analyse des titres : page " + i + " / " + total + "…");
      const page = await pdfjsDoc.getPage(i);
      const content = await page.getTextContent();
      const lines = groupLines(content);
      pagesLines.push(lines);
      for (const line of lines) {
        for (const p of line.parts) sizeEntries.push({ size: Math.round(p.size * 10) / 10, weight: p.str.length });
      }
      page.cleanup();
    }

    const median = weightedMedian(sizeEntries);
    if (!median) {
      throw new Error("Aucun texte exploitable n'a été trouvé dans ce PDF (document scanné ?). Utilisez l'outil OCR PDF pour le rendre interrogeable, ou ajoutez vos signets à la main.");
    }

    const useNumbered = numberedChk.checked;
    const threshold = median * HEADING_RATIO;
    const candidates = [];
    pagesLines.forEach((lines, pageIdx) => {
      for (const line of lines) {
        const text = line.text;
        if (!text || text.length >= HEADING_MAX_CHARS) continue;
        if (/^[\d\s.,/:;()\-]+$/.test(text)) continue; // numéros de page, dates, pointillés
        const bySize = line.size > threshold;
        const numLevel = useNumbered ? numberedLevel(text) : 0;
        if (!bySize && !numLevel) continue;
        candidates.push({ text, page: pageIdx + 1, size: line.size, bySize, numLevel });
      }
    });

    // En-têtes ou pieds de page répétés : même texte sur au moins 3 pages
    // et plus d'un tiers des pages analysées.
    const occurrences = new Map();
    for (const c of candidates) occurrences.set(c.text, (occurrences.get(c.text) || 0) + 1);
    const filtered = candidates.filter((c) => {
      const n = occurrences.get(c.text);
      return !(n >= 3 && n > total / 3);
    });

    // Deux niveaux par la taille : les tailles proches de la plus grande
    // (à 12 % près) sont des niveaux 1, les autres titres des niveaux 2.
    const headingSizes = filtered.filter((c) => c.bySize).map((c) => c.size);
    const maxSize = headingSizes.length ? Math.max.apply(null, headingSizes) : 0;
    const generated = filtered.map((c) => {
      let level;
      if (c.numLevel) level = c.numLevel;
      else level = c.size >= maxSize * 0.88 ? 1 : 2;
      return { title: c.text, page: c.page, level };
    });

    hideProgress();
    if (generated.length === 0) {
      showMsg("Aucun titre n'a été détecté (aucune ligne nettement plus grande que le corps du texte" + (useNumbered ? ", ni numérotée" : "") + "). Ajoutez vos signets à la main ou essayez l'option « Motifs numérotés ».");
      return;
    }

    items = generated;
    normalizeLevels();
    selectedIndex = 0;
    renderTree();
    showMsg(generated.length + " signet" + (generated.length > 1 ? "s proposés" : " proposé") +
      (total < pageCount ? " (analyse limitée aux " + total + " premières pages)" : "") +
      ". Vérifiez les titres, pages et niveaux, puis enregistrez.");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "L'analyse des titres a échoué.");
  } finally {
    busy = false;
    updateState();
  }
});

/* ------------------------------------------------------------------ */
/* Import / export texte                                               */
/* ------------------------------------------------------------------ */

function itemsToText() {
  return items.map((it) => "\t".repeat(it.level - 1) + it.title.replace(/\t/g, " ") + "\t" + it.page).join("\n");
}

/** Analyse le format texte : tabulations initiales = niveau, dernier champ
 * numérique = page (facultatif, 1 par défaut). Les espaces initiaux par
 * groupes de deux ou quatre sont acceptés comme tabulations. */
function parseText(text) {
  const out = [];
  let missingPages = 0;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    if (!rawLine.trim()) continue;
    let line = rawLine.replace(/^( {2,4})+/, (m) => "\t".repeat(Math.round(m.length / (m.length % 4 === 0 ? 4 : 2))));
    let level = 1;
    while (line.startsWith("\t")) { level++; line = line.slice(1); }
    const fields = line.split("\t").map((f) => f.trim()).filter((f) => f.length);
    let page = 1;
    const spaced = fields.length === 1 ? /^(.*\S)\s{2,}(\d+)$/.exec(fields[0]) : null;
    if (fields.length >= 2 && /^\d+$/.test(fields[fields.length - 1])) {
      page = clampPage(fields.pop());
    } else if (spaced) {
      // Variante tolérée : « Titre   12 » (deux espaces ou plus avant la page).
      fields[0] = spaced[1];
      page = clampPage(spaced[2]);
    } else {
      missingPages++;
    }
    const title = fields.join(" ").trim();
    if (!title) continue;
    out.push({ title: title.slice(0, 300), page, level: Math.min(level, MAX_LEVEL) });
  }
  return { items: out, missingPages };
}

exportTextBtn.addEventListener("click", () => {
  hideMsg();
  tocText.value = itemsToText();
  if (!items.length) showMsg("Aucun signet à exporter pour l'instant.");
  tocText.focus();
});

downloadTextBtn.addEventListener("click", () => {
  hideMsg();
  const text = itemsToText();
  if (!text) { showMsg("Aucun signet à exporter pour l'instant."); return; }
  tocText.value = text;
  const blob = new Blob([text + "\n"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tchadiapdf-table-des-matieres.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

function applyText() {
  hideMsg();
  const parsed = parseText(tocText.value);
  if (!parsed.items.length) {
    showMsg("Aucune ligne exploitable : écrivez un signet par ligne, avec des tabulations pour le niveau, le titre, une tabulation puis le numéro de page.");
    return;
  }
  items = parsed.items;
  normalizeLevels();
  selectedIndex = 0;
  renderTree();
  let info = parsed.items.length + " signet" + (parsed.items.length > 1 ? "s importés" : " importé") + " depuis le texte.";
  if (parsed.missingPages) info += " " + parsed.missingPages + " ligne" + (parsed.missingPages > 1 ? "s sans numéro de page ont été placées" : " sans numéro de page a été placée") + " sur la page 1.";
  showMsg(info);
}

importTextBtn.addEventListener("click", applyText);
openTextBtn.addEventListener("click", () => textFileInput.click());
textFileInput.addEventListener("change", () => {
  const f = textFileInput.files[0];
  textFileInput.value = "";
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { showMsg("Ce fichier texte est trop volumineux (limite : 2 Mo)."); return; }
  const reader = new FileReader();
  reader.onload = () => {
    tocText.value = String(reader.result || "");
    document.getElementById("ioDetails").open = true;
    applyText();
  };
  reader.onerror = () => showMsg("Impossible de lire ce fichier texte.");
  reader.readAsText(f, "utf-8");
});

/* ------------------------------------------------------------------ */
/* Écriture de /Outlines avec pdf-lib bas niveau                       */
/* ------------------------------------------------------------------ */

/** Supprime du contexte les objets de l'ancien arbre de signets, pour ne pas
 * laisser d'objets orphelins dans le fichier produit. Tolérant aux arbres
 * incohérents (cycles, références cassées). */
function deleteOldOutlines(doc) {
  const { PDFName, PDFRef, PDFDict } = PDFLib;
  const ctx = doc.context;
  const rootRef = doc.catalog.get(PDFName.of("Outlines"));
  if (!(rootRef instanceof PDFRef)) {
    doc.catalog.delete(PDFName.of("Outlines"));
    return;
  }
  const seen = new Set();
  const stack = [rootRef];
  while (stack.length && seen.size < 20000) {
    const ref = stack.pop();
    if (!(ref instanceof PDFRef) || seen.has(ref.toString())) continue;
    seen.add(ref.toString());
    const dict = ctx.lookup(ref);
    if (!(dict instanceof PDFDict)) continue;
    for (const key of ["First", "Next"]) {
      const child = dict.get(PDFName.of(key));
      if (child instanceof PDFRef) stack.push(child);
    }
  }
  for (const key of seen) {
    const [num, gen] = key.split(" ").map((n) => parseInt(n, 10));
    ctx.delete(PDFRef.of(num, gen));
  }
  doc.catalog.delete(PDFName.of("Outlines"));
}

/** Transforme la liste plate en arbre { item, children }. */
function buildTree() {
  const roots = [];
  const stack = []; // nœuds ouverts, index = niveau - 1
  for (const it of items) {
    const node = { item: it, children: [] };
    const depth = it.level - 1;
    stack.length = Math.min(stack.length, depth);
    if (depth === 0 || stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}

function countDescendants(nodes) {
  let n = 0;
  for (const node of nodes) n += 1 + countDescendants(node.children);
  return n;
}

function writeOutlines(doc) {
  const { PDFName, PDFNumber, PDFHexString, PDFNull, PDFArray } = PDFLib;
  const ctx = doc.context;
  const pages = doc.getPages();

  deleteOldOutlines(doc);

  if (items.length === 0) {
    const mode = doc.catalog.get(PDFName.of("PageMode"));
    if (mode && mode.toString() === "/UseOutlines") doc.catalog.delete(PDFName.of("PageMode"));
    return;
  }

  const roots = buildTree();
  const outlinesRef = ctx.nextRef();

  function writeSiblings(nodes, parentRef) {
    const refs = nodes.map(() => ctx.nextRef());
    nodes.forEach((node, i) => {
      const it = node.item;
      const pageIndex = Math.min(Math.max(it.page - 1, 0), pages.length - 1);
      const dest = PDFArray.withContext(ctx);
      dest.push(pages[pageIndex].ref);
      dest.push(PDFName.of("XYZ"));
      dest.push(PDFNull);
      dest.push(PDFNull);
      dest.push(PDFNull);

      const dict = ctx.obj({});
      dict.set(PDFName.of("Title"), PDFHexString.fromText(it.title));
      dict.set(PDFName.of("Parent"), parentRef);
      dict.set(PDFName.of("Dest"), dest);
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < refs.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
      if (node.children.length) {
        const childRefs = writeSiblings(node.children, refs[i]);
        dict.set(PDFName.of("First"), childRefs[0]);
        dict.set(PDFName.of("Last"), childRefs[childRefs.length - 1]);
        // Count positif : branche ouverte à l'affichage (comme Acrobat après « Tout développer »).
        dict.set(PDFName.of("Count"), PDFNumber.of(countDescendants(node.children)));
      }
      ctx.assign(refs[i], dict);
    });
    return refs;
  }

  const rootRefs = writeSiblings(roots, outlinesRef);
  const outlines = ctx.obj({});
  outlines.set(PDFName.of("Type"), PDFName.of("Outlines"));
  outlines.set(PDFName.of("First"), rootRefs[0]);
  outlines.set(PDFName.of("Last"), rootRefs[rootRefs.length - 1]);
  outlines.set(PDFName.of("Count"), PDFNumber.of(countDescendants(roots)));
  ctx.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);

  if (pageModeChk.checked) {
    doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  } else {
    const mode = doc.catalog.get(PDFName.of("PageMode"));
    if (mode && mode.toString() === "/UseOutlines") doc.catalog.delete(PDFName.of("PageMode"));
  }
}

saveBtn.addEventListener("click", async () => {
  hideMsg();
  resultEl.classList.remove("visible");
  if (!srcBytes) {
    showMsg("Veuillez d'abord choisir un fichier PDF.");
    return;
  }

  // Titres vides : on refuse plutôt que d'écrire des signets illisibles.
  const emptyIdx = items.findIndex((it) => !it.title.trim());
  if (emptyIdx !== -1) {
    showMsg("Le signet " + (emptyIdx + 1) + " n'a pas de titre. Complétez-le ou supprimez-le avant d'enregistrer.");
    selectedIndex = emptyIdx;
    renderTree();
    focusRow(emptyIdx, "title");
    return;
  }

  busy = true;
  updateState();
  try {
    setProgress(15, "Ouverture du document…");
    const { PDFDocument } = PDFLib;
    const doc = await PDFDocument.load(srcBytes, { updateMetadata: false });

    setProgress(50, "Écriture des signets…");
    items.forEach((it) => { it.title = it.title.trim(); it.page = clampPage(it.page); });
    normalizeLevels();
    writeOutlines(doc);

    setProgress(80, "Enregistrement du PDF…");
    const outBytes = await doc.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(outBytes, "tchadiapdf-signets.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "L'enregistrement des signets a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    busy = false;
    updateState();
  }
});

updateState();
