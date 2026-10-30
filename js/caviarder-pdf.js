/* tchadiaPdf : Caviarder PDF
 *
 * Garantie centrale de l'outil : le texte sous une zone caviardée est
 * réellement supprimé, pas seulement recouvert par un rectangle visuel (ce
 * qui laisserait le texte copiable/extractible sous la zone noire, un piège
 * classique des faux outils de caviardage). pdf-lib ne permet pas de
 * réécrire finement le flux de contenu d'une page (retirer certains
 * fragments de texte tout en gardant le reste en vectoriel) sans un
 * analyseur de flux PDF complet, hors de portée ici et risqué : une erreur
 * y laisserait silencieusement du texte "caviardé" mais toujours présent.
 *
 * Approche retenue, plus simple et sûre : toute page contenant au moins une
 * zone caviardée est intégralement rendue en image (via pdf.js) avec les
 * zones noircies directement dans les pixels, puis cette image remplace la
 * page dans le document de sortie. Le texte et les objets vectoriels de
 * cette page n'existent alors plus du tout dans le PDF final. Les pages
 * sans zone caviardée restent copiées telles quelles (toujours cherchables).
 * Ce compromis (perte de recherche/sélection sur les pages concernées) est
 * documenté explicitement dans l'interface (voir caviarder-pdf.html).
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo
const RASTER_SCALE = 2; // ~144 DPI equivalent pour les pages rasterisees, bon compromis qualite/poids

let srcBytes = null;
let srcDoc = null; // pdf.js
let pageCount = 0;
let currentPage = 1;
let redactions = new Map(); // pageNum -> [{fracX, fracY, fracW, fracH}, ...]

let dragStart = null;
let dragging = false;
let currentDragPx = null; // rectangle en cours de dessin, en pixels CSS du canvas

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const cavPreviewHolder = document.getElementById("cavPreviewHolder");
const cavActions = document.getElementById("cavActions");
const cavWrap = document.getElementById("cavWrap");
const previewCanvas = document.getElementById("previewCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const pageLabel = document.getElementById("pageLabel");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const clearPageBtn = document.getElementById("clearPageBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const caviarderBtn = document.getElementById("caviarderBtn");
const cavSearch = document.getElementById("cavSearch");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function totalRedactionCount() {
  let n = 0;
  redactions.forEach((list) => { n += list.length; });
  return n;
}

function updateCaviarderBtn() {
  caviarderBtn.disabled = totalRedactionCount() === 0;
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  resetOutil();

  const file = newFiles[0];
  const validation = validateFile(file, { accept: ["pdf", "application/pdf"], acceptLabel: "un fichier PDF", maxWarnBytes: MAX_SIZE });
  if (!validation.ok) {
    showMsg(validation.message);
    return;
  }
  if (validation.warning) showMsg(validation.warning);

  try {
    setProgress(10, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(file);

    let jsDoc;
    try {
      jsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      return;
    }

    srcBytes = bytes;
    srcDoc = jsDoc;
    pageCount = jsDoc.numPages;
    currentPage = 1;
    redactions = new Map();

    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + pageCount + " page" + (pageCount > 1 ? "s" : "");
    fileInfo.style.display = "flex";

    cavPreviewHolder.style.display = "flex";
    cavActions.style.display = "flex";
    cavSearch.style.display = "block";
    resetSearch();

    await renderCurrentPage();
    hideProgress();
    updateCaviarderBtn();
  } catch (e) {
    hideProgress();
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
});

function resetOutil() {
  srcBytes = null;
  srcDoc = null;
  pageCount = 0;
  currentPage = 1;
  redactions = new Map();
  fileInfo.style.display = "none";
  cavPreviewHolder.style.display = "none";
  cavActions.style.display = "none";
  cavSearch.style.display = "none";
  resetSearch();
  updateCaviarderBtn();
}

/** Rend la page courante dans le canvas d'aperçu et redimensionne le canvas de recouvrement. */
async function renderCurrentPage() {
  if (!srcDoc) return;
  const disponible = cavWrap.clientWidth || 500;
  const largeur = clamp(disponible, 200, 560);
  await renderPdfPage(srcDoc, currentPage, previewCanvas, largeur);
  overlayCanvas.width = previewCanvas.width;
  overlayCanvas.height = previewCanvas.height;
  overlayCanvas.style.width = previewCanvas.style.width || previewCanvas.width + "px";
  overlayCanvas.style.height = previewCanvas.style.height || previewCanvas.height + "px";
  pageLabel.textContent = "Page " + currentPage + " / " + pageCount;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= pageCount;
  currentDragPx = null;
  redrawOverlay();
}

