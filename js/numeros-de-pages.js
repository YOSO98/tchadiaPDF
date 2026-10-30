/* tchadiaPdf : Numéros de page, numérotation Bates, en-tête et pied de page */

const TAILLE_MAX_OCTETS = 100 * 1024 * 1024; // 100 Mo
const MAX_FICHIERS_LOT = 50;

let srcBytes = null; // utilisé uniquement en mode "un seul fichier"
let mode = "numeros"; // numeros | bates | entete
let position = "bas-droite";
let taille = 12;
let format = "n";
let policeChoisie = "helvetica";

// File d'attente utilisée dès que 2 fichiers ou plus sont sélectionnés
let queue = []; // { id, file, status: "attente" | "cours" | "termine" | "erreur", error, pages }
let nextId = 1;
let batchState = "idle"; // idle | running | paused | cancelled
let batchRunning = false;

const numBtn = document.getElementById("numBtn");
const numOptions = document.getElementById("numOptions");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const fileListEl = document.getElementById("fileList");
const batchActions = document.getElementById("batchActions");
const startBatchBtn = document.getElementById("startBatchBtn");
const pauseBatchBtn = document.getElementById("pauseBatchBtn");
const cancelBatchBtn = document.getElementById("cancelBatchBtn");
const globalProgress = document.getElementById("globalProgress");
const globalProgressLabel = document.getElementById("globalProgressLabel");
const resultEl = document.getElementById("result");
const apercuBates = document.getElementById("apercuBates");
const apercuPage = document.getElementById("apercuPage");
const apercuCanvas = document.getElementById("apercuCanvas");

const batesPrefixe = document.getElementById("batesPrefixe");
const batesSuffixe = document.getElementById("batesSuffixe");
const batesDepart = document.getElementById("batesDepart");
const batesChiffres = document.getElementById("batesChiffres");
const margeInput = document.getElementById("margeInput");
const sauterPremiere = document.getElementById("sauterPremiere");
const plagePages = document.getElementById("plagePages");
const ZONES = {
  "haut-gauche": document.getElementById("zoneHautGauche"),
  "haut-centre": document.getElementById("zoneHautCentre"),
  "haut-droite": document.getElementById("zoneHautDroite"),
  "bas-gauche": document.getElementById("zoneBasGauche"),
  "bas-centre": document.getElementById("zoneBasCentre"),
  "bas-droite": document.getElementById("zoneBasDroite")
};

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");

  if (batchRunning) {
    showMsg("Un traitement est en cours. Attendez la fin ou annulez le lot avant d'ajouter des fichiers.");
    return;
  }

  const valides = [];
  let ignores = 0;
  newFiles.forEach((file) => {
    const estPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!estPdf || file.size > TAILLE_MAX_OCTETS) {
      ignores++;
      return;
    }
    valides.push(file);
  });

  const placesRestantes = Math.max(MAX_FICHIERS_LOT - queue.length, 0);
  const ajoutes = valides.slice(0, placesRestantes);
  const refuses = valides.length - ajoutes.length;

  ajoutes.forEach((file) => {
    queue.push({ id: nextId++, file, status: "attente", error: "", pages: null });
  });

  const messages = [];
  if (ignores > 0) {
    messages.push(ignores + " fichier(s) ignoré(s) : format non PDF ou taille supérieure à 100 Mo.");
  }
  if (refuses > 0) {
    messages.push("Limite de " + MAX_FICHIERS_LOT + " fichiers atteinte : " + refuses + " fichier(s) supplémentaire(s) n'ont pas été ajoutés.");
  }
  if (messages.length) showMsg(messages.join(" "));

  invaliderApercu();
  await syncMode();
  compterPagesEnAttente();
});

/** Bascule l'affichage entre mode "un seul fichier" et mode "lot". */
async function syncMode() {
  if (queue.length === 0) {
    fileInfo.style.display = "none";
    fileListEl.style.display = "none";
    numOptions.style.display = "none";
    numBtn.style.display = "";
    numBtn.disabled = true;
    batchActions.style.display = "none";
    globalProgress.classList.remove("visible");
    apercuPage.classList.remove("visible");
    hideProgress();
    return;
  }

  if (queue.length === 1) {
    fileListEl.style.display = "none";
    batchActions.style.display = "none";
    numBtn.style.display = "";
    globalProgress.classList.remove("visible");
    await validerFichierUnique(queue[0].file);
    appliquerMode();
    return;
  }

  // Mode lot : 2 fichiers ou plus
  fileInfo.style.display = "none";
  numBtn.style.display = "none";
  numOptions.style.display = "flex";
  fileListEl.style.display = "flex";
  batchActions.style.display = "flex";
  hideMsg();
  renderFileList();
  updateBatchButtons();
  const traites = queue.filter((q) => q.status === "termine" || q.status === "erreur").length;
  setGlobalProgress(traites, queue.length);
  appliquerMode();
}

