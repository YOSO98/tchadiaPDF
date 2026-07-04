/* tchadiaPdf : PDF en JPG */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let srcBytes = null;
let currentFile = null;
let scale = 2.5; // Haute, par défaut

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const jpgOptions = document.getElementById("jpgOptions");
const convertBtn = document.getElementById("convertBtn");
const resultEl = document.getElementById("result");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");
  const file = newFiles[0];

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 100 Mo. Choisissez un PDF plus léger.");
    return;
  }

  try {
    setProgress(10, "Lecture du fichier…");
    srcBytes = await readAsArrayBuffer(file);

    // Vérifie que le PDF s'ouvre correctement avant d'activer la conversion.
    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;

    currentFile = file;
    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + pdf.numPages + (pdf.numPages > 1 ? " pages" : " page");
    fileInfo.classList.add("visible");
    jpgOptions.style.display = "flex";
    convertBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    srcBytes = null;
    currentFile = null;
    convertBtn.disabled = true;
    fileInfo.classList.remove("visible");
    jpgOptions.style.display = "none";
    if (e && e.name === "PasswordException") {
      showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant de le convertir.");
    } else {
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être corrompu ou dans un format non pris en charge.");
    }
  }
});

document.querySelectorAll("#resSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#resSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    scale = parseFloat(btn.dataset.r);
  });
});

convertBtn.addEventListener("click", async () => {
  if (!srcBytes) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;

  try {
    setProgress(0, "Ouverture du PDF…");
    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
    const numPages = pdf.numPages;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const blobs = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      blobs.push(blob);

      const pct = Math.round((i / numPages) * (numPages === 1 ? 100 : 90));
      setProgress(pct, "Conversion de la page " + i + " / " + numPages);
    }

    if (numPages === 1) {
      hideProgress();
      offerDownload(blobs[0], "tchadiapdf-page-1.jpg", "image/jpeg");
    } else {
      const zip = new JSZip();
      const padLength = String(numPages).length;
      blobs.forEach((blob, idx) => {
        const num = String(idx + 1).padStart(padLength, "0");
        zip.file("page-" + num + ".jpg", blob);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(90 + Math.round(meta.percent / 10), "Génération de l'archive ZIP...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-images.zip", "application/zip");
    }
  } catch (e) {
    hideProgress();
    showMsg("La conversion a échoué. Réessayez avec un autre fichier.");
  } finally {
    convertBtn.disabled = !srcBytes;
  }
});
