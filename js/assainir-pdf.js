/* tchadiaPdf : Assainir un PDF (supprimer les informations masquées)
 *
 * Équivalent de la commande « Supprimer les informations masquées » d'Acrobat
 * Pro, entièrement dans le navigateur avec l'API bas niveau de pdf-lib.
 *
 * Stratégie de purge : plutôt que de retirer des clés dans le document
 * d'origine (pdf-lib réécrit TOUS les objets indirects à l'enregistrement,
 * même ceux devenus orphelins, donc les octets resteraient dans le fichier),
 * on reconstruit un document neuf (PDFDocument.create) dans lequel on ne
 * copie que les pages, préalablement nettoyées, et les quelques entrées du
 * catalogue que l'utilisateur a choisi de conserver. Tout ce qui n'est pas
 * copié n'existe réellement plus. Le fichier est ensuite enregistré sans flux
 * d'objets (useObjectStreams: false) et ses octets sont relus pour vérifier
 * qu'aucun marqueur des catégories retirées ne subsiste.
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream,
  PDFString, PDFHexString, PDFNumber, PDFPage, PDFObjectCopier, decodePDFRawStream
} = PDFLib;

/* Catégories analysées. "defaut" : état initial de la case ; "info" :
 * catégorie signalée seulement, sans action possible. */
const CATEGORIES = [
  { id: "metadonnees", libelle: "Métadonnées du document", aide: "Titre, auteur, sujet, mots-clés, logiciel, dates (dictionnaire Info).", defaut: true },
  { id: "xmp", libelle: "Métadonnées XMP", aide: "Flux XMP du document et des images (historique d'édition, auteur, logiciel).", defaut: true },
  { id: "javascript", libelle: "JavaScript", aide: "Scripts de document, d'ouverture, de champs, de liens et de signets.", defaut: true },
  { id: "pieces", libelle: "Pièces jointes", aide: "Fichiers incorporés au PDF et annotations « fichier joint ».", defaut: true },
  { id: "annotations", libelle: "Annotations et commentaires", aide: "Notes, surlignages, tampons, dessins, fenêtres de commentaire, etc. (liens et champs exclus).", defaut: true },
  { id: "formulaire", libelle: "Champs de formulaire", aide: "Les champs sont figés dans la page (valeurs visibles conservées) puis la structure du formulaire est retirée.", defaut: true },
  { id: "calques", libelle: "Calques", aide: "Le contenu des calques masqués par défaut est supprimé, les calques visibles sont fusionnés dans la page.", defaut: true },
  { id: "signets", libelle: "Signets", aide: "Table des matières cliquable du document.", defaut: false },
  { id: "actions", libelle: "Actions à l'ouverture", aide: "Action exécutée à l'ouverture, actions de document (impression, enregistrement, fermeture) et de page.", defaut: true },
  { id: "liens", libelle: "Liens", aide: "Zones cliquables (adresses web, renvois internes).", defaut: false },
  { id: "pieceinfo", libelle: "Données privées d'application", aide: "Dictionnaires PieceInfo (données propres à Illustrator, InDesign, etc.) et vignettes de page incorporées.", defaut: true },
  { id: "recadrage", libelle: "Contenu hors zone recadrée", aide: "Pages dont la zone affichée (CropBox) est plus petite que la page réelle (MediaBox) : le contenu masqué par le recadrage reste dans le fichier.", info: true },
  { id: "textemasque", libelle: "Texte masqué (à vérifier)", aide: "Texte en mode de rendu invisible (3 Tr) détecté dans le contenu des pages. Détection heuristique, non exhaustive : fréquent et légitime dans les PDF océrisés.", info: true }
];

const LIBELLES_INFO = {
  Title: "Titre", Author: "Auteur", Subject: "Sujet", Keywords: "Mots-clés",
  Creator: "Créé avec", Producer: "Produit par", CreationDate: "Date de création",
  ModDate: "Date de modification", Trapped: "Recouvrement"
};

const LIBELLES_ANNOTS = {
  Text: "Note", FreeText: "Texte libre", Highlight: "Surlignage", Underline: "Soulignement",
  StrikeOut: "Texte barré", Squiggly: "Soulignement ondulé", Stamp: "Tampon", Ink: "Dessin",
  Square: "Rectangle", Circle: "Ellipse", Line: "Ligne", Polygon: "Polygone", PolyLine: "Polyligne",
  Caret: "Marque d'insertion", FileAttachment: "Fichier joint", Sound: "Son", Movie: "Vidéo",
  Popup: "Fenêtre de commentaire", Redact: "Marque de caviardage", Screen: "Écran",
  RichMedia: "Média enrichi", "3D": "Objet 3D", Watermark: "Filigrane", Projection: "Projection",
  TrapNet: "Réseau de recouvrement", PrinterMark: "Repère d'impression"
};

const LIBELLES_AA_DOC = {
  WC: "à la fermeture", WS: "avant enregistrement", DS: "après enregistrement",
  WP: "avant impression", DP: "après impression", O: "à l'ouverture de la page", C: "à la fermeture de la page"
};

let fichierCourant = null;
let octetsSource = null;
let analyseCourante = null;

const fileInfo = document.getElementById("fileInfo");
const fileNameEl = document.getElementById("fileName");
const fileMetaEl = document.getElementById("fileMeta");
const analyseBox = document.getElementById("analyseBox");
const categoriesEl = document.getElementById("categories");
const sanitizeBtn = document.getElementById("sanitizeBtn");
const rapportEl = document.getElementById("rapport");

/* ---------- Petits utilitaires pdf-lib ---------- */

function nom(x) {
  return x instanceof PDFName ? x.decodeText() : null;
}

function texte(x) {
  if (x instanceof PDFString || x instanceof PDFHexString) {
    try { return x.decodeText(); } catch (e) { return x.toString(); }
  }
  if (x instanceof PDFName) return x.decodeText();
  if (x instanceof PDFNumber) return String(x.asNumber());
  return "";
}

function dictDe(ctx, obj) {
  if (!obj) return null;
  const v = ctx.lookup(obj);
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFStream) return v.dict;
  return null;
}

function tableauDe(ctx, obj) {
  if (!obj) return null;
  const v = ctx.lookup(obj);
  return v instanceof PDFArray ? v : null;
}

/** Rend lisible une date PDF (D:AAAAMMJJHHmmSS...) ; renvoie la chaîne telle quelle sinon. */
function dateLisible(s) {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
  if (!m) return s;
  let out = (m[3] || "01") + "/" + (m[2] || "01") + "/" + m[1];
  if (m[4]) out += " " + m[4] + ":" + (m[5] || "00");
  return out;
}

function tronquer(s, max) {
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function pluriel(n, sing, plur) {
  return n + " " + (n > 1 ? (plur || sing + "s") : sing);
}

/** Convertit des octets en chaîne latin1 (sans dépasser la limite d'arguments de apply). */
function octetsVersChaine(u8) {
  let s = "";
  const pas = 8192;
  for (let i = 0; i < u8.length; i += pas) {
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + pas, u8.length)));
  }
  return s;
}

