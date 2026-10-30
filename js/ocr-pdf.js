/* tchadiaPdf : OCR PDF (ajout d'une couche de texte recherchable sur un PDF scanné)
 *
 * Fonctionnement général :
 *   1. chaque page est rendue par pdf.js dans un canvas à l'échelle 2 ;
 *   2. si l'option est active, l'inclinaison est estimée puis corrigée (voir
 *      estimerInclinaison / pivoterCanvas) ;
 *   3. Tesseract.js reconnaît le texte dans le navigateur ;
 *   4. pdf-lib reconstruit la page : image redressée + texte invisible (mode de
 *      rendu 3) positionné mot à mot, ce qui rend le PDF cherchable.
 * Les pages qui contiennent déjà du texte sont recopiées telles quelles, sauf
 * si l'utilisateur force l'OCR.
 */

const MAX_SIZE = 50 * 1024 * 1024; // 50 Mo : l'OCR est un traitement lourd, plus restrictif que les autres outils
const SCALE = 2; // échelle de rendu des pages (meilleure précision OCR qu'à l'échelle 1)
const LANG_PATH_LOCAL = "/vendor/tesseract-5.1.1/lang";
const LANGS_PAR_DEFAUT = ["fra", "eng"];
// Nombre minimal de caractères (hors espaces) pour considérer qu'une page est
// déjà cherchable : en dessous (simple numéro de page, en-tête isolé), l'OCR
// est quand même lancé.
const SEUIL_TEXTE_EXISTANT = 20;
// Plage de recherche de l'inclinaison, en degrés.
const DESKEW_MAX_DEG = 5;
const DESKEW_PAS_DEG = 0.25;

/* Langues de reconnaissance disponibles (codes tessdata de Tesseract 4).
 * Seules « fra » et « eng » sont hébergées dans /vendor/ ; toutes les autres
 * sont téléchargées à la demande depuis le CDN public de Tesseract.js
 * (cdn.jsdelivr.net), uniquement après accord explicite de l'utilisateur. */
const LANGUES_LOCALES = new Set(["fra", "eng"]);

const LANGUES_COURANTES = [
  ["fra", "Français"],
  ["eng", "Anglais"],
  ["ara", "Arabe"],
  ["spa", "Espagnol"],
  ["por", "Portugais"],
  ["deu", "Allemand"],
  ["ita", "Italien"],
  ["nld", "Néerlandais"],
  ["tur", "Turc"],
  ["rus", "Russe"],
  ["chi_sim", "Chinois simplifié"],
  ["chi_tra", "Chinois traditionnel"],
  ["jpn", "Japonais"],
  ["kor", "Coréen"],
  ["hin", "Hindi"],
  ["pol", "Polonais"],
  ["ukr", "Ukrainien"],
  ["vie", "Vietnamien"],
  ["ind", "Indonésien"],
  ["swa", "Swahili"],
];