/** Reproduit la validation d'origine pour le cas d'un seul fichier sélectionné. */
async function validerFichierUnique(file) {
  srcBytes = null;
  fileInfo.style.display = "none";
  numOptions.style.display = "none";
  numBtn.disabled = true;

  try {
    setProgress(30, "Lecture du fichier…");
    const buffer = await readAsArrayBuffer(file);

    let doc;
    try {
      doc = await PDFLib.PDFDocument.load(buffer);
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      return;
    }

    srcBytes = buffer;
    if (queue.length === 1) queue[0].pages = doc.getPageCount();
    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + doc.getPageCount() + " page" + (doc.getPageCount() > 1 ? "s" : "");
    fileInfo.style.display = "flex";

    numOptions.style.display = "flex";
    numBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
}

/** Construit la liste visuelle des fichiers en mode lot. */
function renderFileList() {
  fileListEl.innerHTML = "";
  queue.forEach((item) => {
    const row = document.createElement("div");
    row.className = "file-item";
    row.innerHTML =
      '<span class="f-name"></span>' +
      '<span class="f-meta"></span>' +
      '<span class="f-status"></span>' +
      '<button type="button" class="icon-btn" title="Retirer" aria-label="Retirer le fichier">✕</button>';
    row.querySelector(".f-name").textContent = item.file.name;
    row.querySelector(".f-meta").textContent = fmtSize(item.file.size) + (item.pages ? " · " + item.pages + " p." : "");

    const statusEl = row.querySelector(".f-status");
    statusEl.textContent = libelleStatut(item);
    statusEl.classList.toggle("is-done", item.status === "termine");

    const removeBtn = row.querySelector(".icon-btn");
    removeBtn.disabled = batchState === "running";
    removeBtn.addEventListener("click", () => {
      queue = queue.filter((q) => q.id !== item.id);
      invaliderApercu();
      syncMode();
    });

    fileListEl.appendChild(row);
  });
}

function libelleStatut(item) {
  switch (item.status) {
    case "cours": return "En cours…";
    case "termine": return "Terminé";
    case "erreur": return "Erreur : " + (item.error || "échec du traitement");
    default: return "En attente";
  }
}

function updateBatchButtons() {
  const tousTraites = queue.length > 0 && queue.every((q) => q.status === "termine" || q.status === "erreur");
  startBatchBtn.disabled = batchState === "running" || queue.length === 0 || tousTraites;
  pauseBatchBtn.disabled = !(batchState === "running" || batchState === "paused");
  pauseBatchBtn.textContent = batchState === "paused" ? "Reprendre" : "Mettre en pause";
  cancelBatchBtn.disabled = queue.length === 0;
}

function setGlobalProgress(traites, total) {
  globalProgress.classList.add("visible");
  globalProgressLabel.textContent = "Fichiers traités : " + traites + " / " + total;
  globalProgress.querySelector(".progress-bar > div").style.width = (total > 0 ? Math.round((traites / total) * 100) : 0) + "%";
}

/* ---------- Comptage des pages (aperçu Bates, libellés du lot) ---------- */

let comptageEnCours = false;

/** Compte les pages des fichiers du lot qui ne l'ont pas encore été, en
 * arrière-plan et un par un, avec pdf.js (lecture paresseuse, bien plus
 * légère qu'un chargement complet par pdf-lib pour de gros fichiers). */
async function compterPagesEnAttente() {
  if (comptageEnCours || !window.pdfjsLib) return;
  comptageEnCours = true;
  try {
    for (;;) {
      const item = queue.find((q) => q.pages === null && !q.comptageEchoue);
      if (!item) break;
      try {
        const buffer = await readAsArrayBuffer(item.file);
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
        item.pages = pdf.numPages;
        await pdf.destroy();
      } catch (e) {
        item.comptageEchoue = true;
      }
      if (queue.length > 1 && batchState !== "running") renderFileList();
      majApercuBates();
    }
  } finally {
    comptageEnCours = false;
  }
}

/* ---------- Modes et options ---------- */

const LIBELLES_BOUTON = {
  numeros: "Ajouter les numéros",
  bates: "Appliquer la numérotation Bates",
  entete: "Ajouter l'en-tête et le pied de page"
};

/** Affiche uniquement les groupes d'options du mode courant. */
function appliquerMode() {
  document.querySelectorAll("#numOptions .opt-group[data-modes]").forEach((groupe) => {
    const modes = groupe.dataset.modes.split(" ");
    groupe.style.display = modes.includes(mode) ? "" : "none";
  });
  numBtn.textContent = LIBELLES_BOUTON[mode];
  majApercuBates();
  planifierApercu();
}

document.querySelectorAll("#modeSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#modeSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    mode = btn.dataset.mode;
    hideMsg();
    appliquerMode();
  });
});

