/* tchadiaPdf : PDF en texte (extraction du texte, avec repli OCR pour les scans) */

const MAX_SIZE = 50 * 1024 * 1024; // 50 Mo : l'OCR de secours est un traitement lourd, on reste prudent

let srcBytes = null;
let currentFile = null;
let worker = null;
let annule = false;
let totalPages = 0;
let currentPageIndex = 0;
let ocrAvailable = false; // vrai quand la dernière extraction n'a trouvé aucun texte

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const extractBtn = document.getElementById("extractBtn");
const cancelBtn = document.getElementById("cancelBtn");
const ocrOffer = document.getElementById("ocrOffer");
const ocrOfferBtn = document.getElementById("ocrOfferBtn");
const resultEl = document.getElementById("result");
const textPreview = document.getElementById("textPreview");

/** Traduit les statuts internes de Tesseract.js en libellés français courts. */
function statusLabel(status) {
  const map = {
    "loading tesseract core": "Chargement du moteur OCR…",
    "initializing tesseract": "Initialisation du moteur OCR…",
    "initialized tesseract": "Moteur OCR prêt…",
    "loading language traineddata": "Téléchargement des données de langue…",
    "loading model": "Téléchargement des données de langue…",
    "initializing api": "Préparation du moteur…",
    "recognizing text": "Reconnaissance du texte…",
  };
  return map[status] || "Traitement…";
}

/** Rend une page pdf.js dans un nouveau canvas à l'échelle 2 (meilleure précision OCR). */
async function renderPageAtScale2(page) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

/** Charge Tesseract.js à la demande seulement (jamais au chargement de la page). */
function chargerTesseract() {
  return new Promise((resolve, reject) => {
    if (typeof Tesseract !== "undefined") { resolve(); return; }
    const script = document.createElement("script");
    script.src = "/vendor/tesseract-5.1.1/tesseract.min.js";
    script.integrity = "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F";
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Impossible de charger le moteur OCR."));
    document.head.appendChild(script);
  });
}

/** Remet l'interface OCR au repos (fin normale, erreur ou annulation). */
function resetOcrUI(reproposerOcr) {
  hideProgress();
  cancelBtn.style.display = "none";
  cancelBtn.disabled = false;
  extractBtn.disabled = !srcBytes;
  ocrOfferBtn.disabled = false;
  if (reproposerOcr && ocrAvailable) ocrOffer.classList.add("visible");
}

/** Affiche le texte final : aperçu scrollable + téléchargement en .txt. */
function afficherResultat(texte) {
  ocrOffer.classList.remove("visible");
  textPreview.value = texte;
  const bytes = new TextEncoder().encode(texte);
  offerDownload(bytes, "tchadiapdf-texte.txt", "text/plain");
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");
  ocrOffer.classList.remove("visible");
  ocrAvailable = false;
  const file = newFiles[0];

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 50 Mo fixée par cet outil, car le repli OCR est un traitement lourd. Choisissez un PDF plus léger.");
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
    extractBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    srcBytes = null;
    currentFile = null;
    extractBtn.disabled = true;
    fileInfo.classList.remove("visible");
    if (e && e.name === "PasswordException") {
      showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant d'extraire le texte.");
    } else {
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
    }
  }
});

extractBtn.addEventListener("click", async () => {
  if (!srcBytes) return;

  hideMsg();
  resultEl.classList.remove("visible");
  ocrOffer.classList.remove("visible");
  ocrAvailable = false;
  extractBtn.disabled = true;

  let pdf;
  try {
    setProgress(0, "Ouverture du document…");
    pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
  } catch (e) {
    hideProgress();
    extractBtn.disabled = false;
    if (e && e.name === "PasswordException") {
      showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant d'extraire le texte.");
    } else {
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
    }
    return;
  }

  const numPages = pdf.numPages;
  let allText = "";
  let hasText = false;

  try {
    for (let i = 1; i <= numPages; i++) {
      setProgress(Math.round((i / numPages) * 100), "Extraction de la page " + i + " / " + numPages + "…");
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => it.str).join(" ").trim();
      if (pageText) hasText = true;
      allText += "=== Page " + i + " ===\n" + pageText + "\n\n";
    }
  } catch (e) {
    hideProgress();
    extractBtn.disabled = false;
    showMsg("L'extraction du texte a échoué. Réessayez avec un autre fichier.");
    return;
  }

  hideProgress();
  extractBtn.disabled = false;

  if (!hasText) {
    ocrAvailable = true;
    ocrOffer.classList.add("visible");
    ocrOffer.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  afficherResultat(allText.trim());
});