const AUTRES_LANGUES = [
  ["afr", "Afrikaans"],
  ["sqi", "Albanais"],
  ["deu_frak", "Allemand (fraktur)"],
  ["frk", "Allemand fraktur (ancien)"],
  ["amh", "Amharique"],
  ["enm", "Anglais moyen (1100 à 1500)"],
  ["hye", "Arménien"],
  ["asm", "Assamais"],
  ["aze", "Azéri (latin)"],
  ["aze_cyrl", "Azéri (cyrillique)"],
  ["eus", "Basque"],
  ["ben", "Bengali"],
  ["bel", "Biélorusse"],
  ["mya", "Birman"],
  ["bos", "Bosnien"],
  ["bre", "Breton"],
  ["bul", "Bulgare"],
  ["cat", "Catalan"],
  ["ceb", "Cebuano"],
  ["chr", "Cherokee"],
  ["chi_sim_vert", "Chinois simplifié (vertical)"],
  ["chi_tra_vert", "Chinois traditionnel (vertical)"],
  ["sin", "Cingalais"],
  ["kor_vert", "Coréen (vertical)"],
  ["cos", "Corse"],
  ["hat", "Créole haïtien"],
  ["hrv", "Croate"],
  ["dan", "Danois"],
  ["dan_frak", "Danois (fraktur)"],
  ["dzo", "Dzongkha"],
  ["spa_old", "Espagnol ancien"],
  ["epo", "Espéranto"],
  ["est", "Estonien"],
  ["fao", "Féroïen"],
  ["fil", "Filipino"],
  ["fin", "Finnois"],
  ["frm", "Français moyen (1400 à 1600)"],
  ["fry", "Frison occidental"],
  ["gla", "Gaélique écossais"],
  ["cym", "Gallois"],
  ["glg", "Galicien"],
  ["kat", "Géorgien"],
  ["kat_old", "Géorgien ancien"],
  ["ell", "Grec"],
  ["grc", "Grec ancien"],
  ["guj", "Gujarati"],
  ["heb", "Hébreu"],
  ["hun", "Hongrois"],
  ["iku", "Inuktitut"],
  ["gle", "Irlandais"],
  ["isl", "Islandais"],
  ["ita_old", "Italien ancien"],
  ["jpn_vert", "Japonais (vertical)"],
  ["jav", "Javanais"],
  ["kan", "Kannada"],
  ["kaz", "Kazakh"],
  ["khm", "Khmer"],
  ["kir", "Kirghize"],
  ["kmr", "Kurde kurmandji"],
  ["lao", "Lao"],
  ["lat", "Latin"],
  ["lav", "Letton"],
  ["lit", "Lituanien"],
  ["ltz", "Luxembourgeois"],
  ["mkd", "Macédonien"],
  ["msa", "Malais"],
  ["mal", "Malayalam"],
  ["div", "Maldivien (divehi)"],
  ["mlt", "Maltais"],
  ["mri", "Maori"],
  ["mar", "Marathi"],
  ["mon", "Mongol"],
  ["nep", "Népalais"],
  ["nor", "Norvégien"],
  ["oci", "Occitan"],
  ["ori", "Odia (oriya)"],
  ["uig", "Ouïghour"],
  ["urd", "Ourdou"],
  ["uzb", "Ouzbek (latin)"],
  ["uzb_cyrl", "Ouzbek (cyrillique)"],
  ["pus", "Pachto"],
  ["pan", "Pendjabi"],
  ["fas", "Persan"],
  ["que", "Quechua"],
  ["ron", "Roumain"],
  ["san", "Sanskrit"],
  ["srp", "Serbe (cyrillique)"],
  ["srp_latn", "Serbe (latin)"],
  ["snd", "Sindhi"],
  ["slk", "Slovaque"],
  ["slk_frak", "Slovaque (fraktur)"],
  ["slv", "Slovène"],
  ["sun", "Soundanais"],
  ["swe", "Suédois"],
  ["syr", "Syriaque"],
  ["tgk", "Tadjik"],
  ["tgl", "Tagalog"],
  ["tam", "Tamoul"],
  ["tat", "Tatar"],
  ["ces", "Tchèque"],
  ["tel", "Télougou"],
  ["tha", "Thaï"],
  ["bod", "Tibétain"],
  ["tir", "Tigrigna"],
  ["ton", "Tongien"],
  ["yid", "Yiddish"],
  ["yor", "Yoruba"],
];

const NOM_LANGUE = new Map([...LANGUES_COURANTES, ...AUTRES_LANGUES]);

let srcBytes = null;
let currentFile = null;
let worker = null;
let annule = false;
let totalPages = 0;
let currentPageIndex = 0;
let currentPageAngle = 0;
let languesChoisies = LANGS_PAR_DEFAUT.slice();
let modeSortie = "pdf"; // "pdf" ou "pdf-txt"
let avertissementLangueAffiche = false;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const ocrBtn = document.getElementById("ocrBtn");
const cancelBtn = document.getElementById("cancelBtn");
const resultEl = document.getElementById("result");
const txtLink = document.getElementById("txtLink");
const summaryEl = document.getElementById("ocrSummary");
const langChips = document.getElementById("langChips");
const langSearch = document.getElementById("langSearch");
const langList = document.getElementById("langList");
const deskewCheck = document.getElementById("deskewCheck");
const forceCheck = document.getElementById("forceCheck");
const outputSeg = document.getElementById("outputSeg");

/* ------------------------------------------------------------------ */
/* Sélecteur de langues                                                */
/* ------------------------------------------------------------------ */