/** Redessine les zones déjà caviardées de la page courante (noir) et la zone en cours de tracé (bleu, aperçu). */
function redrawOverlay() {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const list = redactions.get(currentPage) || [];
  ctx.fillStyle = "#000000";
  list.forEach((r) => {
    ctx.fillRect(r.fracX * overlayCanvas.width, r.fracY * overlayCanvas.height, r.fracW * overlayCanvas.width, r.fracH * overlayCanvas.height);
  });

  // Occurrences trouvées par la recherche et cochées, pas encore ajoutées : aperçu en bleu.
  ctx.fillStyle = "rgba(37, 99, 235, 0.35)";
  ctx.strokeStyle = "#2563EB";
  ctx.lineWidth = 1.5;
  pendingOccurrences.forEach((occ) => {
    if (!occ.checked || occ.page !== currentPage) return;
    const r = occ.rect;
    const x = r.fracX * overlayCanvas.width, y = r.fracY * overlayCanvas.height;
    const w = r.fracW * overlayCanvas.width, h = r.fracH * overlayCanvas.height;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  });

  if (currentDragPx) {
    ctx.fillStyle = "rgba(37, 99, 235, 0.35)";
    ctx.fillRect(currentDragPx.x, currentDragPx.y, currentDragPx.w, currentDragPx.h);
  }
}

function pointerPos(e) {
  const rect = previewCanvas.getBoundingClientRect();
  return {
    x: clamp(e.clientX - rect.left, 0, rect.width) * (previewCanvas.width / rect.width),
    y: clamp(e.clientY - rect.top, 0, rect.height) * (previewCanvas.height / rect.height),
  };
}

cavWrap.style.touchAction = "none";

