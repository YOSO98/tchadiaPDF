/* tchadiaPdf : Créer un livret PDF (imposition 2 pages par feuille) */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

// Dimensions d'une feuille A4 en orientation paysage, en points (72 pt/pouce).
// 297 mm x 210 mm, soit deux demi feuilles A5 (148 mm x 210 mm) côte à côte.
const A4_PAYSAGE_LARGEUR = 841.89;
const A4_PAYSAGE_HAUTEUR = 595.28;

let srcBytes = null;
let pageCount = 0;
let format = "conserver"; // "conserver" ou "a4"

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const formatOptions = document.getElementById("formatOptions");
const formatHint = document.getElementById("formatHint");
const livretBtn = document.getElementById("livretBtn");
const resultEl = document.getElementById("result");

const HINTS = {
  conserver: "Chaque feuille de sortie fait deux fois la largeur d'une page originale, pour une hauteur identique. C'est le mode le plus fiable, quelle que soit la taille de votre PDF d'origine.",
  a4: "Chaque feuille de sortie est au format A4 paysage. Ce mode est prévu pour un document dont les pages sont déjà au format A5 : dans ce cas, deux pages A5 remplissent exactement une feuille A4. Pour d'autres formats de page, chaque page est simplement réduite pour tenir dans sa moitié de feuille."
};

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");
  formatOptions.style.display = "none";
  fileInfo.style.display = "none";
  livretBtn.disabled = true;
  srcBytes = null;
  pageCount = 0;

  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la taille maximale autorisée de 100 Mo. Choisissez un fichier plus léger.");
    return;
  }

  try {
    setProgress(25, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(file);
    const { PDFDocument } = PDFLib;
    let doc;
    try {
      doc = await PDFDocument.load(bytes);
    } catch (e) {
      throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe, endommagé ou dans un format non pris en charge.");
    }

    const n = doc.getPageCount();
    if (n === 0) {
      throw new Error("Ce PDF ne contient aucune page.");
    }

    srcBytes = bytes;
    pageCount = n;

    fileName.textContent = file.name;
    fileMeta.textContent = pageCount + (pageCount > 1 ? " pages" : " page") + ", " + fmtSize(file.size);
    fileInfo.style.display = "flex";

    formatOptions.style.display = "flex";
    livretBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg(e.message || "Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe, endommagé ou dans un format non pris en charge.");
  }
});

document.querySelectorAll("#formatSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#formatSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    format = btn.dataset.format;
    formatHint.textContent = HINTS[format] || "";
  });
});