/** Normalise une chaîne pour la recherche : minuscules, sans accents. */
function normaliser(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function construireListeLangues() {
  const emptyEl = langList.querySelector(".lang-empty");
  const groupes = [
    ["Langues courantes", LANGUES_COURANTES],
    ["Toutes les langues", AUTRES_LANGUES],
  ];
  for (const [titre, langues] of groupes) {
    const header = document.createElement("div");
    header.className = "lang-group";
    header.textContent = titre;
    langList.insertBefore(header, emptyEl);
    for (const [code, nom] of langues) {
      const label = document.createElement("label");
      label.className = "lang-item";
      label.dataset.code = code;
      label.dataset.search = normaliser(nom + " " + code);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = code;
      input.checked = languesChoisies.includes(code);
      input.addEventListener("change", () => basculerLangue(code, input.checked));
      const nomEl = document.createElement("span");
      nomEl.textContent = nom;
      label.appendChild(input);
      label.appendChild(nomEl);
      if (!LANGUES_LOCALES.has(code)) {
        const badge = document.createElement("span");
        badge.className = "lang-remote";
        badge.textContent = "téléchargement";
        badge.title = "Données de langue téléchargées à la demande depuis un réseau public";
        label.appendChild(badge);
      }
      const codeEl = document.createElement("span");
      codeEl.className = "lang-code";
      codeEl.textContent = code;
      label.appendChild(codeEl);
      langList.insertBefore(label, emptyEl);
    }
  }
  afficherJetons();
}

function basculerLangue(code, actif) {
  if (actif) {
    if (!languesChoisies.includes(code)) languesChoisies.push(code);
  } else {
    if (languesChoisies.length === 1 && languesChoisies[0] === code) {
      // Au moins une langue est indispensable au moteur : on refuse la désélection.
      const input = langList.querySelector('input[value="' + code + '"]');
      if (input) input.checked = true;
      showMsg("Au moins une langue doit rester sélectionnée pour lancer l'OCR.");
      return;
    }
    languesChoisies = languesChoisies.filter((c) => c !== code);
  }
  afficherJetons();
  mettreAJourAvertissementLangues();
}

function afficherJetons() {
  langChips.innerHTML = "";
  for (const code of languesChoisies) {
    const chip = document.createElement("span");
    chip.className = "lang-chip";
    chip.appendChild(document.createTextNode(NOM_LANGUE.get(code) || code));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "×";
    btn.setAttribute("aria-label", "Retirer " + (NOM_LANGUE.get(code) || code));
    btn.addEventListener("click", () => {
      const input = langList.querySelector('input[value="' + code + '"]');
      if (input) input.checked = false;
      basculerLangue(code, false);
    });
    chip.appendChild(btn);
    langChips.appendChild(chip);
  }
}

function filtrerLangues() {
  const q = normaliser(langSearch.value.trim());
  let visibles = 0;
  let groupeCourant = null;
  let groupeVisible = false;
  for (const el of langList.children) {
    if (el.classList.contains("lang-group")) {
      if (groupeCourant) groupeCourant.classList.toggle("hidden", !groupeVisible);
      groupeCourant = el;
      groupeVisible = false;
    } else if (el.classList.contains("lang-item")) {
      const ok = !q || el.dataset.search.includes(q);
      el.classList.toggle("hidden", !ok);
      if (ok) { visibles++; groupeVisible = true; }
    }
  }
  if (groupeCourant) groupeCourant.classList.toggle("hidden", !groupeVisible);
  langList.classList.toggle("is-empty", visibles === 0);
}

function languesDistantes() {
  return languesChoisies.filter((c) => !LANGUES_LOCALES.has(c));
}

/** Avertit, AVANT tout téléchargement, qu'une langue non hébergée ici sera
 * récupérée sur un réseau public au moment de l'OCR. Rien n'est téléchargé
 * tant que l'utilisateur n'a pas cliqué sur « Lancer l'OCR ». */
function mettreAJourAvertissementLangues() {
  const distantes = languesDistantes();
  if (distantes.length === 0) {
    if (avertissementLangueAffiche) hideMsg();
    avertissementLangueAffiche = false;
    return;
  }
  const noms = distantes.map((c) => NOM_LANGUE.get(c) || c);
  const liste = noms.length === 1 ? "La langue « " + noms[0] + " »" : "Les langues « " + noms.join(" », « ") + " »";
  showMsg(
    liste + (noms.length === 1 ? " sera téléchargée" : " seront téléchargées") +
    " depuis un réseau public (cdn.jsdelivr.net) au moment où vous cliquerez sur « Lancer l'OCR », " +
    "rien n'est téléchargé avant. Ce sont des données publiques de reconnaissance du moteur Tesseract, " +
    "jamais votre document, qui reste dans votre navigateur. Le moteur n'acceptant qu'une seule source de " +
    "données de langue par traitement, le français et l'anglais, s'ils sont aussi sélectionnés, seront alors " +
    "eux aussi récupérés depuis ce réseau plutôt que depuis tchadiapdf.com."
  );
  avertissementLangueAffiche = true;
}

construireListeLangues();
langSearch.addEventListener("input", filtrerLangues);
langSearch.addEventListener("keydown", (e) => {
  // Entrée dans la recherche : coche la première langue visible (usage clavier).
  if (e.key !== "Enter") return;
  e.preventDefault();
  const premier = langList.querySelector(".lang-item:not(.hidden) input");
  if (premier && !premier.checked) {
    premier.checked = true;
    basculerLangue(premier.value, true);
  }
});

outputSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  modeSortie = btn.dataset.mode;
  for (const b of outputSeg.querySelectorAll("button")) {
    const actif = b === btn;
    b.classList.toggle("active", actif);
    b.setAttribute("aria-pressed", actif ? "true" : "false");
  }
});

