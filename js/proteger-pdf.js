/* tchadiaPdf : Protéger PDF
 *
 * Chiffrement AES-256 (R6, norme PDF 2.0) via qpdf (WebAssembly), avec deux
 * mots de passe distincts comme dans Acrobat Pro :
 *   - le mot de passe d'ouverture (utilisateur), qui chiffre le contenu ;
 *   - le mot de passe propriétaire, qui protège les droits (impression,
 *     copie, modification, accessibilité).
 * Le mot de passe d'ouverture peut rester vide : le PDF s'ouvre alors
 * librement mais les droits restent restreints (« Restreindre la
 * modification et l'impression » chez Acrobat).
 *
 * En cas d'échec de chargement du moteur qpdf (coupure réseau par exemple),
 * on se replie sur js/pdf-crypt.js (RC4 128 bits, R3) qui applique les
 * mêmes mots de passe et les mêmes droits, avec un message clair.
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let currentFile = null;

const fileListEl = document.getElementById("fileList");
const pwOptions = document.getElementById("pwOptions");
const pw1 = document.getElementById("pw1");
const pw2 = document.getElementById("pw2");
const pwOwner = document.getElementById("pwOwner");
const showPwBox = document.getElementById("showPw");
const permPrint = document.getElementById("permPrint");
const permModify = document.getElementById("permModify");
const permExtract = document.getElementById("permExtract");
const permAccess = document.getElementById("permAccess");
const linearizeBox = document.getElementById("linearize");
const permSummaryList = document.querySelector("#permSummary ul");
const resultSummaryList = document.querySelector("#resultSummary ul");
const protectBtn = document.getElementById("protectBtn");

// Bits du champ /P de la norme PDF (ISO 32000, tableau 22), numérotés à
// partir de 1 comme dans la norme. Utilisés pour le repli RC4 ; qpdf les
// calcule lui-même à partir des options --print/--modify/--extract.
const P_BITS = {
  print: 1 << 2,        // bit 3 : impression
  modifyOther: 1 << 3,  // bit 4 : autres modifications
  extract: 1 << 4,      // bit 5 : copie de texte et d'images
  annotate: 1 << 5,     // bit 6 : commentaires et formulaires
  form: 1 << 8,         // bit 9 : remplissage de formulaires
  accessibility: 1 << 9, // bit 10 : lecteurs d'écran
  assemble: 1 << 10,    // bit 11 : assemblage de pages
  printHigh: 1 << 11,   // bit 12 : impression haute résolution
};

initDropzone("dropzone", "fileInput", (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  const file = newFiles[0];
  const validation = validateFile(file, { accept: ["pdf", "application/pdf"], acceptLabel: "un fichier PDF", maxWarnBytes: MAX_SIZE });
  if (!validation.ok) {
    showMsg(validation.message);
    return;
  }
  if (validation.warning) showMsg(validation.warning);
  currentFile = file;
  renderFile();
  pwOptions.style.display = "flex";
  updateState();
});

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
    pwOptions.style.display = "none";
    hideMsg();
    updateState();
  });
  fileListEl.appendChild(row);
}

/** Lit les réglages de l'interface sous une forme indépendante du moteur. */
function readSettings() {
  const userPw = pw1.value;
  const ownerGiven = pwOwner.value;
  const print = permPrint.value;      // full | low | none
  const modify = permModify.value;    // all | annotate | form | none
  const extract = permExtract.checked;
  const accessibility = permAccess.checked;
  const hasRestrictions = print !== "full" || modify !== "all" || !extract || !accessibility;
  return {
    userPw,
    ownerGiven,
    // Choix documenté : sans mot de passe propriétaire, on réutilise le mot
    // de passe d'ouverture (un seul mot de passe à retenir). Ce cas n'est
    // accepté que sans restriction, car un lecteur qui reconnaît le mot de
    // passe propriétaire accorde tous les droits.
    ownerPw: ownerGiven || userPw,
    print,
    modify,
    extract,
    accessibility,
    hasRestrictions,
    linearize: linearizeBox.checked,
  };
}

/**
 * Vérifie la cohérence des saisies.
 * @returns {{ok: boolean, message?: string}} message affiché seulement si
 * l'utilisateur a commencé à remplir le champ concerné.
 */
function validateSettings(s) {
  if (pw2.value && s.userPw !== pw2.value) {
    return { ok: false, message: "Les deux mots de passe d'ouverture ne correspondent pas." };
  }
  if (s.userPw && !pw2.value) {
    return { ok: false };
  }
  if (!s.userPw && !s.ownerGiven) {
    return { ok: false, message: s.hasRestrictions
      ? "Pour restreindre des droits sans mot de passe d'ouverture, indiquez un mot de passe propriétaire."
      : undefined };
  }
  if (s.hasRestrictions && !s.ownerGiven) {
    return { ok: false, message: "Vous restreignez des droits : indiquez un mot de passe propriétaire différent du mot de passe d'ouverture, sinon toute personne qui ouvre le PDF aurait tous les droits." };
  }
  if (s.ownerGiven && s.ownerGiven === s.userPw) {
    return { ok: false, message: "Le mot de passe propriétaire doit être différent du mot de passe d'ouverture." };
  }
  if (!s.userPw && !s.hasRestrictions) {
    return { ok: false, message: "Sans mot de passe d'ouverture, choisissez au moins un droit à restreindre, sinon la protection n'aurait aucun effet." };
  }
  return { ok: true };
}

const PRINT_LABELS = { full: "autorisée", low: "basse résolution seulement", none: "interdite" };
const MODIFY_LABELS = {
  all: "autorisée",
  annotate: "commentaires, formulaires et signature seulement",
  form: "remplissage de formulaires et signature seulement",
  none: "interdite",
};

