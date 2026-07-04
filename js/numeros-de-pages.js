/* tchadiaPdf : Numéros de page */

const TAILLE_MAX_OCTETS = 100 * 1024 * 1024; // 100 Mo

let srcBytes = null;
let position = "bas-droite";
let taille = 12;
let format = "n";

const numBtn = document.getElementById("numBtn");
const numOptions = document.getElementById("numOptions");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  numOptions.style.display = "none";
  numBtn.disabled = true;
  srcBytes = null;

  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > TAILLE_MAX_OCTETS) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo).");
    return;
  }

  try {
    setProgress(30, "Lecture du fichier…");
    const buffer = await readAsArrayBuffer(file);

    // Vérifie que le PDF peut être ouvert (protection ou corruption)
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
});

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

numBtn.addEventListener("click", async () => {
  if (!srcBytes) return;
  hideMsg();
  numBtn.disabled = true;
  try {
    setProgress(20, "Ouverture du PDF…");
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    let doc;
    try {
      doc = await PDFDocument.load(srcBytes);
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      numBtn.disabled = false;
      return;
    }

    setProgress(45, "Ajout des numéros…");
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

    setProgress(85, "Génération du fichier…");
    const bytes = await doc.save();
    hideProgress();
    offerDownload(bytes, "tchadiapdf-numerote.pdf");
  } catch (e) {
    hideProgress();
    showMsg("L'ajout des numéros a échoué. Réessayez avec un autre fichier.");
  } finally {
    numBtn.disabled = false;
  }
});