/* ------------------------------------------------------------------ */
/* Redressement (deskew)                                               */
/* ------------------------------------------------------------------ */

/** Seuil d'Otsu sur un histogramme de niveaux de gris (256 classes). */
function seuilOtsu(hist, total) {
  let somme = 0;
  for (let i = 0; i < 256; i++) somme += i * hist[i];
  let sommeB = 0, poidsB = 0, varMax = -1, seuil = 128;
  for (let t = 0; t < 256; t++) {
    poidsB += hist[t];
    if (poidsB === 0) continue;
    const poidsF = total - poidsB;
    if (poidsF === 0) break;
    sommeB += t * hist[t];
    const mB = sommeB / poidsB;
    const mF = (somme - sommeB) / poidsF;
    const v = poidsB * poidsF * (mB - mF) * (mB - mF);
    if (v > varMax) { varMax = v; seuil = t; }
  }
  return seuil;
}

/**
 * Estime l'angle d'inclinaison du texte (en degrés) par profil de projection
 * horizontal : sur une version binarisée réduite (largeur ~800 px), on
 * projette les pixels d'encre sur l'axe vertical pour chaque angle candidat
 * (de -5° à +5° par pas de 0,25°) et l'on retient l'angle qui maximise la
 * variance des sommes de lignes (lignes de texte nettes, interlignes vides).
 * Renvoie 0 si la page est vide, trop sombre ou si aucun angle ne fait
 * nettement mieux que 0°.
 */