// Position (grille 3x2)
document.querySelectorAll("#posGrid button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#posGrid button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    position = btn.dataset.pos;
    planifierApercu();
  });
});

// Taille (petit / moyen / grand)
document.querySelectorAll("#sizeSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#sizeSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    taille = parseInt(btn.dataset.size, 10);
    planifierApercu();
  });
});

// Format (1 / 1 sur n / Page 1)
document.querySelectorAll("#formatSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#formatSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    format = btn.dataset.format;
    planifierApercu();
  });
});

// Police (Helvetica / Times / Courier)
document.querySelectorAll("#fontSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#fontSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    policeChoisie = btn.dataset.font;
    planifierApercu();
  });
});

[batesPrefixe, batesSuffixe, batesDepart, batesChiffres].forEach((el) => {
  el.addEventListener("input", () => {
    majApercuBates();
    planifierApercu();
  });
});
[margeInput, sauterPremiere, plagePages].forEach((el) => {
  el.addEventListener("input", planifierApercu);
  el.addEventListener("change", planifierApercu);
});
Object.values(ZONES).forEach((el) => el.addEventListener("input", planifierApercu));

/** Lit et borne les paramètres Bates saisis. */
function lireParamsBates() {
  let depart = parseInt(batesDepart.value, 10);
  if (!Number.isFinite(depart) || depart < 0) depart = 1;
  let chiffres = parseInt(batesChiffres.value, 10);
  if (!Number.isFinite(chiffres)) chiffres = 6;
  chiffres = Math.min(Math.max(chiffres, 1), 12);
  return {
    prefixe: batesPrefixe.value,
    suffixe: batesSuffixe.value,
    depart,
    chiffres
  };
}

/** Formate un numéro Bates : préfixe + numéro complété de zéros + suffixe. */
function formaterBates(params, n) {
  return params.prefixe + String(n).padStart(params.chiffres, "0") + params.suffixe;
}

function lireMarge() {
  let marge = parseInt(margeInput.value, 10);
  if (!Number.isFinite(marge)) marge = 28;
  return Math.min(Math.max(marge, 6), 200);
}

/** Met à jour la ligne d'aperçu « premier numéro / dernier numéro ». */
function majApercuBates() {
  if (mode !== "bates") return;
  const params = lireParamsBates();
  const premier = formaterBates(params, params.depart);
  let totalPages = 0;
  let inconnus = 0;
  queue.forEach((q) => {
    if (q.pages) totalPages += q.pages;
    else inconnus++;
  });

  apercuBates.innerHTML = "";
  const ajouter = (texte, fort) => {
    if (fort) {
      const s = document.createElement("strong");
      s.textContent = texte;
      apercuBates.appendChild(s);
    } else {
      apercuBates.appendChild(document.createTextNode(texte));
    }
  };
  ajouter("Premier numéro : ");
  ajouter(premier, true);
  if (totalPages > 0) {
    const dernier = formaterBates(params, params.depart + totalPages - 1);
    ajouter(" · Dernier numéro : ");
    ajouter(dernier, true);
    ajouter(" (" + totalPages + " page" + (totalPages > 1 ? "s" : "") + " sur " + queue.length + " fichier" + (queue.length > 1 ? "s" : "") + ")");
  }
  if (inconnus > 0) {
    ajouter(" · " + inconnus + " fichier(s) en cours de lecture ou illisible(s)");
  }
}