function chaineVersOctets(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return u8;
}

/** Contenu décodé d'un flux (null si le filtre n'est pas pris en charge). */
function decoderFlux(flux) {
  try {
    if (flux instanceof PDFRawStream) return decodePDFRawStream(flux).decode();
    if (flux instanceof PDFStream) return flux.getContents();
  } catch (e) {
    return null;
  }
  return null;
}

/** Parcourt un arbre de noms (/Names, /Kids) et appelle visiter(nom, valeur). */
function parcourirArbreNoms(ctx, racine, visiter, profondeur) {
  profondeur = profondeur || 0;
  const node = dictDe(ctx, racine);
  if (!node || profondeur > 32) return;
  const names = tableauDe(ctx, node.get(PDFName.of("Names")));
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      visiter(texte(ctx.lookup(names.get(i))), names.get(i + 1));
    }
  }
  const kids = tableauDe(ctx, node.get(PDFName.of("Kids")));
  if (kids) {
    for (let i = 0; i < kids.size(); i++) parcourirArbreNoms(ctx, kids.get(i), visiter, profondeur + 1);
  }
}

/** Toutes les actions atteignables depuis une action (chaînes /Next incluses). */
function chaineActions(ctx, action) {
  const res = [];
  const vus = new Set();
  const visiter = (obj) => {
    if (!obj || res.length > 256) return;
    if (obj instanceof PDFRef) {
      if (vus.has(obj.toString())) return;
      vus.add(obj.toString());
    }
    const d = dictDe(ctx, obj);
    if (!d) return;
    res.push(d);
    const next = d.get(PDFName.of("Next"));
    const nextTab = tableauDe(ctx, next);
    if (nextTab) {
      for (let i = 0; i < nextTab.size(); i++) visiter(nextTab.get(i));
    } else if (next) {
      visiter(next);
    }
  };
  visiter(action);
  return res;
}

function estJs(d) {
  return nom(d.get(PDFName.of("S"))) === "JavaScript";
}

function compterJsAction(ctx, action) {
  return chaineActions(ctx, action).filter(estJs).length;
}

/** Nombre d'actions JavaScript portées par un dictionnaire (/A et /AA). */
function compterJsPorteur(ctx, porteur) {
  let n = compterJsAction(ctx, porteur.get(PDFName.of("A")));
  const aa = dictDe(ctx, porteur.get(PDFName.of("AA")));
  if (aa) aa.entries().forEach(([, v]) => { n += compterJsAction(ctx, v); });
  return n;
}

/** Retire /A et /AA d'un dictionnaire conservé s'ils contiennent du JavaScript. */
function purgerJs(ctx, porteur) {
  let n = 0;
  const a = porteur.get(PDFName.of("A"));
  if (a && compterJsAction(ctx, a) > 0) { n += compterJsAction(ctx, a); porteur.delete(PDFName.of("A")); }
  const aa = porteur.get(PDFName.of("AA"));
  if (aa) {
    const aaDict = dictDe(ctx, aa);
    let js = 0;
    if (aaDict) aaDict.entries().forEach(([, v]) => { js += compterJsAction(ctx, v); });
    if (js > 0) { n += js; porteur.delete(PDFName.of("AA")); }
  }
  return n;
}

function extraitJs(ctx, action) {
  const d = dictDe(ctx, action);
  if (!d) return "";
  const js = ctx.lookup(d.get(PDFName.of("JS")));
  let code = "";
  if (js instanceof PDFStream) {
    const dec = decoderFlux(js);
    if (dec) code = octetsVersChaine(dec.subarray(0, 200));
  } else {
    code = texte(js);
  }
  return code ? " : " + tronquer(code, 60) : "";
}

function typeAction(ctx, action) {
  const d = dictDe(ctx, action);
  if (!d) return "destination";
  const s = nom(d.get(PDFName.of("S")));
  const libelles = { JavaScript: "JavaScript", GoTo: "aller à une page", GoToR: "ouvrir un autre document", URI: "ouvrir une adresse web", Launch: "lancer un fichier ou un programme", SubmitForm: "envoyer le formulaire", ResetForm: "réinitialiser le formulaire", ImportData: "importer des données", Named: "commande nommée", Hide: "masquer un champ", Sound: "jouer un son", Movie: "lire une vidéo", Rendition: "lire un média", GoToE: "ouvrir un fichier incorporé", SetOCGState: "changer les calques", Trans: "transition" };
  return libelles[s] || (s ? s : "destination");
}

/** Parcourt les signets (/Outlines) et appelle visiter(itemDict). */
function parcourirSignets(ctx, racine, visiter) {
  const vus = new Set();
  const marcher = (obj, prof) => {
    let cur = obj;
    while (cur && prof < 64) {
      const cle = cur instanceof PDFRef ? cur.toString() : null;
      if (cle) { if (vus.has(cle)) return; vus.add(cle); }
      const d = dictDe(ctx, cur);
      if (!d) return;
      visiter(d);
      const first = d.get(PDFName.of("First"));
      if (first) marcher(first, prof + 1);
      cur = d.get(PDFName.of("Next"));
      if (!cle) return; // item direct : pas de chaînage fiable
    }
  };
  const root = dictDe(ctx, racine);
  if (root) marcher(root.get(PDFName.of("First")), 0);
}

/** Flux de contenu d'une page sous forme de chaîne latin1 (null si illisible). */
function contenuPage(ctx, node) {
  const contents = node.Contents();
  const flux = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const f = ctx.lookup(contents.get(i));
      if (f instanceof PDFStream) flux.push(f);
    }
  } else if (contents instanceof PDFStream) {
    flux.push(contents);
  }
  if (!flux.length) return "";
  const parties = [];
  for (const f of flux) {
    const dec = decoderFlux(f);
    if (!dec) return null;
    parties.push(octetsVersChaine(dec));
  }
  return parties.join("\n");
}