function estimerInclinaison(canvas) {
  const scale = Math.min(1, 800 / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const petit = document.createElement("canvas");
  petit.width = w;
  petit.height = h;
  const ctx = petit.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  const total = w * h;
  const gris = new Uint8Array(total);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < total; i++, j += 4) {
    const g = (px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000;
    const v = g | 0;
    gris[i] = v;
    hist[v]++;
  }
  const seuil = seuilOtsu(hist, total);

  // Coordonnées (centrées) des pixels d'encre. Au-delà de 120 000 pixels,
  // on sous-échantillonne : la précision angulaire n'en souffre pas.
  let nbEncre = 0;
  for (let i = 0; i < total; i++) if (gris[i] < seuil) nbEncre++;
  if (nbEncre < 50 || nbEncre > total * 0.5) return 0;
  const pas = Math.max(1, Math.ceil(nbEncre / 120000));
  const xs = new Float32Array(Math.ceil(nbEncre / pas));
  const ys = new Float32Array(xs.length);
  const cx = w / 2, cy = h / 2;
  let n = 0, k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gris[y * w + x] >= seuil) continue;
      if (k++ % pas === 0 && n < xs.length) {
        xs[n] = x - cx;
        ys[n] = y - cy;
        n++;
      }
    }
  }

  // Taille fixe du profil quelle que soit l'inclinaison, pour que les variances
  // soient comparables entre angles.
  const marge = Math.ceil(w * Math.sin((DESKEW_MAX_DEG * Math.PI) / 180)) + 2;
  const L = h + 2 * marge;
  const profil = new Float64Array(L);

  function variancePour(deg) {
    const a = (deg * Math.PI) / 180;
    const s = Math.sin(a), c = Math.cos(a);
    profil.fill(0);
    for (let i = 0; i < n; i++) {
      const yp = Math.round(xs[i] * s + ys[i] * c + cy + marge);
      if (yp >= 0 && yp < L) profil[yp]++;
    }
    let somme = 0;
    for (let i = 0; i < L; i++) somme += profil[i];
    const moy = somme / L;
    let v = 0;
    for (let i = 0; i < L; i++) { const d = profil[i] - moy; v += d * d; }
    return v / L;
  }

  const varZero = variancePour(0);
  let meilleur = 0, varMax = varZero;
  for (let deg = -DESKEW_MAX_DEG; deg <= DESKEW_MAX_DEG + 1e-9; deg += DESKEW_PAS_DEG) {
    const d = Math.round(deg * 100) / 100;
    if (d === 0) continue;
    const v = variancePour(d);
    if (v > varMax) { varMax = v; meilleur = d; }
  }
  // Garde-fou : on ne pivote que si le gain est net (au moins 5 %), pour ne
  // pas « corriger » du bruit sur une page sans structure en lignes.
  if (varMax < varZero * 1.05) return 0;
  return meilleur;
}

/** Renvoie une copie du canvas pivotée de `deg` degrés autour de son centre, sur fond blanc. */
function pivoterCanvas(canvas, deg) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

/** Formate un angle pour l'affichage : « 3,25° ». */
function fmtAngle(deg) {
  return String(Math.abs(deg).toFixed(2)).replace(/\.?0+$/, "").replace(".", ",") + "°";
}

/* ------------------------------------------------------------------ */
/* Outils divers                                                       */
/* ------------------------------------------------------------------ */

/** Traduit les statuts internes de Tesseract.js en libellés français courts. */
function statusLabel(status) {
  const map = {
    "loading tesseract core": "Chargement du moteur OCR…",
    "initializing tesseract": "Initialisation du moteur OCR…",
    "initialized tesseract": "Moteur OCR prêt…",
    "loading language traineddata": "Chargement des données de langue…",
    "loading model": "Chargement des données de langue…",
    "initializing api": "Préparation du moteur…",
    "recognizing text": "Reconnaissance du texte…",
  };
  return map[status] || "Traitement…";
}

/** Libellé de progression pour la page courante, avec l'angle corrigé le cas échéant. */
function libellePage(prefix) {
  let s = prefix + " (page " + currentPageIndex + " / " + totalPages;
  if (currentPageAngle) s += ", inclinaison corrigée de " + fmtAngle(currentPageAngle);
  return s + ")…";
}