/** Construit le texte du numéro de page selon le format choisi. */
function texteNumero(n, total, fmt) {
  if (fmt === "n-total") return n + " / " + total;
  if (fmt === "page-n") return "Page " + n;
  return String(n);
}

/** Calcule la position (x, y) du texte selon la position choisie et une marge fixe. */
function calculerPosition(pos, largeurPage, hauteurPage, largeurTexte, taillePolice) {
  const marge = 28;
  let x, y;

  if (pos.endsWith("gauche")) {
    x = marge;
  } else if (pos.endsWith("centre")) {
    x = (largeurPage - largeurTexte) / 2;
  } else {
    x = largeurPage - largeurTexte - marge;
  }

  if (pos.startsWith("bas")) {
    y = 24;
  } else {
    y = hauteurPage - 24 - taillePolice;
  }

  return { x, y };
}

/** Position (x, y) avec marge réglable, pour les modes Bates et en-tête/pied. */
function calculerPositionMarge(pos, boite, largeurTexte, taillePolice, marge) {
  let x, y;
  if (pos.endsWith("gauche")) {
    x = boite.x + marge;
  } else if (pos.endsWith("centre")) {
    x = boite.x + (boite.width - largeurTexte) / 2;
  } else {
    x = boite.x + boite.width - largeurTexte - marge;
  }
  if (pos.startsWith("bas")) {
    y = boite.y + marge;
  } else {
    y = boite.y + boite.height - marge - taillePolice;
  }
  return { x, y };
}

const POLICES = {
  helvetica: "Helvetica",
  times: "TimesRoman",
  courier: "Courier"
};

/** Charge la police standard choisie (pas d'embarquement : les 14 polices
 * standard sont connues de tout lecteur PDF). */
function chargerPolice(doc) {
  const nom = POLICES[policeChoisie] || "Helvetica";
  return doc.embedFont(PDFLib.StandardFonts[nom]);
}

/** Ne conserve que les caractères que la police standard peut encoder
 * (WinAnsi) : les autres (emoji, symboles rares) deviennent « ? » plutôt
 * que de faire échouer tout le traitement. */
function texteEncodable(font, texte) {
  let resultat = "";
  for (const car of texte) {
    try {
      font.encodeText(car);
      resultat += car;
    } catch (e) {
      resultat += "?";
    }
  }
  return resultat;
}

/** Zone visible de la page : CropBox si elle existe, sinon MediaBox. */
function boiteVisible(page) {
  try {
    const crop = page.getCropBox();
    if (crop && crop.width > 0 && crop.height > 0) return crop;
  } catch (e) {
    // Pas de CropBox exploitable : on retombe sur la MediaBox.
  }
  return page.getMediaBox();
}

const COULEUR_TEXTE = [0.12, 0.16, 0.22];

/** Ajoute la numérotation à un PDF déjà chargé en mémoire (ArrayBuffer) et renvoie les octets du résultat. */
async function numeroterPdf(buffer) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  let doc;
  try {
    doc = await PDFDocument.load(buffer);
  } catch (e) {
    throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;

  pages.forEach((page, index) => {
    const n = index + 1;
    const texte = texteNumero(n, total, format);
    const largeurTexte = font.widthOfTextAtSize(texte, taille);
    const { x, y } = calculerPosition(position, page.getWidth(), page.getHeight(), largeurTexte, taille);
    page.drawText(texte, {
      x,
      y,
      size: taille,
      font,
      color: rgb(COULEUR_TEXTE[0], COULEUR_TEXTE[1], COULEUR_TEXTE[2])
    });
  });

  return doc.save();
}

async function ouvrirDocument(buffer) {
  try {
    return await PDFLib.PDFDocument.load(buffer);
  } catch (e) {
    throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }
}

/**
 * Numérotation Bates : texte réel (sélectionnable) sur chaque page, numéro
 * continu à partir de `premierNumero`. Renvoie les octets et le dernier
 * numéro utilisé, pour enchaîner sur le fichier suivant du lot.
 */