cancelBtn.addEventListener("click", async () => {
  annule = true;
  cancelBtn.disabled = true;
  if (worker) {
    try {
      await worker.terminate();
    } catch (e) {
      // Le terminate() peut faire échouer un recognize() en cours, c'est attendu lors d'une annulation.
    }
    worker = null;
  }
  cancelBtn.disabled = false;
});

ocrOfferBtn.addEventListener("click", async () => {
  if (!srcBytes) return;

  hideMsg();
  resultEl.classList.remove("visible");
  extractBtn.disabled = true;
  ocrOfferBtn.disabled = true;
  cancelBtn.style.display = "inline-flex";
  annule = false;
  totalPages = 0;
  currentPageIndex = 0;

  // 1. Ouverture du PDF avec pdf.js pour connaître le nombre de pages.
  let pdf;
  try {
    setProgress(0, "Ouverture du document…");
    pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
  } catch (e) {
    resetOcrUI(true);
    if (e && e.name === "PasswordException") {
      showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant de lancer l'OCR.");
    } else {
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
    }
    return;
  }
  totalPages = pdf.numPages;

  // 2. Chargement de Tesseract.js à la demande.
  try {
    setProgress(0, "Chargement du moteur OCR…");
    await chargerTesseract();
  } catch (e) {
    resetOcrUI(true);
    showMsg("Le moteur OCR (Tesseract.js) n'a pas pu être chargé. Vérifiez votre connexion internet, puis réessayez.");
    return;
  }

  if (annule) {
    resetOcrUI(true);
    showMsg("OCR annulé.");
    return;
  }

  // 3. Création du worker Tesseract (français + anglais).
  try {
    worker = await Tesseract.createWorker(["fra", "eng"], 1, {
      logger: (m) => {
        if (!m || !m.status || typeof m.progress !== "number") return;
        const label = statusLabel(m.status);
        if (m.status === "recognizing text" && totalPages > 0 && currentPageIndex > 0) {
          const base = ((currentPageIndex - 1) / totalPages) * 100;
          const span = (1 / totalPages) * 100;
          const pct = Math.min(99, Math.round(base + span * m.progress));
          setProgress(pct, label + " (page " + currentPageIndex + " / " + totalPages + ")…");
        } else {
          const base = totalPages > 0 && currentPageIndex > 0 ? ((currentPageIndex - 1) / totalPages) * 100 : 0;
          setProgress(Math.round(base), label);
        }
      },
    });
  } catch (e) {
    worker = null;
    resetOcrUI(true);
    if (!annule) {
      showMsg("Le moteur OCR n'a pas pu être initialisé. Cela vient souvent d'un problème réseau lors du téléchargement des données de langue : vérifiez votre connexion et réessayez.");
    }
    return;
  }

  if (annule) {
    // L'annulation a eu lieu pendant l'initialisation : le worker vient tout juste
    // d'être créé et n'a pas encore servi, il faut l'arrêter explicitement ici.
    try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
    worker = null;
    resetOcrUI(true);
    showMsg("OCR annulé.");
    return;
  }

  // 4. Reconnaissance du texte, page par page.
  let allText = "";
  try {
    for (let i = 1; i <= totalPages; i++) {
      if (annule) break;
      currentPageIndex = i;
      setProgress(Math.round(((i - 1) / totalPages) * 100), "Rendu de la page " + i + " / " + totalPages + "…");

      const page = await pdf.getPage(i);
      const canvas = await renderPageAtScale2(page);
      if (annule) break;

      let texte;
      try {
        const res = await worker.recognize(canvas);
        texte = (res && res.data && res.data.text) || "";
      } catch (err) {
        if (annule) break; // Annulation en cours : la promesse a été rejetée par worker.terminate(), ce n'est pas une vraie erreur.
        throw err;
      }
      if (annule) break;

      allText += "=== Page " + i + " ===\n" + texte.trim() + "\n\n";
    }
  } catch (e) {
    if (worker) {
      try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
      worker = null;
    }
    resetOcrUI(true);
    showMsg("La reconnaissance de texte a échoué. Réessayez avec un autre fichier.");
    return;
  }

  if (annule) {
    if (worker) {
      try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
      worker = null;
    }
    resetOcrUI(true);
    showMsg("OCR annulé.");
    return;
  }

  // 5. Fin du moteur OCR, puis affichage du résultat.
  try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
  worker = null;

  const texteFinal = allText.trim();
  const texteSansMarqueurs = texteFinal.replace(/=== Page \d+ ===/g, "").trim();

  resetOcrUI(false);

  if (!texteSansMarqueurs) {
    ocrAvailable = true;
    showMsg("Aucun texte n'a pu être reconnu par l'OCR dans ce document.");
    return;
  }

  afficherResultat(texteFinal);
});