/** Rend une page pdf.js dans un nouveau canvas à l'échelle SCALE. */
async function rendrePage(page) {
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Texte déjà présent sur une page (pdf.js), ou chaîne vide. */
async function texteExistant(page) {
  try {
    const tc = await page.getTextContent();
    let s = "";
    for (const it of tc.items) {
      if (typeof it.str === "string") s += it.str + (it.hasEOL ? "\n" : " ");
    }
    return s;
  } catch (e) {
    return "";
  }
}

/** Ne garde d'un mot que les caractères encodables par la police standard
 * (WinAnsi) : les autres alphabets ne peuvent pas entrer dans le calque
 * invisible sans police Unicode embarquée, mais restent dans l'export .txt. */
function texteEncodable(font, texte) {
  try {
    font.encodeText(texte);
    return texte;
  } catch (e) {
    let out = "";
    for (const ch of texte) {
      try { font.encodeText(ch); out += ch; } catch (_) { /* caractère non encodable, ignoré */ }
    }
    return out;
  }
}

/** Remet l'interface au repos (fin normale, erreur ou annulation). */
function arreterTraitement() {
  hideProgress();
  cancelBtn.style.display = "none";
  ocrBtn.disabled = !srcBytes;
}

async function terminerWorker() {
  if (!worker) return;
  try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
  worker = null;
}

function pluriel(n, sing, plur) {
  return n + " " + (n > 1 ? plur : sing);
}

/* ------------------------------------------------------------------ */
/* Chargement du fichier                                               */
/* ------------------------------------------------------------------ */

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  avertissementLangueAffiche = false;
  resultEl.classList.remove("visible");
  const file = newFiles[0];

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 50 Mo fixée pour l'OCR, car ce traitement est particulièrement lourd. Choisissez un PDF plus léger.");
    return;
  }

  try {
    setProgress(5, "Lecture du fichier…");
    srcBytes = await readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;

    currentFile = file;
    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + pdf.numPages + (pdf.numPages > 1 ? " pages" : " page");
    fileInfo.classList.add("visible");
    ocrBtn.disabled = false;
    hideProgress();

    if (languesDistantes().length > 0) {
      mettreAJourAvertissementLangues();
    } else {
      showMsg(
        "L'OCR peut prendre plusieurs minutes selon la taille du document. Le moteur et les données de langue " +
        "(français et anglais, environ 4 Mo) sont servis par tchadiapdf.com lui-même : aucune requête vers un " +
        "service tiers, votre fichier reste dans votre navigateur. Gardez cet onglet ouvert pendant tout le traitement."
      );
    }
  } catch (e) {
    hideProgress();
    srcBytes = null;
    currentFile = null;
    ocrBtn.disabled = true;
    fileInfo.classList.remove("visible");
    if (e && e.name === "PasswordException") {
      showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant de lancer l'OCR.");
    } else {
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
    }
  }
});

cancelBtn.addEventListener("click", async () => {
  annule = true;
  cancelBtn.disabled = true;
  // Le terminate() peut faire échouer un recognize() en cours : attendu lors d'une annulation.
  await terminerWorker();
  cancelBtn.disabled = false;
});

/* ------------------------------------------------------------------ */
/* Création du moteur OCR                                              */
/* ------------------------------------------------------------------ */

/**
 * Crée le worker Tesseract pour les langues choisies.
 * Tesseract.js n'accepte qu'un seul chemin de données (langPath) par worker :
 *   - si toutes les langues sont hébergées ici (fra, eng), langPath pointe sur
 *     /vendor/ et aucune requête externe n'est émise ;
 *   - sinon, langPath est laissé indéfini et Tesseract.js utilise son chemin
 *     par défaut (cdn.jsdelivr.net/npm/@tesseract.js-data/<code>/4.0.0_best_int),
 *     qui contient le code de langue et ne peut donc pas être exprimé comme un
 *     unique préfixe distant : toutes les langues du traitement, y compris
 *     fra/eng, viennent alors de ce CDN. Ce choix est annoncé à l'utilisateur
 *     avant le clic (voir mettreAJourAvertissementLangues).
 */
async function creerWorker(langues) {
  const toutesLocales = langues.every((c) => LANGUES_LOCALES.has(c));
  const options = {
    workerPath: "/vendor/tesseract-5.1.1/worker.min.js",
    corePath: "/vendor/tesseract-5.1.1/core",
    gzip: true,
    logger: (m) => {
      if (!m || !m.status || typeof m.progress !== "number") return;
      const label = statusLabel(m.status);
      const base = totalPages > 0 && currentPageIndex > 0 ? ((currentPageIndex - 1) / totalPages) * 100 : 0;
      if (m.status === "recognizing text" && totalPages > 0 && currentPageIndex > 0) {
        const span = (1 / totalPages) * 100;
        const pct = Math.min(99, Math.round(base + span * m.progress));
        setProgress(pct, libellePage(label.replace(/…$/, "")));
      } else {
        setProgress(Math.round(base), label);
      }
    },
  };
  if (toutesLocales) options.langPath = LANG_PATH_LOCAL;
  return Tesseract.createWorker(langues, 1, options);
}

/* ------------------------------------------------------------------ */
/* Traitement principal                                                */
/* ------------------------------------------------------------------ */