async function numeroterBates(buffer, params, premierNumero) {
  const { rgb } = PDFLib;
  const doc = await ouvrirDocument(buffer);
  const font = await chargerPolice(doc);
  const marge = lireMarge();
  const pages = doc.getPages();
  let numero = premierNumero;

  pages.forEach((page) => {
    const texte = texteEncodable(font, formaterBates(params, numero));
    const largeurTexte = font.widthOfTextAtSize(texte, taille);
    const { x, y } = calculerPositionMarge(position, boiteVisible(page), largeurTexte, taille, marge);
    page.drawText(texte, { x, y, size: taille, font, color: rgb(COULEUR_TEXTE[0], COULEUR_TEXTE[1], COULEUR_TEXTE[2]) });
    numero++;
  });

  return { bytes: await doc.save(), premier: premierNumero, dernier: numero - 1, pages: pages.length };
}

/** Date du jour au format JJ/MM/AAAA. */
function dateDuJour() {
  const d = new Date();
  const jj = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return jj + "/" + mm + "/" + d.getFullYear();
}

/** Remplace les variables {page}, {pages}, {fichier}, {date}, {titre}. */
function remplacerVariables(modele, contexte) {
  return modele.replace(/\{(page|pages|fichier|date|titre)\}/g, (m, cle) => String(contexte[cle]));
}

/**
 * Analyse une plage de pages saisie (« 2-10, 15 »). Renvoie un Set des
 * numéros (1-based) retenus, ou null si le champ est vide (toutes les pages).
 * Lève une erreur claire si la saisie est invalide.
 */
function analyserPlage(texte, total) {
  const propre = texte.replace(/\s+/g, "");
  if (!propre) return null;
  const retenues = new Set();
  for (const morceau of propre.split(",")) {
    if (!morceau) continue;
    const m = morceau.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error("Plage de pages invalide : utilisez par exemple « 2-10, 15 ».");
    const debut = parseInt(m[1], 10);
    const fin = m[2] ? parseInt(m[2], 10) : debut;
    if (debut < 1 || fin < debut) throw new Error("Plage de pages invalide : utilisez par exemple « 2-10, 15 ».");
    for (let p = debut; p <= Math.min(fin, total); p++) retenues.add(p);
  }
  return retenues;
}

/** Lit les six zones saisies ; renvoie un objet position -> modèle (zones non vides). */
function lireZones() {
  const zones = {};
  Object.keys(ZONES).forEach((pos) => {
    const v = ZONES[pos].value;
    if (v.trim()) zones[pos] = v;
  });
  return zones;
}

/** En-tête et pied de page : jusqu'à six zones de texte avec variables. */
async function ajouterEnTetePied(buffer, nomFichier, zones) {
  const { rgb } = PDFLib;
  if (Object.keys(zones).length === 0) {
    throw new Error("Saisissez un texte dans au moins une zone d'en-tête ou de pied de page.");
  }
  const doc = await ouvrirDocument(buffer);
  const font = await chargerPolice(doc);
  const marge = lireMarge();
  const pages = doc.getPages();
  const total = pages.length;
  const retenues = analyserPlage(plagePages.value, total);
  const titre = (doc.getTitle() || "").trim() || nomSansExtension(nomFichier);
  const date = dateDuJour();

  pages.forEach((page, index) => {
    const n = index + 1;
    if (n === 1 && sauterPremiere.checked) return;
    if (retenues && !retenues.has(n)) return;
    const contexte = { page: n, pages: total, fichier: nomFichier, date, titre };
    const boite = boiteVisible(page);
    Object.keys(zones).forEach((pos) => {
      const texte = texteEncodable(font, remplacerVariables(zones[pos], contexte));
      if (!texte) return;
      const largeurTexte = font.widthOfTextAtSize(texte, taille);
      const { x, y } = calculerPositionMarge(pos, boite, largeurTexte, taille, marge);
      page.drawText(texte, { x, y, size: taille, font, color: rgb(COULEUR_TEXTE[0], COULEUR_TEXTE[1], COULEUR_TEXTE[2]) });
    });
  });

  return doc.save();
}

/* ---------- Aperçu de la première page ---------- */

let apercuBase = null; // { id, bytes } : première page du premier fichier, isolée
let apercuTimer = null;
let apercuEnCours = false;
let apercuDemande = false;

function invaliderApercu() {
  apercuBase = null;
}

/** Regroupe les demandes d'aperçu rapprochées (saisie au clavier). */
function planifierApercu() {
  clearTimeout(apercuTimer);
  apercuTimer = setTimeout(rafraichirApercu, 250);
}

