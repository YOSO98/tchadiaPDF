/* tchadiaPdf : Faire pivoter PDF */

let srcBytes = null;
let degrees = 90;
let previewCanvas = null;

const rotateBtn = document.getElementById("rotateBtn");
const previewEl = document.getElementById("preview");
const rotOptions = document.getElementById("rotOptions");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  try {
    setProgress(30, "Lecture du fichier…");
    srcBytes = await readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;

    previewEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "thumb";
    wrap.style.cursor = "default";
    previewCanvas = document.createElement("canvas");
    previewCanvas.style.transition = "transform 150ms ease";
    wrap.appendChild(previewCanvas);
    const label = document.createElement("div");
    label.className = "t-num";
    label.textContent = "Aperçu, page 1";
    wrap.appendChild(label);
    previewEl.appendChild(wrap);

    await renderPdfPage(pdf, 1, previewCanvas, 180);
    applyPreviewRotation();

    rotOptions.style.display = "flex";
    rotateBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }
});

function applyPreviewRotation() {
  if (!previewCanvas) return;
  previewCanvas.style.transform = "rotate(" + degrees + "deg)";
  const scale = degrees % 180 !== 0 ? 0.75 : 1;
  previewCanvas.style.transform += " scale(" + scale + ")";
}

document.querySelectorAll("#rotSeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#rotSeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    degrees = parseInt(btn.dataset.deg, 10);
    applyPreviewRotation();
  });
});

rotateBtn.addEventListener("click", async () => {
  hideMsg();
  rotateBtn.disabled = true;
  try {
    setProgress(30, "Rotation des pages…");
    const { PDFDocument, degrees: deg } = PDFLib;
    const doc = await PDFDocument.load(srcBytes);
    doc.getPages().forEach((page) => {
      const current = page.getRotation().angle || 0;
      page.setRotation(deg((current + degrees) % 360));
    });
    setProgress(85, "Génération du fichier…");
    const bytes = await doc.save();
    hideProgress();
    offerDownload(bytes, "tchadiapdf-pivote.pdf");
  } catch (e) {
    hideProgress();
    showMsg("La rotation a échoué. Réessayez avec un autre fichier.");
  } finally {
    rotateBtn.disabled = false;
  }
});