ocrBtn.addEventListener("click", async () => {
  if (!srcBytes) return;

  hideMsg();
  avertissementLangueAffiche = false;
  resultEl.classList.remove("visible");
  txtLink.hidden = true;
  summaryEl.textContent = "";
  ocrBtn.disabled = true;
  cancelBtn.style.display = "inline-flex";
  annule = false;
  totalPages = 0;
  currentPageIndex = 0;
  currentPageAngle = 0;

  const langues = languesChoisies.slice();
  const redresser = deskewCheck.checked;
  const forcer = forceCheck.checked;
  const exporterTexte = modeSortie === "pdf-txt";

  // 1. Ouverture du PDF avec pdf.js (rendu, texte existant) et pdf-lib (copie
  //    des pages déjà cherchables).
  let pdf;
  try {
    setProgress(0, "Ouverture du document…");
    pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
  } catch (e) {
    arreterTraitement();
    if (e && e.name === "PasswordException") {
      showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant de lancer l'OCR.");
    } else {
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
    }
    return;
  }
  totalPages = pdf.numPages;

  if (typeof Tesseract === "undefined") {
    arreterTraitement();
    showMsg("Le moteur OCR (Tesseract.js) n'a pas pu être chargé. Rechargez la page, puis réessayez.");
    return;
  }

  const { PDFDocument, StandardFonts, setTextRenderingMode, TextRenderingMode } = PDFLib;
  let srcDoc = null;
  if (!forcer) {
    try {
      srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
      // Flux encore chiffrés (mot de passe utilisateur vide) : une copie serait illisible.
      if (srcDoc.isEncrypted) srcDoc = null;
    } catch (e) {
      // Impossible de recopier les pages d'origine : toutes seront rasterisées et reconnues.
      srcDoc = null;
    }
  }

  const outDoc = await PDFDocument.create();
  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const textesPages = [];
  const anglesCorriges = [];
  let pagesOcr = 0;
  let pagesConservees = 0;

  try {
    for (let i = 1; i <= totalPages; i++) {
      if (annule) break;
      currentPageIndex = i;
      currentPageAngle = 0;
      setProgress(Math.round(((i - 1) / totalPages) * 100), "Analyse de la page " + i + " / " + totalPages + "…");

      const page = await pdf.getPage(i);

      // 2. Page déjà cherchable : recopiée telle quelle (sauf OCR forcé).
      if (srcDoc) {
        const texte = await texteExistant(page);
        if (texte.replace(/\s+/g, "").length >= SEUIL_TEXTE_EXISTANT) {
          const [copie] = await outDoc.copyPages(srcDoc, [i - 1]);
          outDoc.addPage(copie);
          textesPages.push(texte.trim());
          pagesConservees++;
          continue;
        }
      }

      // 3. Rendu, redressement éventuel, puis reconnaissance.
      const viewport1 = page.getViewport({ scale: 1 });
      const pageWidthPt = viewport1.width;
      const pageHeightPt = viewport1.height;

      let canvas = await rendrePage(page);
      if (annule) break;

      if (redresser) {
        setProgress(Math.round(((i - 1) / totalPages) * 100), "Mesure de l'inclinaison de la page " + i + " / " + totalPages + "…");
        const angle = estimerInclinaison(canvas);
        if (angle !== 0) {
          canvas = pivoterCanvas(canvas, angle);
          currentPageAngle = angle;
          anglesCorriges.push(angle);
        }
      }

      if (!worker) {
        try {
          worker = await creerWorker(langues);
        } catch (e) {
          worker = null;
          if (annule) break;
          arreterTraitement();
          const distantes = langues.filter((c) => !LANGUES_LOCALES.has(c));
          showMsg(
            distantes.length > 0
              ? "Le moteur OCR n'a pas pu être initialisé : le téléchargement des données de langue depuis le réseau public a échoué. Vérifiez votre connexion ou limitez-vous au français et à l'anglais, disponibles hors ligne."
              : "Le moteur OCR n'a pas pu être initialisé. Rechargez la page, puis réessayez."
          );
          return;
        }
        if (annule) break;
      }

      setProgress(Math.round(((i - 1) / totalPages) * 100), libellePage("Reconnaissance du texte"));
      let data;
      try {
        const res = await worker.recognize(canvas);
        data = res.data;
      } catch (err) {
        if (annule) break; // La promesse a été rejetée par worker.terminate() : pas une vraie erreur.
        throw err;
      }
      if (annule) break;

      const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      const jpegBytes = await jpegBlob.arrayBuffer();
      const jpegImage = await outDoc.embedJpg(jpegBytes);

      const outPage = outDoc.addPage([pageWidthPt, pageHeightPt]);
      outPage.drawImage(jpegImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });

      // Calque de texte invisible : mode de rendu 3 du PDF (texte ni rempli ni
      // tracé, mais bien présent, sélectionnable et indexable), le même que
      // celui produit par les logiciels de numérisation.
      outPage.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
      const words = (data && data.words) || [];
      for (const w of words) {
        if (!w.text || !w.text.trim()) continue;
        const texte = texteEncodable(font, w.text);
        if (!texte.trim()) continue;
        const bbox = w.bbox;
        const xPt = bbox.x0 / SCALE;
        const hauteurPt = Math.max(1, (bbox.y1 - bbox.y0) / SCALE);
        const largeurPt = Math.max(1, (bbox.x1 - bbox.x0) / SCALE);
        // Ligne de base fournie par Tesseract quand elle existe, sinon bas de la boîte.
        const baseY = w.baseline && typeof w.baseline.y0 === "number" ? w.baseline.y0 : bbox.y1;
        // Taille réduite si besoin pour que le mot ne déborde pas de sa boîte :
        // la sélection et le surlignage de recherche restent calés sur l'image.
        const largeurNat = font.widthOfTextAtSize(texte, hauteurPt) || 1;
        const sizePt = Math.max(1, hauteurPt * Math.min(1, largeurPt / largeurNat));
        outPage.drawText(texte, { x: xPt, y: pageHeightPt - baseY / SCALE, size: sizePt, font });
      }
      textesPages.push(((data && data.text) || "").trim());
      pagesOcr++;
    }
  } catch (e) {
    await terminerWorker();
    arreterTraitement();
    showMsg("La reconnaissance de texte a échoué. Réessayez avec un autre fichier.");
    return;
  }

  await terminerWorker();

  if (annule) {
    arreterTraitement();
    showMsg("OCR annulé.");
    return;
  }

  // 4. Génération et téléchargement du fichier.
  try {
    setProgress(99, "Génération du PDF final…");
    const outBytes = await outDoc.save();
    arreterTraitement();

    const base = (currentFile && currentFile.name ? currentFile.name.replace(/\.pdf$/i, "") : "document") + "-ocr";
    offerDownload(outBytes, base + ".pdf");

    if (exporterTexte) {
      const texte = textesPages.map((t, idx) => "[Page " + (idx + 1) + "]\n" + t).join("\n\n");
      if (txtLink.dataset.url) URL.revokeObjectURL(txtLink.dataset.url);
      const url = URL.createObjectURL(new Blob([texte], { type: "text/plain;charset=utf-8" }));
      txtLink.dataset.url = url;
      txtLink.href = url;
      txtLink.download = base + ".txt";
      txtLink.hidden = false;
    }

    const parts = [];
    parts.push(pluriel(pagesOcr, "page reconnue par OCR", "pages reconnues par OCR"));
    if (pagesConservees > 0) parts.push(pluriel(pagesConservees, "page déjà cherchable conservée telle quelle", "pages déjà cherchables conservées telles quelles"));
    if (redresser) {
      parts.push(
        anglesCorriges.length > 0
          ? pluriel(anglesCorriges.length, "page redressée", "pages redressées") + " (" + anglesCorriges.map(fmtAngle).join(", ") + ")"
          : "aucune inclinaison détectée"
      );
    }
    summaryEl.textContent = parts.join(" · ") + ".";
    summaryEl.dataset.pagesOcr = String(pagesOcr);
    summaryEl.dataset.pagesConservees = String(pagesConservees);
    summaryEl.dataset.angles = anglesCorriges.join(";");

    if (pagesOcr === 0 && pagesConservees > 0) {
      showMsg("Toutes les pages de ce document contiennent déjà du texte : il a été recopié sans reconnaissance. Cochez « Forcer l'OCR » pour relancer quand même la reconnaissance sur l'image des pages.");
    }
  } catch (e) {
    arreterTraitement();
    showMsg("La génération du PDF final a échoué. Réessayez avec un autre fichier.");
  }
});