cavWrap.addEventListener("pointerdown", (e) => {
  if (!srcDoc) return;
  dragging = true;
  dragStart = pointerPos(e);
  currentDragPx = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
  redrawOverlay();
  try { cavWrap.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
});

cavWrap.addEventListener("pointermove", (e) => {
  if (!dragging || !dragStart) return;
  const cur = pointerPos(e);
  const left = Math.min(dragStart.x, cur.x);
  const top = Math.min(dragStart.y, cur.y);
  currentDragPx = { x: left, y: top, w: Math.abs(cur.x - dragStart.x), h: Math.abs(cur.y - dragStart.y) };
  redrawOverlay();
});

function endDrag() {
  if (!dragging) return;
  dragging = false;
  if (currentDragPx && currentDragPx.w >= 4 && currentDragPx.h >= 4) {
    const list = redactions.get(currentPage) || [];
    list.push({
      fracX: currentDragPx.x / overlayCanvas.width,
      fracY: currentDragPx.y / overlayCanvas.height,
      fracW: currentDragPx.w / overlayCanvas.width,
      fracH: currentDragPx.h / overlayCanvas.height,
    });
    redactions.set(currentPage, list);
  }
  currentDragPx = null;
  redrawOverlay();
  updateCaviarderBtn();
}
cavWrap.addEventListener("pointerup", endDrag);
cavWrap.addEventListener("pointercancel", endDrag);

prevPageBtn.addEventListener("click", async () => {
  if (currentPage <= 1) return;
  currentPage--;
  await renderCurrentPage();
});
nextPageBtn.addEventListener("click", async () => {
  if (currentPage >= pageCount) return;
  currentPage++;
  await renderCurrentPage();
});

clearPageBtn.addEventListener("click", () => {
  redactions.delete(currentPage);
  redrawOverlay();
  updateCaviarderBtn();
});
clearAllBtn.addEventListener("click", () => {
  redactions = new Map();
  redrawOverlay();
  updateCaviarderBtn();
});

// ---------- Rechercher et caviarder (motifs) ----------
/*
 * Recherche de texte via pdf.js getTextContent() : les items de chaque page
 * sont regroupés en lignes (même ligne de base), le texte de la ligne est
 * reconstitué caractère par caractère avec la position de CHAQUE caractère
 * (largeur d'un item répartie entre ses caractères au prorata d'une mesure
 * canvas, approche de js/modifier-pdf.js). Les motifs sont appliqués sur le
 * texte de ligne complet, donc une occurrence à cheval sur plusieurs items
 * est retrouvée et sa boîte exacte est calculée à partir des caractères.
 * Les rectangles obtenus sont convertis en fractions de page (axe Y et
 * rotation gérés par viewport.convertToViewportPoint) et rejoignent les
 * zones manuelles : la garantie par rasterisation est inchangée.
 */

const SEARCH_MARGIN_PT = 1.5; // marge autour de chaque rectangle trouvé, en points PDF

let pendingOccurrences = []; // occurrences trouvées, pas encore ajoutées aux zones
let occSeq = 0;

const searchTextInput = document.getElementById("searchText");
const searchWholeWord = document.getElementById("searchWholeWord");
const searchCaseSensitive = document.getElementById("searchCaseSensitive");
const searchBtn = document.getElementById("searchBtn");
const searchSummary = document.getElementById("searchSummary");
const occPanel = document.getElementById("occPanel");
const occList = document.getElementById("occList");
const occSelectAll = document.getElementById("occSelectAll");
const addOccBtn = document.getElementById("addOccBtn");
const clearOccBtn = document.getElementById("clearOccBtn");

function isDigitChar(ch) { return !!ch && ch >= "0" && ch <= "9"; }
function isWordChar(ch) { return !!ch && /[\p{L}\p{N}_]/u.test(ch); }
function isAlnumChar(ch) { return !!ch && /[A-Za-z0-9]/.test(ch); }

/**
 * Frontière étendue pour les suites de chiffres : vrai si un chiffre précède ou
 * suit le candidat, même après des séparateurs (ex. le morceau « 0532 0130 00 »
 * d'un IBAN groupé par 4 n'est pas un numéro de téléphone).
 */
function digitsAround(line, start, end, sepRe) {
  let k = start - 1;
  while (k >= 0 && sepRe.test(line[k])) k--;
  if (isDigitChar(line[k])) return true;
  let j = end;
  while (j < line.length && sepRe.test(line[j])) j++;
  return isDigitChar(line[j]);
}

/** Reste modulo 97 d'un grand nombre écrit en chiffres (évite BigInt, suffisant ici). */
function mod97(digits) {
  let r = 0;
  for (let i = 0; i < digits.length; i++) r = (r * 10 + (digits.charCodeAt(i) - 48)) % 97;
  return r;
}

/** Algorithme de Luhn (cartes bancaires). */
function luhnOk(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Longueur (hors espaces) des IBAN des pays les plus courants ; sinon 15 à 34.
const IBAN_LENGTHS = { FR: 27, MC: 27, DE: 22, BE: 16, ES: 24, IT: 27, NL: 18, LU: 20, CH: 21, GB: 22, PT: 25, AT: 20, IE: 22, PL: 28, SE: 24, DK: 18, NO: 15, FI: 18, GR: 27, RO: 24, CZ: 24, HU: 28, SK: 24, SI: 19, HR: 21, BG: 22, LT: 20, LV: 21, EE: 20, MT: 31, CY: 28, LI: 21, IS: 26, AD: 24, SM: 27, VA: 22 };

/** Validation IBAN : longueur du pays, clé mod 97 (doit valoir 1) et, pour FR/MC, clé RIB du BBAN. */
function ibanValid(compact) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const country = compact.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (expected ? compact.length !== expected : (compact.length < 15 || compact.length > 34)) return false;
  // Lettres converties en nombres (A=10 … Z=35) après rotation des 4 premiers caractères.
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  if (mod97(numeric) !== 1) return false;
  if (country === "FR" || country === "MC") {
    // Un BBAN nul (« FR76 0000 … ») passe le mod 97 : la clé RIB l'élimine.
    // Clé RIB = 97 - (89 x banque + 15 x guichet + 3 x compte) mod 97, lettres du
    // compte converties selon la table RIB (A/J=1, B/K/S=2, …).
    const bban = compact.slice(4);
    const bank = bban.slice(0, 5), branch = bban.slice(5, 10), key = bban.slice(21, 23);
    const account = bban.slice(10, 21).replace(/[A-Z]/g, (c) => {
      const v = c.charCodeAt(0) - 64; // A=1 … Z=26
      return String(v <= 9 ? v : v <= 18 ? v - 9 : v - 17);
    });
    if (!/^\d+$/.test(bank + branch + account + key)) return false;
    const ribKey = 97 - ((mod97(bank) * 89 + mod97(branch) * 15 + mod97(account) * 3) % 97);
    if (ribKey !== Number(key)) return false;
  }
  return true;
}

/** Clé du NIR : 97 - (13 premiers chiffres mod 97), Corse 2A -> 19 et 2B -> 18. */
function nirValid(compact) {
  const m = /^([12]\d{4}(?:\d{2}|2[AB])\d{6})(\d{2})$/.exec(compact);
  if (!m) return false;
  const body = m[1].replace("2A", "19").replace("2B", "18");
  return 97 - mod97(body) === Number(m[2]);
}

function dateValid(day, month, year) {
  if (month < 1 || month > 12 || day < 1 || year < 1800 || year > 2199) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Motifs prédéfinis. Pour chacun : regex (repère les candidats) et validate()
 * (élimine les faux positifs ; peut raccourcir le candidat en renvoyant une
 * longueur). validate reçoit (texte du candidat, texte de ligne, index) et
 * renvoie false pour rejeter, true pour accepter, ou un nombre : la longueur
 * acceptée. Les frontières (chiffre ou lettre collé avant/après) sont
 * vérifiées pour ne pas découper une suite plus longue.
 */
const PATTERNS = {
  email: {
    label: "E-mail",
    re: /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g,
    validate(text, line, idx) {
      if (isWordChar(line[idx - 1]) || isWordChar(line[idx + text.length])) return false;
      return !/\.\./.test(text) && !/^\./.test(text) && !/\.@/.test(text);
    },
  },
  phone: {
    label: "Téléphone",
    // 1) +33 (avec ou sans « (0) ») ; 2) international +XX ; 3) français 0X XX XX XX XX
    // (séparateurs : espace, point, tiret, ou aucun).
    re: /\+33[\s.-]?(?:\(0\)[\s.-]?)?[1-9](?:[\s.-]?\d{2}){4}|\+\d{1,3}(?:[\s.-]?\(0\))?(?:[\s.-]?\d{1,4}){2,6}|0[1-9](?:[\s.-]?\d{2}){4}/g,
    validate(text, line, idx) {
      if (line[idx - 1] === "+" || digitsAround(line, idx, idx + text.length, /[\s.-]/)) return false;
      const digits = text.replace(/\(0\)/, "").replace(/\D/g, "");
      if (text[0] === "0") return digits.length === 10;
      if (text.startsWith("+33")) return digits.length === 11;
      return digits.length >= 8 && digits.length <= 15;
    },
  },
  iban: {
    label: "IBAN",
    re: /[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?/g,
    validate(text, line, idx) {
      if (isAlnumChar(line[idx - 1])) return false;
      const compact = text.replace(/ /g, "");
      const expected = IBAN_LENGTHS[compact.slice(0, 2)];
      // Candidat trop long (chiffres qui suivent sur la ligne) : on le raccourcit à la longueur du pays.
      let len = text.length;
      if (expected && compact.length > expected) {
        let n = 0;
        for (len = 0; len < text.length && n < expected; len++) if (text[len] !== " ") n++;
      }
      const trimmed = text.slice(0, len);
      if (isAlnumChar(line[idx + len])) return false;
      return ibanValid(trimmed.replace(/ /g, "")) ? len : false;
    },
  },
  nir: {
    label: "NIR",
    re: /[12] ?\d{2} ?(?:0[1-9]|1[0-2]|[2-9]\d) ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}/g,
    validate(text, line, idx) {
      if (isDigitChar(line[idx - 1]) || isDigitChar(line[idx + text.length])) return false;
      return nirValid(text.replace(/ /g, ""));
    },
  },
  card: {
    label: "Carte bancaire",
    re: /\d(?:[ -]?\d){12,18}/g,
    validate(text, line, idx) {
      if (digitsAround(line, idx, idx + text.length, /[ -]/)) return false;
      const digits = text.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhnOk(digits);
    },
  },
  date: {
    label: "Date",
    re: /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}|\d{4}-\d{2}-\d{2}/g,
    validate(text, line, idx) {
      if (isDigitChar(line[idx - 1]) || isDigitChar(line[idx + text.length])) return false;
      const p = text.split(/[\/.-]/).map(Number);
      return p[0] > 31 ? dateValid(p[2], p[1], p[0]) : dateValid(p[0], p[1], p[2]);
    },
  },
  ip: {
    label: "Adresse IP",
    re: /(?:\d{1,3}\.){3}\d{1,3}|(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}/g,
    validate(text, line, idx) {
      const before = line[idx - 1], after = line[idx + text.length];
      if (isAlnumChar(before) || isAlnumChar(after) || before === "." || after === "." || before === ":" || after === ":") return false;
      if (text.indexOf(":") === -1) return text.split(".").every((o) => Number(o) <= 255);
      // IPv6 : 7 séparateurs et 8 groupes, ou une abréviation « :: » unique ; exclut les heures (14:30:00).
      const groups = text.split(":");
      const hasDouble = text.indexOf("::") !== -1;
      if (hasDouble) return text.split("::").length === 2 && groups.length <= 8 && /[0-9A-Fa-f]/.test(text);
      return groups.length === 8 && groups.every((g) => g.length > 0);
    },
  },
};

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Construit la liste des motifs actifs (prédéfinis cochés + texte libre). */
function activeMatchers() {
  const matchers = [];
  document.querySelectorAll(".cav-pattern:checked").forEach((cb) => {
    const p = PATTERNS[cb.value];
    if (p) matchers.push({ kind: cb.value, label: p.label, re: p.re, validate: p.validate });
  });
  const free = searchTextInput.value.trim();
  if (free) {
    const whole = searchWholeWord.checked;
    const re = new RegExp(escapeRegExp(free), searchCaseSensitive.checked ? "gu" : "giu");
    matchers.push({
      kind: "text",
      label: "Texte",
      re,
      validate(text, line, idx) {
        return !whole || (!isWordChar(line[idx - 1]) && !isWordChar(line[idx + text.length]));
      },
    });
  }
  return matchers;
}

let searchMeasureCanvas = null;

/** Famille CSS la plus proche de la police de l'item (pdf.js ne fournit qu'une famille générique) pour une répartition fidèle des largeurs. */
function cssFamilyFor(item, styles) {
  const generic = (styles && styles[item.fontName] && styles[item.fontName].fontFamily) || "";
  if (/mono/i.test(generic)) return "\"Courier New\", Courier, monospace";
  if (/^serif/i.test(generic)) return "\"Times New Roman\", Times, serif";
  return "Helvetica, Arial, \"Liberation Sans\", sans-serif";
}

/** Répartit la largeur connue d'un item (points PDF) entre ses caractères, au prorata d'une mesure canvas. */
function layoutSearchChars(item, fontHeight, styles) {
  if (!searchMeasureCanvas) searchMeasureCanvas = document.createElement("canvas");
  const ctx = searchMeasureCanvas.getContext("2d");
  ctx.font = "100px " + cssFamilyFor(item, styles);
  const text = item.str;
  const raw = [];
  let rawTotal = 0;
  for (let i = 0; i < text.length; i++) {
    const w = ctx.measureText(text[i]).width;
    raw.push(w);
    rawTotal += w;
  }
  const total = item.width > 0 ? item.width : (rawTotal / 100) * fontHeight;
  const scale = rawTotal > 0 ? total / rawTotal : 0;
  let x = item.transform[4];
  const chars = [];
  for (let i = 0; i < text.length; i++) {
    const w = raw[i] * scale;
    chars.push({ ch: text[i], x, width: w, h: fontHeight });
    x += w;
  }
  return chars;
}

/**
 * Regroupe les items horizontaux d'une page en lignes : { baseline, chars, text }.
 * Un espace est inséré entre deux items séparés par un blanc visible, pour
 * que « 06 12 34 56 78 » reste lisible même si pdf.js le découpe en morceaux.
 */
function buildSearchLines(items, styles) {
  const rawLines = [];
  for (const item of items) {
    if (!item.str || !item.transform) continue;
    // Texte tourné (matrice non horizontale) : ignoré, signalé dans l'encadré.
    if (Math.abs(item.transform[1]) > 0.01 || Math.abs(item.transform[2]) > 0.01) continue;
    const y = item.transform[5];
    const h = Math.abs(item.transform[3]) || item.height || 10;
    let line = rawLines.find((l) => Math.abs(l.y - y) <= Math.max(2, h * 0.3));
    if (!line) { line = { y, items: [] }; rawLines.push(line); }
    line.items.push(item);
  }
  rawLines.sort((a, b) => b.y - a.y);
  return rawLines.map((rl) => {
    rl.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let chars = [];
    for (const it of rl.items) {
      const h = Math.abs(it.transform[3]) || it.height || 10;
      const itemChars = layoutSearchChars(it, h, styles);
      if (!itemChars.length) continue;
      if (chars.length) {
        const last = chars[chars.length - 1];
        const prevEnd = last.x + last.width;
        const gap = itemChars[0].x - prevEnd;
        if (gap > h * 0.12 && !/\s/.test(last.ch) && !/\s/.test(itemChars[0].ch)) {
          chars.push({ ch: " ", x: prevEnd, width: gap, h, synthetic: true });
        }
      }
      chars = chars.concat(itemChars);
    }
    return { baseline: rl.y, chars, text: chars.map((c) => c.ch).join("") };
  });
}

/** Applique les motifs à une ligne et renvoie les occurrences { start, end, kind, label } sans chevauchement. */
function matchLine(line, matchers) {
  const found = [];
  for (const m of matchers) {
    m.re.lastIndex = 0;
    let r;
    while ((r = m.re.exec(line.text)) !== null) {
      if (r[0].length === 0) { m.re.lastIndex++; continue; }
      const verdict = m.validate(r[0], line.text, r.index);
      if (verdict) {
        const len = typeof verdict === "number" ? verdict : r[0].length;
        found.push({ start: r.index, end: r.index + len, kind: m.kind, label: m.label });
      }
      // Reprend juste après le début du candidat : un candidat rejeté ne doit pas masquer un autre départ.
      m.re.lastIndex = r.index + 1;
    }
  }
  // Chevauchements (ex. carte bancaire incluse dans un IBAN) : la plus longue l'emporte.
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const f of found) {
    if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Boîte PDF (points) d'une occurrence sur une ligne, avec la marge, puis conversion en fractions de page. */
function occurrenceRect(line, start, end, viewport) {
  let s = start, e = end;
  while (s < e && /\s/.test(line.chars[s].ch)) s++;
  while (e > s && /\s/.test(line.chars[e - 1].ch)) e--;
  const slice = line.chars.slice(s, e);
  const x0 = slice[0].x;
  const x1 = slice[slice.length - 1].x + slice[slice.length - 1].width;
  const h = Math.max.apply(null, slice.map((c) => c.h));
  const m = SEARCH_MARGIN_PT;
  // Descente ~0,25 h sous la ligne de base, hauteur totale ~1,25 h (accents compris).
  const corners = [
    [x0 - m, line.baseline - h * 0.25 - m],
    [x1 + m, line.baseline - h * 0.25 - m],
    [x0 - m, line.baseline + h * 1.0 + m],
    [x1 + m, line.baseline + h * 1.0 + m],
  ].map(([px, py]) => viewport.convertToViewportPoint(px, py));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const left = clamp(Math.min.apply(null, xs) / viewport.width, 0, 1);
  const right = clamp(Math.max.apply(null, xs) / viewport.width, 0, 1);
  const top = clamp(Math.min.apply(null, ys) / viewport.height, 0, 1);
  const bottom = clamp(Math.max.apply(null, ys) / viewport.height, 0, 1);
  return { fracX: left, fracY: top, fracW: right - left, fracH: bottom - top };
}

/** Masque partiellement une valeur pour l'affichage dans la liste (ex. « j***@exemple.fr »). */
function maskForDisplay(text, kind) {
  if (kind === "email") {
    const at = text.indexOf("@");
    return text.slice(0, 1) + "***" + text.slice(at);
  }
  if (text.length <= 4) return text.slice(0, 1) + "***";
  return text.slice(0, 1) + "***" + text.slice(-2);
}

function resetSearch() {
  pendingOccurrences = [];
  occList.textContent = "";
  occPanel.style.display = "none";
  searchSummary.textContent = "";
}

/** Parcourt toutes les pages et remplit la liste des occurrences. */
async function runSearch() {
  if (!srcDoc) return;
  hideMsg();
  const matchers = activeMatchers();
  if (!matchers.length) {
    showMsg("Saisissez un texte à rechercher ou cochez au moins un motif prédéfini.");
    return;
  }
  searchBtn.disabled = true;
  pendingOccurrences = [];
  try {
    for (let p = 1; p <= pageCount; p++) {
      setProgress(Math.round((p / pageCount) * 100), "Recherche sur la page " + p + " / " + pageCount + "…");
      const jsPage = await srcDoc.getPage(p);
      const viewport = jsPage.getViewport({ scale: 1 });
      const content = await jsPage.getTextContent();
      const lines = buildSearchLines(content.items, content.styles);
      for (const line of lines) {
        for (const occ of matchLine(line, matchers)) {
          const text = line.text.slice(occ.start, occ.end).trim();
          if (!text) continue;
          pendingOccurrences.push({
            id: ++occSeq,
            page: p,
            kind: occ.kind,
            label: occ.label,
            text,
            display: maskForDisplay(text, occ.kind),
            rect: occurrenceRect(line, occ.start, occ.end, viewport),
            checked: true,
          });
        }
      }
    }
    hideProgress();
    renderOccList();
    redrawOverlay();
  } catch (e) {
    hideProgress();
    showMsg("La recherche a échoué sur ce document. Vous pouvez tout de même caviarder à la main.");
  } finally {
    searchBtn.disabled = false;
  }
}

function renderOccList() {
  occList.textContent = "";
  const n = pendingOccurrences.length;
  if (n === 0) {
    occPanel.style.display = "none";
    searchSummary.textContent = "Aucune occurrence trouvée. Le texte est peut-être dans une image (voir l'OCR) ou découpé autrement.";
    return;
  }
  searchSummary.textContent = n + " occurrence" + (n > 1 ? "s" : "") + " trouvée" + (n > 1 ? "s" : "") + ".";
  occPanel.style.display = "block";
  pendingOccurrences.forEach((occ) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.className = "cav-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = occ.checked;
    cb.className = "cav-occ-check";
    cb.setAttribute("aria-label", occ.label + " page " + occ.page + " : " + occ.display);
    cb.addEventListener("change", () => {
      occ.checked = cb.checked;
      syncSelectAll();
      redrawOverlay();
    });
    const kind = document.createElement("span");
    kind.className = "cav-occ-kind";
    kind.textContent = occ.label + " · p. " + occ.page;
    const txt = document.createElement("span");
    txt.className = "cav-occ-text";
    txt.textContent = occ.display;
    label.appendChild(cb);
    label.appendChild(kind);
    label.appendChild(txt);
    const goto = document.createElement("button");
    goto.type = "button";
    goto.className = "btn-secondary";
    goto.textContent = "Voir";
    goto.setAttribute("aria-label", "Afficher la page " + occ.page);
    goto.addEventListener("click", async () => {
      if (currentPage !== occ.page) {
        currentPage = occ.page;
        await renderCurrentPage();
      }
      cavWrap.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    li.appendChild(label);
    li.appendChild(goto);
    occList.appendChild(li);
  });
  syncSelectAll();
}

function syncSelectAll() {
  const checked = pendingOccurrences.filter((o) => o.checked).length;
  occSelectAll.checked = checked > 0 && checked === pendingOccurrences.length;
  occSelectAll.indeterminate = checked > 0 && checked < pendingOccurrences.length;
  addOccBtn.disabled = checked === 0;
}

occSelectAll.addEventListener("change", () => {
  pendingOccurrences.forEach((o) => { o.checked = occSelectAll.checked; });
  occList.querySelectorAll(".cav-occ-check").forEach((cb) => { cb.checked = occSelectAll.checked; });
  syncSelectAll();
  redrawOverlay();
});

/** Transforme les occurrences cochées en zones du pipeline existant (rasterisation garantie). */
addOccBtn.addEventListener("click", () => {
  const selected = pendingOccurrences.filter((o) => o.checked);
  if (!selected.length) return;
  selected.forEach((o) => {
    const list = redactions.get(o.page) || [];
    list.push(o.rect);
    redactions.set(o.page, list);
  });
  pendingOccurrences = pendingOccurrences.filter((o) => !o.checked);
  renderOccList();
  if (!pendingOccurrences.length) searchSummary.textContent = "";
  redrawOverlay();
  updateCaviarderBtn();
  const pages = new Set(selected.map((o) => o.page));
  showMsg(selected.length + " zone" + (selected.length > 1 ? "s" : "") + " ajoutée" + (selected.length > 1 ? "s" : "") + " sur " + pages.size + " page" + (pages.size > 1 ? "s" : "") + ". Vérifiez l'aperçu puis cliquez sur « Caviarder le PDF ».");
});

clearOccBtn.addEventListener("click", () => {
  resetSearch();
  redrawOverlay();
});

searchBtn.addEventListener("click", runSearch);
searchTextInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runSearch(); }
});