/** Lignes du résumé lisible, communes à l'aperçu et au résultat. */
function summaryLines(s, engineLabel) {
  const lines = [
    "Ouverture : " + (s.userPw ? "mot de passe requis" : "libre, sans mot de passe"),
    "Droits : " + (s.ownerGiven ? "protégés par le mot de passe propriétaire" : "même mot de passe que l'ouverture"),
    "Impression : " + PRINT_LABELS[s.print],
    "Copie de texte et d'images : " + (s.extract ? "autorisée" : "interdite"),
    "Modification : " + MODIFY_LABELS[s.modify],
    "Lecteurs d'écran : " + (s.accessibility ? "autorisés" : "interdits"),
  ];
  if (engineLabel) lines.push("Chiffrement : " + engineLabel);
  return lines;
}

function fillSummary(listEl, lines) {
  listEl.innerHTML = "";
  lines.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    listEl.appendChild(li);
  });
}

function updateState() {
  const s = readSettings();
  const v = validateSettings(s);
  protectBtn.disabled = !currentFile || !v.ok;
  fillSummary(permSummaryList, summaryLines(s));
  if (currentFile) {
    if (v.message) showMsg(v.message);
    else hideMsg();
  }
}

[pw1, pw2, pwOwner].forEach((el) => el.addEventListener("input", updateState));
[permPrint, permModify, permExtract, permAccess].forEach((el) => el.addEventListener("change", updateState));

showPwBox.addEventListener("change", () => {
  const type = showPwBox.checked ? "text" : "password";
  [pw1, pw2, pwOwner].forEach((el) => { el.type = type; });
});

/** Arguments qpdf : --encrypt user owner 256 [droits] -- entrée sortie (qpdf 11+). */
function buildQpdfArgs(s, inName, outName) {
  const args = [];
  if (s.linearize) args.push("--linearize");
  args.push(
    "--encrypt", s.userPw, s.ownerPw, "256",
    "--print=" + s.print,
    "--modify=" + s.modify,
    "--extract=" + (s.extract ? "y" : "n"),
    "--accessibility=" + (s.accessibility ? "y" : "n"),
    "--", inName, outName
  );
  return args;
}

/** Valeur /P (entier signé 32 bits) pour le repli RC4, mêmes droits que qpdf. */
function computePermissionBits(s) {
  let p = -4; // tous les bits à 1 sauf les bits 1 et 2 (réservés à 0)
  if (s.print === "none") p &= ~(P_BITS.print | P_BITS.printHigh);
  if (s.print === "low") p &= ~P_BITS.printHigh;
  if (s.modify === "none") p &= ~(P_BITS.modifyOther | P_BITS.annotate | P_BITS.form | P_BITS.assemble);
  if (s.modify === "form") p &= ~(P_BITS.modifyOther | P_BITS.annotate);
  if (s.modify === "annotate") p &= ~P_BITS.modifyOther;
  if (!s.extract) p &= ~P_BITS.extract;
  if (!s.accessibility) p &= ~P_BITS.accessibility;
  return p | 0;
}

async function runProtect() {
  hideMsg();
  document.getElementById("result").classList.remove("visible");

  const s = readSettings();
  const v = validateSettings(s);
  if (!v.ok) {
    showMsg(v.message || "Veuillez saisir un mot de passe d'ouverture ou un mot de passe propriétaire.");
    return;
  }

  protectBtn.disabled = true;
  try {
    setProgress(5, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(currentFile);
    const { PDFDocument } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(bytes);
    } catch (e) {
      throw new Error("Ce PDF est déjà protégé par mot de passe ou est endommagé. Utilisez d'abord l'outil Déverrouiller PDF ou Réparer PDF si besoin.");
    }

    setProgress(15, "Préparation du document…");
    const flatBytes = await doc.save({ useObjectStreams: false });

    let outBytes;
    let engineLabel = "AES-256 (norme PDF 2.0)";
    try {
      setProgress(20, "Téléchargement du moteur de chiffrement (une seule fois)…");
      outBytes = await window.QpdfEngine.runQpdf(
        new Uint8Array(flatBytes),
        (inName, outName) => buildQpdfArgs(s, inName, outName),
        (pct) => setProgress(20 + Math.round(pct * 0.6), "Téléchargement du moteur de chiffrement…" + (pct < 100 ? " " + pct + "%" : ""))
      );
      setProgress(90, "Chiffrement AES-256 en cours…");
    } catch (engineErr) {
      // Repli sur le chiffrement RC4 128 bits fait maison si le moteur qpdf
      // n'a pas pu être chargé (coupure réseau, bloqueur de contenu…). Les
      // mêmes mots de passe et les mêmes droits sont appliqués.
      setProgress(60, "Le moteur avancé est indisponible, repli sur le chiffrement standard…");
      outBytes = window.PdfCrypt.encryptPdfBytes(flatBytes, s.userPw, {
        ownerPassword: s.ownerPw,
        permissions: computePermissionBits(s),
      });
      engineLabel = "RC4 128 bits (repli, moteur AES-256 indisponible)";
      setTimeout(() => showMsg("Le chiffrement renforcé (AES-256) n'a pas pu être chargé (problème réseau). Un chiffrement standard (RC4 128 bits) a été appliqué à la place, avec les mêmes mots de passe et les mêmes droits : votre PDF est tout de même protégé."), 0);
    }

    fillSummary(resultSummaryList, summaryLines(s, engineLabel));
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(outBytes, "tchadiapdf-protege.pdf");
  } catch (err) {
    hideProgress();
    showError(err.message || "La protection du PDF a échoué. Vérifiez votre fichier et réessayez.", { retry: runProtect });
  } finally {
    updateState();
  }
}

protectBtn.addEventListener("click", runProtect);