/** Isole la première page du premier fichier dans un petit PDF, mis en
 * cache : chaque rafraîchissement part de ce document léger plutôt que de
 * recharger le fichier complet. */
async function obtenirApercuBase() {
  const premier = queue[0];
  if (!premier) return null;
  if (apercuBase && apercuBase.id === premier.id) return apercuBase.bytes;
  const buffer = await readAsArrayBuffer(premier.file);
  const src = await PDFLib.PDFDocument.load(buffer);
  const mini = await PDFLib.PDFDocument.create();
  const [page] = await mini.copyPages(src, [0]);
  mini.addPage(page);
  const titre = src.getTitle();
  if (titre) mini.setTitle(titre);
  const bytes = await mini.save();
  apercuBase = { id: premier.id, bytes };
  return bytes;
}

async function rafraichirApercu() {
  if (!window.pdfjsLib || queue.length === 0) {
    apercuPage.classList.remove("visible");
    return;
  }
  if (apercuEnCours) {
    apercuDemande = true;
    return;
  }
  apercuEnCours = true;
  try {
    const base = await obtenirApercuBase();
    if (!base) return;
    const premier = queue[0];
    let bytes;
    if (mode === "bates") {
      const params = lireParamsBates();
      bytes = (await numeroterBates(base, params, params.depart)).bytes;
    } else if (mode === "entete") {
      const zones = lireZones();
      if (Object.keys(zones).length === 0 || (sauterPremiere.checked && !plagePages.value.trim())) {
        bytes = base;
      } else {
        // L'aperçu ne porte que sur la page 1 : pour que {pages} et la plage
        // reflètent le vrai document, on dessine directement ici.
        bytes = await apercuEnTete(base, premier, zones);
      }
    } else {
      bytes = await apercuNumeros(base, premier);
    }
    // Copie : pdf.js transfère le tampon à son worker (détachement), or
    // `bytes` peut être le document de base mis en cache.
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pg = await pdf.getPage(1);
    const vp1 = pg.getViewport({ scale: 1 });
    // Le bloc d'aperçu peut encore être masqué (largeur 0) : on se rabat sur
    // la largeur du bloc d'options, toujours visible à ce stade.
    const dispo = (apercuPage.clientWidth || numOptions.clientWidth || 560) - 34;
    const largeurCible = Math.max(200, Math.min(520, dispo));
    const scale = Math.min(largeurCible / vp1.width, 460 / vp1.height);
    const vp = pg.getViewport({ scale });
    apercuCanvas.width = Math.round(vp.width);
    apercuCanvas.height = Math.round(vp.height);
    await pg.render({ canvasContext: apercuCanvas.getContext("2d"), viewport: vp }).promise;
    await pdf.destroy();
    apercuPage.classList.add("visible");
  } catch (e) {
    apercuPage.classList.remove("visible");
  } finally {
    apercuEnCours = false;
    if (apercuDemande) {
      apercuDemande = false;
      planifierApercu();
    }
  }
}

/** Aperçu du mode « Numéros de page » : même rendu que numeroterPdf, mais
 * avec le vrai total de pages du fichier d'origine. */
async function apercuNumeros(base, item) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.load(base);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.getPage(0);
  const texte = texteNumero(1, item.pages || 1, format);
  const largeurTexte = font.widthOfTextAtSize(texte, taille);
  const { x, y } = calculerPosition(position, page.getWidth(), page.getHeight(), largeurTexte, taille);
  page.drawText(texte, { x, y, size: taille, font, color: rgb(COULEUR_TEXTE[0], COULEUR_TEXTE[1], COULEUR_TEXTE[2]) });
  return doc.save();
}

async function apercuEnTete(base, item, zones) {
  const { rgb } = PDFLib;
  const doc = await PDFLib.PDFDocument.load(base);
  const font = await chargerPolice(doc);
  const marge = lireMarge();
  const page = doc.getPage(0);
  const total = item.pages || 1;
  let retenues = null;
  try {
    retenues = analyserPlage(plagePages.value, total);
  } catch (e) {
    return base;
  }
  if (retenues && !retenues.has(1)) return base;
  const titre = (doc.getTitle() || "").trim() || nomSansExtension(item.file.name);
  const contexte = { page: 1, pages: total, fichier: item.file.name, date: dateDuJour(), titre };
  const boite = boiteVisible(page);
  Object.keys(zones).forEach((pos) => {
    const texte = texteEncodable(font, remplacerVariables(zones[pos], contexte));
    if (!texte) return;
    const largeurTexte = font.widthOfTextAtSize(texte, taille);
    const { x, y } = calculerPositionMarge(pos, boite, largeurTexte, taille, marge);
    page.drawText(texte, { x, y, size: taille, font, color: rgb(COULEUR_TEXTE[0], COULEUR_TEXTE[1], COULEUR_TEXTE[2]) });
  });
  return doc.save();
}