async function runCaviarder() {
  hideMsg();
  document.getElementById("result").classList.remove("visible");

  if (totalRedactionCount() === 0) {
    showMsg("Dessinez au moins une zone à caviarder avant de continuer.");
    return;
  }

  caviarderBtn.disabled = true;
  try {
    setProgress(5, "Ouverture du document…");
    const { PDFDocument } = PDFLib;
    let inDoc;
    try {
      inDoc = await PDFDocument.load(srcBytes);
    } catch (e) {
      throw new Error("Impossible d'ouvrir ce PDF pour le caviardage. Il est peut-être protégé par mot de passe ou endommagé.");
    }

    const outDoc = await PDFDocument.create();
    const total = inDoc.getPageCount();

    for (let i = 0; i < total; i++) {
      const pageNum = i + 1;
      const rects = redactions.get(pageNum);
      setProgress(5 + Math.round((i / total) * 85), "Traitement de la page " + pageNum + " / " + total + "…");

      if (!rects || rects.length === 0) {
        const [copied] = await outDoc.copyPages(inDoc, [i]);
        outDoc.addPage(copied);
        continue;
      }

      // Page a caviarder : rendue entierement en image, zones noircies dans les pixels.
      const jsPage = await srcDoc.getPage(pageNum);
      const viewport = jsPage.getViewport({ scale: RASTER_SCALE });
      const rasterCanvas = document.createElement("canvas");
      rasterCanvas.width = Math.round(viewport.width);
      rasterCanvas.height = Math.round(viewport.height);
      const ctx = rasterCanvas.getContext("2d");
      await jsPage.render({ canvasContext: ctx, viewport }).promise;

      ctx.fillStyle = "#000000";
      rects.forEach((r) => {
        ctx.fillRect(r.fracX * rasterCanvas.width, r.fracY * rasterCanvas.height, r.fracW * rasterCanvas.width, r.fracH * rasterCanvas.height);
      });

      const blob = await new Promise((resolve) => rasterCanvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("La conversion de la page " + pageNum + " a échoué.");
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const pngImage = await outDoc.embedPng(pngBytes);

      const origPage = inDoc.getPage(i);
      const pw = origPage.getWidth();
      const ph = origPage.getHeight();
      const newPage = outDoc.addPage([pw, ph]);
      newPage.drawImage(pngImage, { x: 0, y: 0, width: pw, height: ph });
    }

    setProgress(95, "Génération du fichier final…");
    const bytes = await outDoc.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, "tchadiapdf-caviarde.pdf");
  } catch (err) {
    hideProgress();
    showError(err.message || "Le caviardage a échoué. Vérifiez votre fichier et réessayez.", { retry: runCaviarder });
  } finally {
    updateCaviarderBtn();
  }
}

caviarderBtn.addEventListener("click", runCaviarder);