const RE_TEXTE_INVISIBLE = /(?:^|[\s>\]}])3\s+Tr(?=[\s\/\[<(%]|$)/;

/* ---------- Calques (contenu optionnel) ---------- */

/** Ensemble des références (chaînes) des calques masqués par défaut. */
function calquesMasques(ctx, catalog) {
  const res = new Set();
  const ocp = dictDe(ctx, catalog.get(PDFName.of("OCProperties")));
  if (!ocp) return res;
  const d = dictDe(ctx, ocp.get(PDFName.of("D")));
  if (!d) return res;
  if (nom(d.get(PDFName.of("BaseState"))) === "OFF") {
    const tous = tableauDe(ctx, ocp.get(PDFName.of("OCGs")));
    if (tous) for (let i = 0; i < tous.size(); i++) { const r = tous.get(i); if (r instanceof PDFRef) res.add(r.toString()); }
    const on = tableauDe(ctx, d.get(PDFName.of("ON")));
    if (on) for (let i = 0; i < on.size(); i++) { const r = on.get(i); if (r instanceof PDFRef) res.delete(r.toString()); }
  }
  const off = tableauDe(ctx, d.get(PDFName.of("OFF")));
  if (off) for (let i = 0; i < off.size(); i++) { const r = off.get(i); if (r instanceof PDFRef) res.add(r.toString()); }
  return res;
}

/** Un objet /OC (OCG ou OCMD) est-il masqué par défaut ? */
function ocMasque(ctx, oc, masques) {
  if (!oc) return false;
  if (oc instanceof PDFRef && masques.has(oc.toString())) return true;
  const d = dictDe(ctx, oc);
  if (!d) return false;
  if (nom(d.get(PDFName.of("Type"))) === "OCMD") {
    const ocgs = d.get(PDFName.of("OCGs"));
    if (ocgs instanceof PDFRef) return masques.has(ocgs.toString());
    const tab = tableauDe(ctx, ocgs);
    if (tab && tab.size() > 0) {
      for (let i = 0; i < tab.size(); i++) {
        const r = tab.get(i);
        if (!(r instanceof PDFRef) || !masques.has(r.toString())) return false;
      }
      return true;
    }
  }
  return false;
}

/**
 * Réécrit un flux de contenu : supprime les blocs « /OC /nom BDC … EMC » des
 * calques masqués (contenu compris) et retire seulement les marqueurs pour
 * les calques visibles. Petit analyseur lexical qui ignore les chaînes
 * littérales, hexadécimales et les commentaires pour ne pas confondre un
 * « EMC » dans un texte avec l'opérateur.
 */
function reecrireContenuCalques(src, nomsMasques, nomsVisibles) {
  const jetons = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "%") {
      let j = i;
      while (j < n && src[j] !== "\n" && src[j] !== "\r") j++;
      jetons.push({ t: "autre", s: i, e: j });
      i = j;
    } else if (c === "(") {
      let j = i + 1, prof = 1;
      while (j < n && prof > 0) {
        if (src[j] === "\\") j += 2;
        else { if (src[j] === "(") prof++; else if (src[j] === ")") prof--; j++; }
      }
      jetons.push({ t: "autre", s: i, e: j });
      i = j;
    } else if ((c === "<" && src[i + 1] === "<") || (c === ">" && src[i + 1] === ">")) {
      jetons.push({ t: "autre", s: i, e: i + 2 });
      i += 2;
    } else if (c === "<") {
      let j = src.indexOf(">", i + 1);
      if (j < 0) j = n - 1;
      jetons.push({ t: "autre", s: i, e: j + 1 });
      i = j + 1;
    } else if (c === ">" || c === "[" || c === "]" || c === "{" || c === "}") {
      jetons.push({ t: "autre", s: i, e: i + 1 });
      i++;
    } else if (c === "/") {
      let j = i + 1;
      while (j < n && !/[\s()<>\[\]{}\/%]/.test(src[j])) j++;
      jetons.push({ t: "nom", v: src.slice(i + 1, j), s: i, e: j });
      i = j;
    } else if (/\s/.test(c)) {
      i++;
    } else {
      let j = i;
      while (j < n && !/[\s()<>\[\]{}\/%]/.test(src[j])) j++;
      const mot = src.slice(i, j);
      jetons.push({ t: "mot", v: mot, s: i, e: j });
      i = j;
      // Image en ligne : on saute jusqu'à EI pour ne pas interpréter ses octets.
      if (mot === "ID") {
        const fin = src.indexOf("EI", j);
        const e = fin < 0 ? n : fin + 2;
        jetons.push({ t: "autre", s: j, e: e });
        i = e;
      }
    }
  }

  // Intervalles [début, fin) à supprimer.
  const suppr = [];
  let modifie = false;
  for (let k = 0; k < jetons.length; k++) {
    const j = jetons[k];
    if (j.t !== "mot" || j.v !== "BDC") continue;
    const prop = jetons[k - 1], tag = jetons[k - 2];
    if (!prop || !tag || tag.t !== "nom" || tag.v !== "OC" || prop.t !== "nom") continue;
    const cache = nomsMasques.has(prop.v);
    if (!cache && !nomsVisibles.has(prop.v)) continue;
    // Recherche du EMC correspondant.
    let prof = 1, m = k + 1;
    for (; m < jetons.length; m++) {
      const x = jetons[m];
      if (x.t !== "mot") continue;
      if (x.v === "BDC" || x.v === "BMC") prof++;
      else if (x.v === "EMC") { prof--; if (prof === 0) break; }
    }
    const emc = m < jetons.length ? jetons[m] : null;
    modifie = true;
    if (cache) {
      suppr.push([tag.s, emc ? emc.e : n]);
      k = emc ? m : jetons.length;
    } else {
      suppr.push([tag.s, j.e]);
      if (emc) suppr.push([emc.s, emc.e]);
    }
  }
  if (!modifie) return null;
  suppr.sort((a, b) => a[0] - b[0]);
  let out = "", pos = 0;
  for (const [s, e] of suppr) {
    if (s < pos) continue;
    out += src.slice(pos, s) + " ";
    pos = e;
  }
  out += src.slice(pos);
  return out;
}

/* ---------- Analyse ---------- */

