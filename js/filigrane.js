/* tchadiaPdf : Ajouter un filigrane */

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 Mo
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 Mo

let srcBytes = null;
let srcName = "";
let watermarkType = "texte";
let textSize = 48;
let opacity = 0.3;
let position = "centre";
let imageBytes = null;
let imageMime = null;

const wmOptions = document.getElementById("wmOptions");
const pdfFileList = document.getElementById("pdfFileList");
const textFields = document.getElementById("textFields");
const sizeFields = document.getElementById("sizeFields");
const imageFields = document.getElementById("imageFields");
const imageFileList = document.getElementById("imageFileList");
const wmText = document.getElementById("wmText");
const wmOpacity = document.getElementById("wmOpacity");
const opacityVal = document.getElementById("opacityVal");
const applyBtn = document.getElementById("applyBtn");

/* ---------- Dépôt du PDF cible ---------- */
initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  const file = newFiles[0];

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_PDF_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite 100 Mo).");
    return;
  }

  try {
    setProgress(30, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(file);
    // Vérification de lisibilité du PDF (protection par mot de passe, corruption)
    await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });

    srcBytes = bytes;
    srcName = file.name;
    renderPdfFile();

    wmOptions.style.display = "flex";
    applyBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    srcBytes = null;
    renderPdfFile();
    wmOptions.style.display = "none";
    applyBtn.disabled = true;
    showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }
});

function renderPdfFile() {
  pdfFileList.innerHTML = "";
  if (!srcBytes) return;
  const row = document.createElement("div");
  row.className = "file-item";
  row.innerHTML =
    '<span class="f-name"></span>' +
    '<span class="f-meta"></span>' +
    '<button class="icon-btn" title="Retirer" aria-label="Retirer le fichier">✕</button>';
  row.querySelector(".f-name").textContent = srcName;
  row.querySelector(".f-meta").textContent = fmtSize(srcBytes.byteLength);
  row.querySelector("button").onclick = () => {
    srcBytes = null;
    srcName = "";
    renderPdfFile();
    wmOptions.style.display = "none";
    applyBtn.disabled = true;
  };
  pdfFileList.appendChild(row);
}

/* ---------- Type de filigrane : texte / image ---------- */
document.querySelectorAll("#typeSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#typeSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    watermarkType = btn.dataset.type;
    const isTexte = watermarkType === "texte";
    textFields.style.display = isTexte ? "flex" : "none";
    sizeFields.style.display = isTexte ? "flex" : "none";
    imageFields.style.display = isTexte ? "none" : "flex";
  });
});

/* ---------- Taille du texte ---------- */
document.querySelectorAll("#sizeSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#sizeSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    textSize = parseInt(btn.dataset.size, 10);
  });
});

/* ---------- Opacité ---------- */
wmOpacity.addEventListener("input", () => {
  opacity = parseFloat(wmOpacity.value);
  opacityVal.textContent = Math.round(opacity * 100) + " %";
});

/* ---------- Position ---------- */
document.querySelectorAll("#posGrid button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#posGrid button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    position = btn.dataset.pos;
  });
});

/* ---------- Dépôt de l'image de filigrane ---------- */
initDropzone("dzImage", "imageInput", async (newFiles) => {
  hideMsg();
  const file = newFiles[0];
  const isJpeg = file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name);
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);

  if (!isJpeg && !isPng) {
    showMsg("Le filigrane image doit être au format JPG ou PNG.");
    return;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    showMsg("L'image est trop volumineuse (limite 20 Mo).");
    return;
  }

  try {
    imageBytes = await readAsArrayBuffer(file);
    imageMime = isPng ? "image/png" : "image/jpeg";
    renderImageFile(file);
  } catch (e) {
    imageBytes = null;
    imageMime = null;
    showMsg("Impossible de lire l'image du filigrane. Utilisez un fichier JPG ou PNG.");
  }
});

