/* tchadiaPdf : OCR PDF (ajout d'une couche de texte recherchable sur un PDF scanné) */

const MAX_SIZE = 50 * 1024 * 1024; // 50 Mo : l'OCR est un traitement lourd, plus restrictif que les autres outils

let srcBytes = null;
let currentFile = null;
let worker = null;
let annule = false;
let totalPages = 0;
let currentPageIndex = 0;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const ocrBtn = document.getElementById("ocrBtn");
const cancelBtn = document.getElementById("cancelBtn");
const resultEl = document.getElementById("result");

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

/** Remet l'interface au repos (fin normale, erreur ou annulation). */
function arreterTraitement() {
  hideProgress();
  cancelBtn.style.display = "none";
  ocrBtn.disabled = !srcBytes;
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
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

    showMsg(
      "L'OCR peut prendre plusieurs minutes selon la taille du document. Le premier lancement télécharge " +
      "environ 15 à 20 Mo de données de langue (français et anglais) depuis un réseau de diffusion public : " +
      "ce sont des données publiques, pas votre fichier, qui reste dans votre navigateur. Gardez cet onglet " +
      "ouvert pendant tout le traitement."
    );
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

ocrBtn.addEventListener("click", async () => {
  if (!srcBytes) return;

  hideMsg();
  resultEl.classList.remove("visible");
  ocrBtn.disabled = true;
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
    showMsg("Le moteur OCR (Tesseract.js) n'a pas pu être chargé. Vérifiez votre connexion internet, puis réessayez.");
    return;
  }

  // 2. Création du worker Tesseract (français + anglais).
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
    arreterTraitement();
    if (!annule) {
      showMsg("Le moteur OCR n'a pas pu être initialisé. Cela vient souvent d'un problème réseau lors du téléchargement des données de langue : vérifiez votre connexion et réessayez.");
    }
    return;
  }

  if (annule) {
    arreterTraitement();
    showMsg("OCR annulé.");
    return;
  }

  // 3. Construction du document de sortie page par page.
  const { PDFDocument, StandardFonts } = PDFLib;
  const outDoc = await PDFDocument.create();
  const font = await outDoc.embedFont(StandardFonts.Helvetica);

  try {
    for (let i = 1; i <= totalPages; i++) {
      if (annule) break;
      currentPageIndex = i;
      setProgress(Math.round(((i - 1) / totalPages) * 100), "Rendu de la page " + i + " / " + totalPages + "…");

      const page = await pdf.getPage(i);
      const viewport1 = page.getViewport({ scale: 1 });
      const pageWidthPt = viewport1.width;
      const pageHeightPt = viewport1.height;

      const canvas = await renderPageAtScale2(page);
      if (annule) break;

      let data;
      try {
        const res = await worker.recognize(canvas);
        data = res.data;
      } catch (err) {
        if (annule) break; // Annulation en cours : la promesse a été rejetée par worker.terminate(), ce n'est pas une vraie erreur.
        throw err;
      }
      if (annule) break;

      const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      const jpegBytes = await jpegBlob.arrayBuffer();
      const jpegImage = await outDoc.embedJpg(jpegBytes);

      const outPage = outDoc.addPage([pageWidthPt, pageHeightPt]);
      outPage.drawImage(jpegImage, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });

      const words = (data && data.words) || [];
      for (const w of words) {
        if (!w.text || !w.text.trim()) continue;
        const bbox = w.bbox;
        const xPt = bbox.x0 / 2;
        const yTopPt = bbox.y1 / 2;
        const sizePt = Math.max(1, (bbox.y1 - bbox.y0) / 2);
        // pdf-lib n'expose pas le mode de rendu "invisible" natif du PDF (Tr 3) via drawText :
        // on simule donc l'invisibilité avec une opacité à 0, ce qui garde le texte sélectionnable
        // et recherchable par la plupart des lecteurs tout en restant invisible à l'affichage.
        outPage.drawText(w.text, {
          x: xPt,
          y: pageHeightPt - yTopPt,
          size: sizePt,
          font,
          opacity: 0,
        });
      }
    }
  } catch (e) {
    if (worker) {
      try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
      worker = null;
    }
    arreterTraitement();
    showMsg("La reconnaissance de texte a échoué. Réessayez avec un autre fichier.");
    return;
  }

  if (annule) {
    if (worker) {
      try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
      worker = null;
    }
    arreterTraitement();
    showMsg("OCR annulé.");
    return;
  }

  // 4. Fin du moteur OCR, puis génération et téléchargement du fichier.
  try { await worker.terminate(); } catch (_) { /* déjà arrêté */ }
  worker = null;

  try {
    setProgress(99, "Génération du PDF final…");
    const outBytes = await outDoc.save();
    arreterTraitement();
    offerDownload(outBytes, "tchadiapdf-ocr.pdf");
  } catch (e) {
    arreterTraitement();
    showMsg("La génération du PDF final a échoué. Réessayez avec un autre fichier.");
  }
});