function analyser(doc) {
  const ctx = doc.context;
  const catalog = doc.catalog;
  const r = {};
  CATEGORIES.forEach((c) => { r[c.id] = { nb: 0, details: [] }; });
  const pages = doc.getPages();
  r.nbPages = pages.length;
  const rootRef = ctx.trailerInfo.Root;

  // Métadonnées Info
  const info = dictDe(ctx, ctx.trailerInfo.Info);
  if (info) {
    info.entries().forEach(([k, v]) => {
      const val = texte(ctx.lookup(v));
      if (!val) return;
      const cle = k.decodeText();
      r.metadonnees.nb++;
      r.metadonnees.details.push((LIBELLES_INFO[cle] || cle) + " : " + tronquer(dateLisible(val), 70));
    });
  }

  // XMP : catalogue, puis tout objet portant /Metadata (images, pages, polices)
  const metaRef = catalog.get(PDFName.of("Metadata"));
  if (metaRef) {
    const flux = ctx.lookup(metaRef);
    const taille = flux instanceof PDFStream ? fmtSize(flux.getContentsSize()) : "";
    r.xmp.nb++;
    r.xmp.details.push("Flux XMP du document" + (taille ? " (" + taille + ")" : ""));
  }
  let xmpObjets = 0;
  ctx.enumerateIndirectObjects().forEach(([ref, obj]) => {
    if (ref.toString() === rootRef.toString()) return;
    const d = obj instanceof PDFStream ? obj.dict : obj;
    if (d instanceof PDFDict && d.get(PDFName.of("Metadata")) instanceof PDFRef) xmpObjets++;
  });
  if (xmpObjets) {
    r.xmp.nb += xmpObjets;
    r.xmp.details.push(pluriel(xmpObjets, "flux XMP attaché à un objet (image, page, police)", "flux XMP attachés à des objets (images, pages, polices)"));
  }

  // JavaScript : scripts de document
  const names = dictDe(ctx, catalog.get(PDFName.of("Names")));
  if (names) {
    parcourirArbreNoms(ctx, names.get(PDFName.of("JavaScript")), (nomScript, val) => {
      r.javascript.nb++;
      r.javascript.details.push("Script de document « " + tronquer(nomScript || "sans nom", 30) + " »" + extraitJs(ctx, val));
    });
  }

  // Actions à l'ouverture et actions de document
  const openAction = catalog.get(PDFName.of("OpenAction"));
  if (openAction) {
    r.actions.nb++;
    r.actions.details.push("Action à l'ouverture du document : " + typeAction(ctx, openAction));
    const js = compterJsAction(ctx, openAction);
    if (js) { r.javascript.nb += js; r.javascript.details.push("Script exécuté à l'ouverture" + extraitJs(ctx, openAction)); }
  }
  const aaDoc = dictDe(ctx, catalog.get(PDFName.of("AA")));
  if (aaDoc) {
    aaDoc.entries().forEach(([k, v]) => {
      const cle = k.decodeText();
      r.actions.nb++;
      r.actions.details.push("Action de document " + (LIBELLES_AA_DOC[cle] || cle) + " : " + typeAction(ctx, v));
      const js = compterJsAction(ctx, v);
      if (js) { r.javascript.nb += js; r.javascript.details.push("Script de document " + (LIBELLES_AA_DOC[cle] || cle) + extraitJs(ctx, v)); }
    });
  }

  // Pièces jointes incorporées
  if (names) {
    parcourirArbreNoms(ctx, names.get(PDFName.of("EmbeddedFiles")), (nomFichier, val) => {
      const spec = dictDe(ctx, val);
      let libelle = nomFichier;
      let taille = "";
      if (spec) {
        libelle = texte(ctx.lookup(spec.get(PDFName.of("UF")))) || texte(ctx.lookup(spec.get(PDFName.of("F")))) || nomFichier;
        const ef = dictDe(ctx, spec.get(PDFName.of("EF")));
        if (ef) {
          const flux = ctx.lookup(ef.get(PDFName.of("UF")) || ef.get(PDFName.of("F")));
          if (flux instanceof PDFStream) {
            const params = dictDe(ctx, flux.dict.get(PDFName.of("Params")));
            const size = params ? ctx.lookup(params.get(PDFName.of("Size"))) : null;
            taille = fmtSize(size instanceof PDFNumber ? size.asNumber() : flux.getContentsSize());
          }
        }
      }
      r.pieces.nb++;
      r.pieces.details.push(tronquer(libelle || "sans nom", 50) + (taille ? " (" + taille + ")" : ""));
    });
  }

  // Formulaire
  const acroForm = dictDe(ctx, catalog.get(PDFName.of("AcroForm")));
  const champsVus = new Set();
  if (acroForm) {
    try {
      const form = doc.getForm();
      form.getFields().forEach((f) => {
        champsVus.add(f.acroField.dict);
        r.formulaire.nb++;
        if (r.formulaire.details.length < 12) r.formulaire.details.push(tronquer(f.getName(), 50));
        const js = compterJsPorteur(ctx, f.acroField.dict);
        if (js) { r.javascript.nb += js; r.javascript.details.push("Script du champ « " + tronquer(f.getName(), 30) + " »"); }
      });
      if (r.formulaire.nb > 12) r.formulaire.details.push("et " + (r.formulaire.nb - 12) + " autres champs");
    } catch (e) {
      r.formulaire.nb = Math.max(r.formulaire.nb, 1);
      r.formulaire.details.push("Structure de formulaire présente (lecture détaillée impossible)");
    }
    if (acroForm.get(PDFName.of("XFA"))) {
      r.formulaire.nb++;
      r.formulaire.details.push("Formulaire XFA (données XML)");
    }
  }

  // Calques
  const ocp = dictDe(ctx, catalog.get(PDFName.of("OCProperties")));
  if (ocp) {
    const masques = calquesMasques(ctx, catalog);
    const ocgs = tableauDe(ctx, ocp.get(PDFName.of("OCGs")));
    const nbOcgs = ocgs ? ocgs.size() : 0;
    r.calques.nb = Math.max(1, nbOcgs);
    r.calques.nbMasques = 0;
    if (ocgs) {
      for (let i = 0; i < nbOcgs; i++) {
        const ref = ocgs.get(i);
        const d = dictDe(ctx, ref);
        const cache = ref instanceof PDFRef && masques.has(ref.toString());
        if (cache) r.calques.nbMasques++;
        if (r.calques.details.length < 12) {
          r.calques.details.push(tronquer(d ? texte(ctx.lookup(d.get(PDFName.of("Name")))) || "calque sans nom" : "calque", 40) + (cache ? " (masqué par défaut)" : ""));
        }
      }
    } else {
      r.calques.details.push("Configuration de calques sans calque nommé");
    }
  }

  // Signets
  const outlines = catalog.get(PDFName.of("Outlines"));
  if (outlines) {
    parcourirSignets(ctx, outlines, (item) => {
      r.signets.nb++;
      if (r.signets.details.length < 8) r.signets.details.push(tronquer(texte(ctx.lookup(item.get(PDFName.of("Title")))) || "sans titre", 50));
      const js = compterJsPorteur(ctx, item);
      if (js) { r.javascript.nb += js; r.javascript.details.push("Script de signet"); }
    });
    if (r.signets.nb > 8) r.signets.details.push("et " + (r.signets.nb - 8) + " autres signets");
  }

  // PieceInfo du catalogue
  const pieceInfo = dictDe(ctx, catalog.get(PDFName.of("PieceInfo")));
  if (pieceInfo) {
    r.pieceinfo.nb++;
    const apps = pieceInfo.keys().map((k) => k.decodeText());
    r.pieceinfo.details.push("Données d'application du document" + (apps.length ? " (" + tronquer(apps.join(", "), 50) + ")" : ""));
  }

  // Pages : annotations, liens, actions, PieceInfo, vignettes, recadrage, texte masqué
  const parType = {};
  let nbLiens = 0, nbPieceInfoPages = 0, nbThumb = 0, nbAnnotsFichier = 0;
  let pagesIllisibles = 0;
  pages.forEach((page, idx) => {
    const node = page.node;
    const numero = idx + 1;

    const annots = node.Annots();
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        const a = dictDe(ctx, annots.get(i));
        if (!a) continue;
        const st = nom(a.get(PDFName.of("Subtype"))) || "inconnu";
        const js = compterJsPorteur(ctx, a);
        if (js && !champsVus.has(a)) {
          r.javascript.nb += js;
          r.javascript.details.push("Script d'une annotation (" + (LIBELLES_ANNOTS[st] || st) + ") page " + numero);
        }
        if (st === "Widget") continue;
        if (st === "Link") {
          nbLiens++;
          if (r.liens.details.length < 8) {
            const act = dictDe(ctx, a.get(PDFName.of("A")));
            const uri = act ? texte(ctx.lookup(act.get(PDFName.of("URI")))) : "";
            r.liens.details.push("Page " + numero + " : " + (uri ? tronquer(uri, 50) : typeAction(ctx, a.get(PDFName.of("A")))));
          }
          continue;
        }
        if (st === "FileAttachment") {
          nbAnnotsFichier++;
          const fs = dictDe(ctx, a.get(PDFName.of("FS")));
          const nomF = fs ? (texte(ctx.lookup(fs.get(PDFName.of("UF")))) || texte(ctx.lookup(fs.get(PDFName.of("F"))))) : "";
          r.pieces.nb++;
          r.pieces.details.push("Annotation « fichier joint » page " + numero + (nomF ? " : " + tronquer(nomF, 40) : ""));
        }
        parType[st] = (parType[st] || 0) + 1;
        r.annotations.nb++;
      }
    }

    const aaPage = dictDe(ctx, node.get(PDFName.of("AA")));
    if (aaPage) {
      aaPage.entries().forEach(([k, v]) => {
        const cle = k.decodeText();
        r.actions.nb++;
        r.actions.details.push("Page " + numero + " : action " + (LIBELLES_AA_DOC[cle] || cle) + " (" + typeAction(ctx, v) + ")");
        const js = compterJsAction(ctx, v);
        if (js) { r.javascript.nb += js; r.javascript.details.push("Script de la page " + numero + extraitJs(ctx, v)); }
      });
    }

    if (node.get(PDFName.of("PieceInfo"))) nbPieceInfoPages++;
    if (node.get(PDFName.of("Thumb"))) nbThumb++;

    const media = page.getMediaBox();
    let crop = null;
    try { crop = page.getCropBox(); } catch (e) { crop = null; }
    if (crop && (crop.width < media.width - 0.5 || crop.height < media.height - 0.5)) {
      r.recadrage.nb++;
      if (r.recadrage.details.length < 8) {
        r.recadrage.details.push("Page " + numero + " : zone affichée " + Math.round(crop.width) + " × " + Math.round(crop.height) + " pt sur une page de " + Math.round(media.width) + " × " + Math.round(media.height) + " pt");
      }
    }

    const contenu = contenuPage(ctx, node);
    if (contenu === null) {
      pagesIllisibles++;
    } else if (RE_TEXTE_INVISIBLE.test(contenu)) {
      r.textemasque.nb++;
      if (r.textemasque.details.length < 8) r.textemasque.details.push("Page " + numero + " : texte en mode de rendu invisible");
    }
  });

  Object.keys(parType).sort().forEach((st) => {
    r.annotations.details.push((LIBELLES_ANNOTS[st] || st) + " : " + parType[st]);
  });
  r.liens.nb = nbLiens;
  if (nbPieceInfoPages) { r.pieceinfo.nb += nbPieceInfoPages; r.pieceinfo.details.push(pluriel(nbPieceInfoPages, "page avec des données d'application", "pages avec des données d'application")); }
  if (nbThumb) { r.pieceinfo.nb += nbThumb; r.pieceinfo.details.push(pluriel(nbThumb, "vignette de page incorporée", "vignettes de page incorporées")); }
  if (pagesIllisibles) r.textemasque.details.push(pluriel(pagesIllisibles, "page dont le contenu n'a pas pu être lu", "pages dont le contenu n'a pas pu être lu"));
  r.recadrage.nbPagesTotal = pages.length;
  return r;
}