function renderImageFile(file) {
  imageFileList.innerHTML = "";
  if (!imageBytes) return;
  const row = document.createElement("div");
  row.className = "file-item";
  row.innerHTML =
    '<span class="f-name"></span>' +
    '<span class="f-meta"></span>' +
    '<button class="icon-btn" title="Retirer" aria-label="Retirer l\'image">✕</button>';
  row.querySelector(".f-name").textContent = file.name;
  row.querySelector(".f-meta").textContent = fmtSize(file.size);
  row.querySelector("button").onclick = () => {
    imageBytes = null;
    imageMime = null;
    imageFileList.innerHTML = "";
  };
  imageFileList.appendChild(row);
}

/* ---------- Calcul de position pour le texte (sans rotation) ---------- */
function textCornerPosition(pos, width, height, textWidth, size) {
  const margin = 40;
  switch (pos) {
    case "hg": return { x: margin, y: height - margin - size };
    case "hd": return { x: width - margin - textWidth, y: height - margin - size };
    case "bg": return { x: margin, y: margin };
    default:   return { x: width - margin - textWidth, y: margin }; // bd
  }
}

/* ---------- Calcul de position pour l'image ---------- */
function imagePosition(pos, width, height, w, h) {
  const margin = 30;
  switch (pos) {
    case "centre": return { x: (width - w) / 2, y: (height - h) / 2 };
    case "hg": return { x: margin, y: height - margin - h };
    case "hd": return { x: width - margin - w, y: height - margin - h };
    case "bg": return { x: margin, y: margin };
    default:   return { x: width - margin - w, y: margin }; // bd
  }
}

/* ---------- Application du filigrane ---------- */
applyBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");

  if (!srcBytes) {
    showMsg("Choisissez d'abord un fichier PDF.");
    return;
  }
  if (watermarkType === "texte" && !wmText.value.trim()) {
    showMsg("Saisissez un texte pour le filigrane.");
    return;
  }
  if (watermarkType === "image" && !imageBytes) {
    showMsg("Choisissez une image pour le filigrane.");
    return;
  }

  applyBtn.disabled = true;
  try {
    setProgress(15, "Chargement du PDF…");
    const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(srcBytes, { ignoreEncryption: false });
    } catch (e) {
      throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
    }

    const pages = doc.getPages();
    if (pages.length === 0) {
      throw new Error("Ce PDF ne contient aucune page.");
    }

    if (watermarkType === "texte") {
      setProgress(35, "Préparation du texte…");
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const texte = wmText.value.trim();
      const size = textSize;
      const textWidth = font.widthOfTextAtSize(texte, size);

      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        let x, y, rotate;

        if (position === "centre") {
          const angle = Math.PI / 4; // 45°
          x = width / 2 - (textWidth / 2) * Math.cos(angle);
          y = height / 2 - (textWidth / 2) * Math.sin(angle);
          rotate = degrees(45);
        } else {
          const p = textCornerPosition(position, width, height, textWidth, size);
          x = p.x;
          y = p.y;
          rotate = degrees(0);
        }

        page.drawText(texte, {
          x, y, size, font,
          opacity,
          color: rgb(0.12, 0.16, 0.22),
          rotate,
        });

        setProgress(35 + Math.round(((i + 1) / pages.length) * 50), "Application du filigrane…");
      });
    } else {
      setProgress(35, "Préparation de l'image…");
      let img;
      try {
        img = imageMime === "image/png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
      } catch (e) {
        throw new Error("Impossible de lire l'image du filigrane. Utilisez un fichier JPG ou PNG.");
      }

      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        const scale = (width * 0.3) / img.width;
        const w = img.width * scale;
        const h = img.height * scale;
        const p = imagePosition(position, width, height, w, h);

        page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, opacity });

        setProgress(35 + Math.round(((i + 1) / pages.length) * 50), "Application du filigrane…");
      });
    }

    setProgress(92, "Génération du fichier…");
    const out = await doc.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(out, "tchadiapdf-filigrane.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "L'application du filigrane a échoué. Réessayez avec un autre fichier.");
  } finally {
    applyBtn.disabled = false;
  }
});