/* ---------- Noms de fichiers ---------- */

/** Retire l'extension ".pdf" d'un nom de fichier. */
function nomSansExtension(nomFichier) {
  return nomFichier.replace(/\.pdf$/i, "");
}

/** Nom de sortie Bates : base_PREMIER-DERNIER.pdf, sans caractères interdits. */
function nomBates(nomFichier, params, premier, dernier) {
  const plage = formaterBates(params, premier) + "-" + formaterBates(params, dernier);
  const sain = plage.replace(/[\\/:*?"<>|]/g, "_");
  return nomSansExtension(nomFichier) + "_" + sain + ".pdf";
}

/** Garantit un nom de fichier unique dans l'archive ZIP. */
function nomUnique(nom, utilises) {
  if (!utilises.has(nom)) {
    utilises.add(nom);
    return nom;
  }
  const point = nom.lastIndexOf(".");
  const base = point === -1 ? nom : nom.slice(0, point);
  const ext = point === -1 ? "" : nom.slice(point);
  let i = 2;
  let candidat = base + " (" + i + ")" + ext;
  while (utilises.has(candidat)) {
    i++;
    candidat = base + " (" + i + ")" + ext;
  }
  utilises.add(candidat);
  return candidat;
}

/* ---------- Traitement d'un seul fichier ---------- */

numBtn.addEventListener("click", async () => {
  if (!srcBytes || queue.length !== 1) return;
  hideMsg();
  numBtn.disabled = true;
  const item = queue[0];
  try {
    setProgress(20, "Ouverture du PDF…");
    let bytes;
    let nom;
    let texteResultat;
    if (mode === "bates") {
      const params = lireParamsBates();
      const r = await numeroterBates(srcBytes, params, params.depart);
      bytes = r.bytes;
      nom = nomBates(item.file.name, params, r.premier, r.dernier);
      texteResultat = "Votre PDF numéroté Bates est prêt (" + formaterBates(params, r.premier) + " à " + formaterBates(params, r.dernier) + ").";
    } else if (mode === "entete") {
      bytes = await ajouterEnTetePied(srcBytes, item.file.name, lireZones());
      nom = nomSansExtension(item.file.name) + "-en-tete-pied-de-page.pdf";
      texteResultat = "Votre PDF avec en-tête et pied de page est prêt.";
    } else {
      bytes = await numeroterPdf(srcBytes);
      nom = "tchadiapdf-numerote.pdf";
      texteResultat = "Votre PDF numéroté est prêt.";
    }
    setProgress(85, "Génération du fichier…");
    hideProgress();
    resultEl.querySelector("p").textContent = texteResultat;
    offerDownload(bytes, nom);
  } catch (e) {
    hideProgress();
    showMsg(e.message || "Le traitement a échoué. Réessayez avec un autre fichier.");
  } finally {
    numBtn.disabled = false;
  }
});

/* ---------- Traitement du lot ---------- */

function attendreReprise() {
  return new Promise((resolve) => {
    const verifier = () => {
      if (batchState !== "paused") {
        resolve();
      } else {
        setTimeout(verifier, 150);
      }
    };
    verifier();
  });
}

startBatchBtn.addEventListener("click", async () => {
  if (batchRunning) return;
  await lancerLot();
});

pauseBatchBtn.addEventListener("click", () => {
  if (batchState === "running") {
    batchState = "paused";
  } else if (batchState === "paused") {
    batchState = "running";
  }
  updateBatchButtons();
});

cancelBatchBtn.addEventListener("click", () => {
  batchState = "cancelled";
  if (!batchRunning) {
    queue = [];
    hideMsg();
    resultEl.classList.remove("visible");
    batchState = "idle";
    invaliderApercu();
    syncMode();
  }
});

async function lancerLot() {
  // Vérifications préalables propres à chaque mode (avant de toucher au lot).
  if (mode === "entete") {
    if (Object.keys(lireZones()).length === 0) {
      showMsg("Saisissez un texte dans au moins une zone d'en-tête ou de pied de page.");
      return;
    }
    try {
      analyserPlage(plagePages.value, 1);
    } catch (e) {
      showMsg(e.message);
      return;
    }
  }

  batchRunning = true;
  batchState = "running";
  hideMsg();
  resultEl.classList.remove("visible");
  updateBatchButtons();

  const total = queue.length;
  let traites = 0;
  const resultats = [];
  const nomsUtilises = new Set();
  const paramsBates = lireParamsBates();
  const zones = lireZones();
  let numeroBates = paramsBates.depart;
  let premierBates = null;
  let dernierBates = null;

  setGlobalProgress(0, total);

  for (const item of queue) {
    if (batchState === "cancelled") break;
    await attendreReprise();
    if (batchState === "cancelled") break;

    item.status = "cours";
    renderFileList();
    setProgress(10, "Traitement de « " + item.file.name + " »…");

    try {
      const buffer = await readAsArrayBuffer(item.file);
      let bytes;
      let nomFinal;
      if (mode === "bates") {
        const r = await numeroterBates(buffer, paramsBates, numeroBates);
        bytes = r.bytes;
        nomFinal = nomUnique(nomBates(item.file.name, paramsBates, r.premier, r.dernier), nomsUtilises);
        if (premierBates === null) premierBates = r.premier;
        dernierBates = r.dernier;
        numeroBates = r.dernier + 1;
      } else if (mode === "entete") {
        bytes = await ajouterEnTetePied(buffer, item.file.name, zones);
        nomFinal = nomUnique(nomSansExtension(item.file.name) + "-en-tete-pied-de-page.pdf", nomsUtilises);
      } else {
        bytes = await numeroterPdf(buffer);
        nomFinal = nomUnique(nomSansExtension(item.file.name) + "-numerote.pdf", nomsUtilises);
      }
      resultats.push({ nom: nomFinal, bytes });
      item.status = "termine";
      item.error = "";
    } catch (e) {
      item.status = "erreur";
      item.error = e.message || "Le traitement a échoué.";
    }

    traites++;
    renderFileList();
    setGlobalProgress(traites, total);
  }

  batchRunning = false;
  const etatFinal = batchState;
  batchState = "idle";
  updateBatchButtons();
  hideProgress();

  if (etatFinal === "cancelled") {
    showMsg("Traitement annulé. " + traites + " fichier(s) sur " + total + " avaient déjà été traités.");
    return;
  }

  const echecs = queue.filter((q) => q.status === "erreur").length;

  if (resultats.length === 0) {
    showMsg("Aucun fichier n'a pu être traité. Consultez le détail des erreurs dans la liste ci-dessus.");
    return;
  }

  try {
    // Le mode lot n'est actif qu'à partir de 2 fichiers : on regroupe toujours le résultat en ZIP.
    setProgress(90, "Génération de l'archive ZIP…");
    const zip = new JSZip();
    resultats.forEach((r) => zip.file(r.nom, r.bytes));
    const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
      setProgress(90 + Math.round(meta.percent / 10), "Génération de l'archive ZIP…");
    });
    hideProgress();
    let texte;
    if (mode === "bates") {
      texte = resultats.length + " fichier(s) numéroté(s) Bates sur " + total + " (" +
        formaterBates(paramsBates, premierBates) + " à " + formaterBates(paramsBates, dernierBates) + ")";
    } else if (mode === "entete") {
      texte = resultats.length + " fichier(s) avec en-tête et pied de page sur " + total;
    } else {
      texte = resultats.length + " fichier(s) numéroté(s) sur " + total;
    }
    resultEl.querySelector("p").textContent = texte + (echecs > 0 ? ". " + echecs + " échec(s), voir le détail ci-dessus." : ".");
    const nomZip = mode === "bates" ? "tchadiapdf-bates-lot.zip" : mode === "entete" ? "tchadiapdf-en-tete-pied-lot.zip" : "tchadiapdf-numeros-de-page-lot.zip";
    offerDownload(zipBlob, nomZip, "application/zip");
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive ZIP a échoué.");
  }
}