/* ---------- Assainissement ---------- */

async function assainir(src, choix, analyse) {
  const ctx = src.context;
  const catalog = src.catalog;
  const rapport = [];
  const retire = (cat, nb, libelle) => rapport.push({ cat, nb, libelle, etat: nb > 0 ? "retire" : "absent" });
  const conserve = (cat, libelle) => rapport.push({ cat, nb: 0, libelle, etat: "conserve" });

  // 1. Formulaire : aplatissement dans la source avant copie des pages.
  let widgetsARetirer = false;
  if (choix.formulaire) {
    if (analyse.formulaire.nb > 0) {
      let aplati = false;
      try {
        const form = src.getForm();
        form.flatten();
        aplati = true;
      } catch (e) {
        aplati = false;
      }
      widgetsARetirer = true;
      retire("formulaire", analyse.formulaire.nb, aplati
        ? pluriel(analyse.formulaire.nb, "champ de formulaire figé dans la page puis retiré", "champs de formulaire figés dans la page puis retirés")
        : pluriel(analyse.formulaire.nb, "champ de formulaire retiré (aplatissement impossible : son apparence n'est pas conservée)", "champs de formulaire retirés (aplatissement impossible : leur apparence n'est pas conservée)"));
    }
  } else if (analyse.formulaire.nb > 0) {
    conserve("formulaire", "Champs de formulaire conservés (" + analyse.formulaire.nb + ")");
    if (choix.javascript) {
      try {
        src.getForm().getFields().forEach((f) => { purgerJs(ctx, f.acroField.dict); });
      } catch (e) { /* formulaire illisible : les widgets sont traités avec les annotations */ }
      const acro = dictDe(ctx, catalog.get(PDFName.of("AcroForm")));
      if (acro && acro.get(PDFName.of("XFA"))) acro.delete(PDFName.of("XFA"));
    }
  }

  // 2. Calques : préparation des ensembles.
  const masques = choix.calques ? calquesMasques(ctx, catalog) : new Set();
  const visites = new Set();
  const ressourcesXObjetVide = () => ctx.register(ctx.stream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 0, 0] }));

  const traiterRessources = (resObj, profondeur) => {
    const res = dictDe(ctx, resObj);
    if (!res || profondeur > 16) return;
    const props = dictDe(ctx, res.get(PDFName.of("Properties")));
    const nomsMasques = new Set(), nomsVisibles = new Set();
    if (props) {
      props.entries().forEach(([k, v]) => {
        const d = dictDe(ctx, v);
        const type = d ? nom(d.get(PDFName.of("Type"))) : null;
        if (type !== "OCG" && type !== "OCMD") return;
        if (ocMasque(ctx, v, masques)) nomsMasques.add(k.decodeText()); else nomsVisibles.add(k.decodeText());
      });
      nomsMasques.forEach((n) => props.delete(PDFName.of(n)));
      nomsVisibles.forEach((n) => props.delete(PDFName.of(n)));
    }
    const xobjs = dictDe(ctx, res.get(PDFName.of("XObject")));
    if (xobjs) {
      xobjs.entries().forEach(([k, v]) => {
        const flux = ctx.lookup(v);
        if (!(flux instanceof PDFStream)) return;
        const oc = flux.dict.get(PDFName.of("OC"));
        if (oc && ocMasque(ctx, oc, masques)) {
          xobjs.set(k, ressourcesXObjetVide());
          return;
        }
        if (oc) flux.dict.delete(PDFName.of("OC"));
        if (nom(flux.dict.get(PDFName.of("Subtype"))) === "Form") {
          const cle = v instanceof PDFRef ? v.toString() : null;
          if (cle && visites.has(cle)) return;
          if (cle) visites.add(cle);
          const sousRes = flux.dict.get(PDFName.of("Resources"));
          const noms = nomsCalquesDe(sousRes);
          reecrireFlux(v, flux, noms.masques, noms.visibles);
          traiterRessources(sousRes, profondeur + 1);
        }
      });
    }
    return { nomsMasques, nomsVisibles };
  };

  const nomsCalquesDe = (resObj) => {
    const res = dictDe(ctx, resObj);
    const out = { masques: new Set(), visibles: new Set() };
    const props = res ? dictDe(ctx, res.get(PDFName.of("Properties"))) : null;
    if (props) {
      props.entries().forEach(([k, v]) => {
        const d = dictDe(ctx, v);
        const type = d ? nom(d.get(PDFName.of("Type"))) : null;
        if (type !== "OCG" && type !== "OCMD") return;
        if (ocMasque(ctx, v, masques)) out.masques.add(k.decodeText()); else out.visibles.add(k.decodeText());
      });
    }
    return out;
  };

  const reecrireFlux = (ref, flux, nomsMasques, nomsVisibles) => {
    if (!nomsMasques.size && !nomsVisibles.size) return;
    const dec = decoderFlux(flux);
    if (!dec) return;
    const nouveau = reecrireContenuCalques(octetsVersChaine(dec), nomsMasques, nomsVisibles);
    if (nouveau === null) return;
    const dict = flux.dict.clone(ctx);
    dict.delete(PDFName.of("Filter"));
    dict.delete(PDFName.of("DecodeParms"));
    const remplacant = PDFRawStream.of(dict, chaineVersOctets(nouveau));
    if (ref instanceof PDFRef) ctx.assign(ref, remplacant);
  };

  // 3. Pages.
  let annotsRetirees = 0, liensRetires = 0, widgetsRetires = 0, piecesAnnots = 0, jsRetires = 0;
  let actionsPagesRetirees = 0, pieceInfoPages = 0, thumbs = 0, xmpPages = 0, calquesPages = 0;
  const pages = src.getPages();
  pages.forEach((page) => {
    const node = page.node;

    const annots = node.Annots();
    if (annots) {
      const garder = [];
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        const a = dictDe(ctx, ref);
        if (!a) continue;
        const st = nom(a.get(PDFName.of("Subtype")));
        let retirer;
        if (st === "Link") { retirer = choix.liens; if (retirer) liensRetires++; }
        else if (st === "Widget") { retirer = widgetsARetirer; if (retirer) widgetsRetires++; }
        else if (st === "FileAttachment") { retirer = choix.pieces || choix.annotations; if (retirer) { piecesAnnots++; if (choix.annotations) annotsRetirees++; } }
        else { retirer = choix.annotations; if (retirer) annotsRetirees++; }
        if (retirer) continue;
        if (choix.javascript) jsRetires += purgerJs(ctx, a);
        if (choix.calques && a.get(PDFName.of("OC"))) a.delete(PDFName.of("OC"));
        if (choix.xmp && a.get(PDFName.of("Metadata"))) a.delete(PDFName.of("Metadata"));
        garder.push(ref);
      }
      if (garder.length) node.set(PDFName.of("Annots"), ctx.obj(garder));
      else node.delete(PDFName.of("Annots"));
    }

    const aa = dictDe(ctx, node.get(PDFName.of("AA")));
    if (aa) {
      if (choix.actions) { actionsPagesRetirees += aa.keys().length; node.delete(PDFName.of("AA")); }
      else if (choix.javascript) jsRetires += purgerJs(ctx, node);
    }
    if (choix.pieceinfo) {
      if (node.get(PDFName.of("PieceInfo"))) { pieceInfoPages++; node.delete(PDFName.of("PieceInfo")); }
      if (node.get(PDFName.of("Thumb"))) { thumbs++; node.delete(PDFName.of("Thumb")); }
    }
    if (choix.xmp && node.get(PDFName.of("Metadata"))) { xmpPages++; node.delete(PDFName.of("Metadata")); }

    if (choix.calques && analyse.calques.nb > 0) {
      const resObj = node.get(PDFName.of("Resources")) || node.getInheritableAttribute(PDFName.of("Resources"));
      const noms = nomsCalquesDe(resObj);
      if (noms.masques.size || noms.visibles.size) {
        const contenu = contenuPage(ctx, node);
        if (contenu !== null) {
          const nouveau = reecrireContenuCalques(contenu, noms.masques, noms.visibles);
          if (nouveau !== null) {
            calquesPages++;
            node.set(PDFName.of("Contents"), ctx.register(ctx.stream(chaineVersOctets(nouveau))));
          }
        }
      }
      traiterRessources(resObj, 0);
    }
  });

  // 4. XMP attaché aux objets (images, polices…) : retiré dans la source avant copie.
  let xmpObjets = 0;
  if (choix.xmp) {
    const rootRef = ctx.trailerInfo.Root.toString();
    ctx.enumerateIndirectObjects().forEach(([ref, obj]) => {
      if (ref.toString() === rootRef) return;
      const d = obj instanceof PDFStream ? obj.dict : obj;
      if (d instanceof PDFDict && d.get(PDFName.of("Metadata"))) { xmpObjets++; d.delete(PDFName.of("Metadata")); }
    });
  }

  // 5. Reconstruction dans un document neuf.
  const dest = await PDFDocument.create({ updateMetadata: false });
  await src.flush();
  const copier = PDFObjectCopier.for(ctx, dest.context);
  pages.forEach((page) => {
    const nouveauRef = copier.copy(page.ref);
    const leaf = dest.context.lookup(nouveauRef);
    dest.addPage(PDFPage.of(leaf, nouveauRef, dest));
  });
  const destCat = dest.catalog;
  const copierCle = (cle) => {
    const v = catalog.get(PDFName.of(cle));
    if (v) destCat.set(PDFName.of(cle), copier.copy(v));
  };
  ["PageLayout", "PageMode", "Lang", "ViewerPreferences", "PageLabels"].forEach(copierCle);

  // Métadonnées
  if (choix.metadonnees) {
    dest.getInfoDict().set(PDFName.of("Producer"), PDFString.of("tchadiaPdf"));
    retire("metadonnees", analyse.metadonnees.nb, analyse.metadonnees.nb
      ? pluriel(analyse.metadonnees.nb, "entrée de métadonnées supprimée", "entrées de métadonnées supprimées") + " (Producteur : tchadiaPdf)"
      : "Métadonnées : aucune entrée à retirer (Producteur : tchadiaPdf)");
  } else {
    const info = dictDe(ctx, ctx.trailerInfo.Info);
    if (info) {
      const destInfo = dest.getInfoDict();
      info.entries().forEach(([k, v]) => destInfo.set(k, copier.copy(v)));
    }
    conserve("metadonnees", "Métadonnées du document conservées");
  }

  // XMP
  if (choix.xmp) {
    retire("xmp", analyse.xmp.nb, analyse.xmp.nb ? pluriel(analyse.xmp.nb, "flux XMP supprimé") : "Métadonnées XMP : aucune");
  } else {
    copierCle("Metadata");
    conserve("xmp", "Métadonnées XMP conservées");
  }

  // Noms : seuls les sous-arbres explicitement conservés sont recopiés.
  const names = dictDe(ctx, catalog.get(PDFName.of("Names")));
  const destNames = dest.context.obj({});
  if (names) {
    if (!choix.javascript && names.get(PDFName.of("JavaScript"))) destNames.set(PDFName.of("JavaScript"), copier.copy(names.get(PDFName.of("JavaScript"))));
    if (!choix.pieces && names.get(PDFName.of("EmbeddedFiles"))) destNames.set(PDFName.of("EmbeddedFiles"), copier.copy(names.get(PDFName.of("EmbeddedFiles"))));
    if ((!choix.liens || !choix.signets) && names.get(PDFName.of("Dests"))) destNames.set(PDFName.of("Dests"), copier.copy(names.get(PDFName.of("Dests"))));
  }
  if (destNames.keys().length) destCat.set(PDFName.of("Names"), destNames);
  if ((!choix.liens || !choix.signets) && catalog.get(PDFName.of("Dests"))) copierCle("Dests");

  // JavaScript
  if (choix.javascript) {
    retire("javascript", analyse.javascript.nb, analyse.javascript.nb ? pluriel(analyse.javascript.nb, "script JavaScript supprimé", "scripts JavaScript supprimés") : "JavaScript : aucun");
  } else {
    conserve("javascript", "JavaScript conservé");
  }

  // Pièces jointes
  if (choix.pieces) {
    retire("pieces", analyse.pieces.nb, analyse.pieces.nb ? pluriel(analyse.pieces.nb, "pièce jointe supprimée", "pièces jointes supprimées") : "Pièces jointes : aucune");
  } else {
    conserve("pieces", "Pièces jointes conservées");
  }

  // Annotations
  if (choix.annotations) {
    retire("annotations", annotsRetirees, annotsRetirees ? pluriel(annotsRetirees, "annotation ou commentaire supprimé", "annotations et commentaires supprimés") : "Annotations et commentaires : aucun");
  } else {
    conserve("annotations", "Annotations et commentaires conservés");
  }

  // Formulaire conservé : copie de la structure AcroForm.
  if (!choix.formulaire && catalog.get(PDFName.of("AcroForm"))) copierCle("AcroForm");

  // Calques
  if (choix.calques) {
    retire("calques", analyse.calques.nb, analyse.calques.nb
      ? pluriel(analyse.calques.nb, "calque supprimé", "calques supprimés") + (analyse.calques.nbMasques ? " (contenu de " + pluriel(analyse.calques.nbMasques, "calque masqué retiré", "calques masqués retiré") + ")" : "") + (calquesPages ? ", " + pluriel(calquesPages, "page réécrite") : "")
      : "Calques : aucun");
  } else {
    copierCle("OCProperties");
    conserve("calques", "Calques conservés");
  }

  // Signets
  if (choix.signets) {
    retire("signets", analyse.signets.nb, analyse.signets.nb ? pluriel(analyse.signets.nb, "signet supprimé") : "Signets : aucun");
  } else if (catalog.get(PDFName.of("Outlines"))) {
    if (choix.javascript) parcourirSignets(ctx, catalog.get(PDFName.of("Outlines")), (item) => { jsRetires += purgerJs(ctx, item); });
    copierCle("Outlines");
    conserve("signets", "Signets conservés (" + analyse.signets.nb + ")");
  }

  // Actions à l'ouverture
  if (choix.actions) {
    retire("actions", analyse.actions.nb, analyse.actions.nb ? pluriel(analyse.actions.nb, "action automatique supprimée", "actions automatiques supprimées") : "Actions à l'ouverture : aucune");
  } else {
    const oa = catalog.get(PDFName.of("OpenAction"));
    if (oa && !(choix.javascript && compterJsAction(ctx, oa) > 0)) copierCle("OpenAction");
    if (catalog.get(PDFName.of("AA")) && !choix.javascript) copierCle("AA");
    conserve("actions", "Actions à l'ouverture conservées" + (choix.javascript ? " (sauf celles en JavaScript)" : ""));
  }

  // Liens
  if (choix.liens) {
    retire("liens", liensRetires, liensRetires ? pluriel(liensRetires, "lien supprimé") : "Liens : aucun");
  } else {
    conserve("liens", "Liens conservés (" + analyse.liens.nb + ")");
  }

  // PieceInfo et vignettes
  if (choix.pieceinfo) {
    const total = (dictDe(ctx, catalog.get(PDFName.of("PieceInfo"))) ? 1 : 0) + pieceInfoPages + thumbs;
    retire("pieceinfo", total, total ? pluriel(total, "bloc de données privées ou vignette supprimé", "blocs de données privées ou vignettes supprimés") : "Données privées d'application : aucune");
  } else {
    copierCle("PieceInfo");
    conserve("pieceinfo", "Données privées d'application conservées");
  }

  // Catégories informatives
  if (analyse.recadrage.nb) rapport.push({ cat: "recadrage", nb: analyse.recadrage.nb, etat: "info", libelle: pluriel(analyse.recadrage.nb, "page recadrée signalée", "pages recadrées signalées") + " : le contenu hors zone n'a pas été supprimé" });
  if (analyse.textemasque.nb) rapport.push({ cat: "textemasque", nb: analyse.textemasque.nb, etat: "info", libelle: pluriel(analyse.textemasque.nb, "page avec du texte invisible signalée", "pages avec du texte invisible signalées") + " : à vérifier, non modifié" });

  // 6. Enregistrement sans flux d'objets, puis vérification sur les octets produits.
  const octets = await dest.save({ useObjectStreams: false });
  const marqueurs = [];
  if (choix.javascript) marqueurs.push(["JavaScript", /\/JavaScript(?![A-Za-z0-9#_.])/, /\/JS(?![A-Za-z0-9#_.])/]);
  if (choix.pieces) marqueurs.push(["Pièces jointes", /\/EmbeddedFiles?(?![A-Za-z0-9#_.])/]);
  if (choix.actions) marqueurs.push(["Actions à l'ouverture", /\/OpenAction(?![A-Za-z0-9#_.])/]);
  if (choix.calques) marqueurs.push(["Calques", /\/OCProperties(?![A-Za-z0-9#_.])/]);
  if (choix.xmp) marqueurs.push(["XMP", /\/Metadata(?![A-Za-z0-9#_.])/]);
  if (choix.pieceinfo) marqueurs.push(["Données privées", /\/PieceInfo(?![A-Za-z0-9#_.])/]);
  if (choix.signets) marqueurs.push(["Signets", /\/Outlines(?![A-Za-z0-9#_.])/]);
  if (choix.formulaire) marqueurs.push(["Formulaire", /\/AcroForm(?![A-Za-z0-9#_.])/]);
  const chaine = octetsVersChaine(octets);
  const residus = [];
  marqueurs.forEach(([libelle, ...res]) => { if (res.some((re) => re.test(chaine))) residus.push(libelle); });

  return { octets, rapport, residus, jsRetires };
}

/* ---------- Interface ---------- */

function reinitialiser() {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  analyseBox.classList.remove("visible");
  categoriesEl.innerHTML = "";
  rapportEl.innerHTML = "";
  sanitizeBtn.disabled = true;
  fileInfo.style.display = "none";
  fichierCourant = null;
  octetsSource = null;
  analyseCourante = null;
}

function afficherAnalyse(analyse) {
  categoriesEl.innerHTML = "";
  let total = 0;
  CATEGORIES.forEach((cat) => {
    const res = analyse[cat.id];
    const li = document.createElement("li");
    li.className = "cat" + (res.nb ? " cat-presente" : "") + (cat.info ? " cat-info" : "");

    const entete = document.createElement("div");
    entete.className = "cat-entete";
    const label = document.createElement("label");
    if (!cat.info) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.cat = cat.id;
      cb.id = "cat-" + cat.id;
      cb.checked = cat.defaut && res.nb > 0;
      cb.disabled = res.nb === 0;
      label.appendChild(cb);
      if (res.nb) total++;
    }
    const titre = document.createElement("span");
    titre.className = "cat-titre";
    titre.textContent = cat.libelle;
    label.appendChild(titre);
    if (!cat.info) label.htmlFor = "cat-" + cat.id;
    entete.appendChild(label);

    const compte = document.createElement("span");
    compte.className = "cat-compte";
    if (cat.info) compte.textContent = res.nb ? pluriel(res.nb, "page") + ", à vérifier" : "rien détecté";
    else compte.textContent = res.nb ? pluriel(res.nb, "élément") : "aucun";
    entete.appendChild(compte);
    li.appendChild(entete);

    const aide = document.createElement("p");
    aide.className = "cat-aide";
    aide.textContent = cat.aide;
    li.appendChild(aide);

    if (res.details.length) {
      const ul = document.createElement("ul");
      ul.className = "cat-details";
      res.details.forEach((d) => {
        const item = document.createElement("li");
        item.textContent = d;
        ul.appendChild(item);
      });
      li.appendChild(ul);
    }
    categoriesEl.appendChild(li);
  });
  const resume = document.getElementById("analyseResume");
  resume.textContent = total
    ? "Ce PDF contient des informations masquées dans " + pluriel(total, "catégorie") + ". Cochez ce que vous souhaitez retirer, puis cliquez sur « Assainir le PDF »."
    : "Aucune information masquée détectée dans ce PDF. Vous pouvez tout de même l'assainir pour en reconstruire une copie propre (métadonnées vidées).";
  analyseBox.classList.add("visible");
}

function lireChoix() {
  const choix = {};
  CATEGORIES.forEach((cat) => {
    if (cat.info) return;
    const cb = categoriesEl.querySelector('input[data-cat="' + cat.id + '"]');
    // Catégorie vide (case désactivée) : rien à conserver, on la traite comme
    // retirée pour que le document reconstruit ne la recopie pas.
    const vide = !analyseCourante || analyseCourante[cat.id].nb === 0;
    choix[cat.id] = vide ? true : !!(cb && cb.checked);
  });
  return choix;
}

function afficherRapport(resultat, tailleAvant, tailleApres) {
  rapportEl.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = "Rapport d'assainissement";
  rapportEl.appendChild(h);
  const ul = document.createElement("ul");
  resultat.rapport.forEach((ligne) => {
    const li = document.createElement("li");
    li.className = "rapport-" + ligne.etat;
    const prefixe = { retire: "Retiré : ", conserve: "Conservé : ", info: "Signalé : ", absent: "" }[ligne.etat] || "";
    li.textContent = prefixe + ligne.libelle;
    ul.appendChild(li);
  });
  rapportEl.appendChild(ul);
  const verif = document.createElement("p");
  verif.className = "rapport-verif";
  if (resultat.residus.length) {
    verif.textContent = "Vérification des octets produits : des marqueurs subsistent pour " + resultat.residus.join(", ") + ". Le fichier peut encore contenir ces éléments ; signalez-nous ce cas.";
  } else {
    verif.textContent = "Vérification des octets produits : aucun marqueur résiduel des catégories retirées. Taille : " + fmtSize(tailleAvant) + " avant, " + fmtSize(tailleApres) + " après.";
  }
  rapportEl.appendChild(verif);
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  reinitialiser();
  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo). Choisissez un fichier plus léger.");
    return;
  }
  try {
    setProgress(20, "Lecture du fichier…");
    const buffer = await readAsArrayBuffer(file);
    let doc;
    try {
      doc = await PDFDocument.load(buffer, { updateMetadata: false });
    } catch (e) {
      hideProgress();
      const details = (e && e.message ? e.message : "").toLowerCase();
      if (details.indexOf("encrypt") !== -1) {
        showError("Ce PDF est protégé par mot de passe et ne peut pas être analysé directement.", {
          suggestionHref: "/deverrouiller-pdf",
          suggestionText: "Déverrouiller le PDF d'abord"
        });
      } else {
        showError("Impossible d'ouvrir ce PDF. Il est peut-être endommagé ou n'est pas un fichier PDF valide.", {
          suggestionHref: "/reparer-pdf",
          suggestionText: "Essayer Réparer PDF"
        });
      }
      return;
    }
    setProgress(60, "Analyse des informations masquées…");
    const analyse = analyser(doc);

    fichierCourant = file;
    octetsSource = buffer;
    analyseCourante = analyse;
    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = fmtSize(file.size) + ", " + pluriel(analyse.nbPages, "page");
    fileInfo.style.display = "flex";
    afficherAnalyse(analyse);
    sanitizeBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible d'analyser ce fichier. Réessayez avec un autre PDF.");
  }
});

sanitizeBtn.addEventListener("click", async () => {
  if (!octetsSource || !analyseCourante) return;
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  sanitizeBtn.disabled = true;
  try {
    setProgress(15, "Rechargement du document…");
    // Rechargement depuis les octets d'origine : l'analyse ne modifie rien, mais
    // un second clic doit repartir d'un document intact.
    const src = await PDFDocument.load(octetsSource, { updateMetadata: false });
    const analyse = analyser(src);
    const choix = lireChoix();
    setProgress(45, "Suppression des informations masquées…");
    const resultat = await assainir(src, choix, analyse);
    setProgress(90, "Vérification du fichier produit…");
    afficherRapport(resultat, octetsSource.byteLength, resultat.octets.length);
    setProgress(100, "Terminé");
    hideProgress();
    const base = fichierCourant ? fichierCourant.name.replace(/\.pdf$/i, "") : "document";
    offerDownload(resultat.octets, base + "-assaini.pdf");
  } catch (e) {
    hideProgress();
    showError("L'assainissement de ce PDF a échoué. Réessayez avec un autre fichier ou décochez certaines catégories.", {
      retry: () => sanitizeBtn.click()
    });
  } finally {
    sanitizeBtn.disabled = false;
  }
});
