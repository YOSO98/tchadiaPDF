/* tchadiaPdf : Numéros de page */

const TAILLE_MAX_OCTETS = 100 * 1024 * 1024; // 100 Mo
const MAX_FICHIERS_LOT = 50;

let srcBytes = null; // utilisé uniquement en mode "un seul fichier"
let position = "bas-droite";
let taille = 12;
let format = "n";

// File d'attente utilisée dès que 2 fichiers ou plus sont sélectionnés
let queue = []; // { id, file, status: "attente" | "cours" | "termine" | "erreur", error }
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
    queue.push({ id: nextId++, file, status: "attente", error: "" });
  });

  const messages = [];
  if (ignores > 0) {
    messages.push(ignores + " fichier(s) ignoré(s) : format non PDF ou taille supérieure à 100 Mo.");
  }
  if (refuses > 0) {
    messages.push("Limite de " + MAX_FICHIERS_LOT + " fichiers atteinte : " + refuses + " fichier(s) supplémentaire(s) n'ont pas été ajoutés.");
  }
  if (messages.length) showMsg(messages.join(" "));

  await syncMode();
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
    hideProgress();
    return;
  }

  if (queue.length === 1) {
    fileListEl.style.display = "none";
    batchActions.style.display = "none";
    numBtn.style.display = "";
    globalProgress.classList.remove("visible");
    await validerFichierUnique(queue[0].file);
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
    row.querySelector(".f-meta").textContent = fmtSize(item.file.size);

    const statusEl = row.querySelector(".f-status");
    statusEl.textContent = libelleStatut(item);
    statusEl.classList.toggle("is-done", item.status === "termine");

    const removeBtn = row.querySelector(".icon-btn");
    removeBtn.disabled = batchState === "running";
    removeBtn.addEventListener("click", () => {
      queue = queue.filter((q) => q.id !== item.id);
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

// Position (grille 3x2)
document.querySelectorAll("#posGrid button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#posGrid button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    position = btn.dataset.pos;
  });
});

// Taille (petit / moyen / grand)
document.querySelectorAll("#sizeSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#sizeSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    taille = parseInt(btn.dataset.size, 10);
  });
});

// Format (1 / 1 sur n / Page 1)
document.querySelectorAll("#formatSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#formatSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    format = btn.dataset.format;
  });
});

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
      color: rgb(0.12, 0.16, 0.22)
    });
  });

  return doc.save();
}

/** Retire l'extension ".pdf" d'un nom de fichier. */
function nomSansExtension(nomFichier) {
  return nomFichier.replace(/\.pdf$/i, "");
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

numBtn.addEventListener("click", async () => {
  if (!srcBytes) return;
  hideMsg();
  numBtn.disabled = true;
  try {
    setProgress(20, "Ouverture du PDF…");
    const bytes = await numeroterPdf(srcBytes);
    setProgress(85, "Génération du fichier…");
    hideProgress();
    resultEl.querySelector("p").textContent = "Votre PDF numéroté est prêt.";
    offerDownload(bytes, "tchadiapdf-numerote.pdf");
  } catch (e) {
    hideProgress();
    showMsg(e.message || "L'ajout des numéros a échoué. Réessayez avec un autre fichier.");
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
    syncMode();
  }
});

async function lancerLot() {
  batchRunning = true;
  batchState = "running";
  hideMsg();
  resultEl.classList.remove("visible");
  updateBatchButtons();

  const total = queue.length;
  let traites = 0;
  const resultats = [];
  const nomsUtilises = new Set();

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
      const bytes = await numeroterPdf(buffer);
      const nomFinal = nomUnique(nomSansExtension(item.file.name) + "-numerote.pdf", nomsUtilises);
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
    resultEl.querySelector("p").textContent =
      resultats.length + " fichier(s) numéroté(s) sur " + total + (echecs > 0 ? ". " + echecs + " échec(s), voir le détail ci-dessus." : ".");
    offerDownload(zipBlob, "tchadiapdf-numeros-de-page-lot.zip", "application/zip");
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive ZIP a échoué.");
  }
}