livretBtn.addEventListener("click", async () => {
  if (!srcBytes) return;
  hideMsg();
  livretBtn.disabled = true;

  try {
    setProgress(15, "Analyse du document…");
    const { PDFDocument } = PDFLib;

    let src;
    try {
      src = await PDFDocument.load(srcBytes);
    } catch (e) {
      throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
    }

    const srcPages = src.getPages();
    const n = srcPages.length;
    if (n === 0) {
      throw new Error("Ce PDF ne contient aucune page.");
    }

    // Dimensions de référence : on suppose des pages de taille homogène,
    // on prend donc la première page comme référence pour toute la mise en page.
    const refPage = srcPages[0];
    const pageWidth = refPage.getWidth();
    const pageHeight = refPage.getHeight();

    // ---------------------------------------------------------------
    // Calcul de l'imposition (algorithme classique du livret imprimé).
    //
    // On raisonne avec des pages numérotées de 1 à "total" (1-based),
    // où "total" est le nombre de pages original complété jusqu'au
    // prochain multiple de 4 (avec des pages blanches à la fin si besoin).
    // Pour la feuille numéro k (1 à total/4) :
    //   recto : gauche = total - 2k + 2, droite = 2k - 1
    //   verso : gauche = 2k,             droite = total - 2k + 1
    //
    // Vérification mentale avec total = 8 :
    //   k=1 -> recto = [8, 1], verso = [2, 7]
    //   k=2 -> recto = [6, 3], verso = [4, 5]
    // Les 8 pages apparaissent chacune exactement une fois. La feuille k=1
    // (la plus extérieure une fois le paquet plié) porte bien la première
    // page (1) et la dernière page (8) du document, ce qui est la marque
    // d'une imposition en livret correcte : une fois cette feuille imprimée
    // recto-verso, pliée au centre avec les autres et agrafée, l'ordre de
    // lecture obtenu est 1, 2, 3, 4, 5, 6, 7, 8.
    // ---------------------------------------------------------------
    const total = Math.ceil(n / 4) * 4;
    const nbFeuilles = total / 4;

    // Séquence des pages de sortie : feuille 1 recto, feuille 1 verso,
    // feuille 2 recto, feuille 2 verso, etc. C'est l'ordre attendu par une
    // imprimante recto-verso classique lisant un PDF page après page.
    const sequence = [];
    for (let k = 1; k <= nbFeuilles; k++) {
      const rectoGauche = total - 2 * k + 2;
      const rectoDroite = 2 * k - 1;
      const versoGauche = 2 * k;
      const versoDroite = total - 2 * k + 1;
      sequence.push([rectoGauche, rectoDroite]);
      sequence.push([versoGauche, versoDroite]);
    }

    setProgress(35, "Préparation des pages…");
    const out = await PDFDocument.create();
    const embeddedPages = await out.embedPages(srcPages);

    // Géométrie de la feuille de sortie selon le format choisi.
    let sheetWidth, sheetHeight, halfWidth, halfHeight, drawWidth, drawHeight;
    if (format === "a4") {
      sheetWidth = A4_PAYSAGE_LARGEUR;
      sheetHeight = A4_PAYSAGE_HAUTEUR;
      halfWidth = sheetWidth / 2;
      halfHeight = sheetHeight;
      // On réduit chaque page pour qu'elle tienne dans sa moitié de feuille,
      // en conservant ses proportions (pas de déformation).
      const scale = Math.min(halfWidth / pageWidth, halfHeight / pageHeight);
      drawWidth = pageWidth * scale;
      drawHeight = pageHeight * scale;
    } else {
      // Mode "conserver la taille" : la feuille de sortie fait deux fois la
      // largeur d'une page originale pour une hauteur identique, sans
      // aucune mise à l'échelle.
      halfWidth = pageWidth;
      halfHeight = pageHeight;
      sheetWidth = pageWidth * 2;
      sheetHeight = pageHeight;
      drawWidth = pageWidth;
      drawHeight = pageHeight;
    }
    const offsetX = (halfWidth - drawWidth) / 2;
    const offsetY = (halfHeight - drawHeight) / 2;

    function dessinerCase(page, numero, cote) {
      // numero > n signifie une page blanche ajoutée pour compléter le
      // multiple de 4 : on ne dessine rien, la moitié reste blanche.
      if (numero > n) return;
      const ep = embeddedPages[numero - 1];
      const baseX = cote === "gauche" ? 0 : halfWidth;
      page.drawPage(ep, {
        x: baseX + offsetX,
        y: offsetY,
        width: drawWidth,
        height: drawHeight
      });
    }

    for (let i = 0; i < sequence.length; i++) {
      const [gauche, droite] = sequence[i];
      const page = out.addPage([sheetWidth, sheetHeight]);
      dessinerCase(page, gauche, "gauche");
      dessinerCase(page, droite, "droite");
      setProgress(35 + Math.round((i / sequence.length) * 50), "Assemblage des feuilles…");
    }

    setProgress(90, "Génération du fichier…");
    const bytes = await out.save();
    hideProgress();
    offerDownload(bytes, "tchadiapdf-livret.pdf");
  } catch (e) {
    hideProgress();
    showMsg(e.message || "La création du livret a échoué. Réessayez avec un autre fichier.");
  } finally {
    livretBtn.disabled = false;
  }
});
