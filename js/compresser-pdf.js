/* tchadiaPdf : Compresser PDF */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let currentFile = null;
let quality = 0.6;
let worker = null;

const fileInfo = document.getElementById("fileInfo");
const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const qualityOptions = document.getElementById("qualityOptions");
const compressBtn = document.getElementById("compressBtn");
const cancelBtn = document.getElementById("cancelBtn");
const resultEl = document.getElementById("result");
const sizeBeforeEl = document.getElementById("sizeBefore");
const sizeAfterEl = document.getElementById("sizeAfter");
const sizeReductionEl = document.getElementById("sizeReduction");

initDropzone("dropzone", "fileInput", (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");
  const file = newFiles[0];
  if (!file) return;

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la taille maximale autorisée de 100 Mo. Choisissez un fichier plus léger.");
    return;
  }

  currentFile = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = fmtSize(file.size);
  fileInfo.style.display = "flex";
  qualityOptions.style.display = "flex";
  compressBtn.disabled = false;
});

document.querySelectorAll("#qualitySeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#qualitySeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    quality = parseFloat(btn.dataset.quality);
  });
});

compressBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  hideMsg();
  resultEl.classList.remove("visible");
  compressBtn.disabled = true;

  let arrayBuffer;
  try {
    setProgress(2, "Lecture du fichier…");
    arrayBuffer = await readAsArrayBuffer(currentFile);
  } catch (e) {
    hideProgress();
    showMsg("Impossible de lire ce fichier. Réessayez.");
    compressBtn.disabled = false;
    return;
  }

  worker = new Worker("js/compresser-pdf.worker.js");
  cancelBtn.style.display = "inline-flex";

  worker.onmessage = (e) => {
    const data = e.data;

    if (data.type === "progress") {
      setProgress(data.pct, data.label);
      return;
    }

    if (data.type === "done") {
      hideProgress();
      cancelBtn.style.display = "none";

      const reduction =
        data.originalSize > 0 ? Math.max(0, Math.round((1 - data.newSize / data.originalSize) * 100)) : 0;

      sizeBeforeEl.textContent = "Taille avant : " + fmtSize(data.originalSize);
      sizeAfterEl.textContent = "Taille après : " + fmtSize(data.newSize);
      sizeReductionEl.textContent = "Réduction de " + reduction + " %";

      offerDownload(data.bytes, "tchadiapdf-compresse.pdf");

      if (data.imagesFound === 0) {
        showMsg("Aucune image compressible n'a été trouvée dans ce PDF.");
      }

      compressBtn.disabled = false;
      worker = null;
      return;
    }

    if (data.type === "error") {
      hideProgress();
      cancelBtn.style.display = "none";
      showMsg(data.message || "La compression a échoué. Vérifiez votre fichier et réessayez.");
      compressBtn.disabled = false;
      worker = null;
    }
  };

  worker.onerror = () => {
    hideProgress();
    cancelBtn.style.display = "none";
    showMsg("La compression a échoué de manière inattendue. Réessayez avec un autre fichier.");
    compressBtn.disabled = false;
    worker = null;
  };

  setProgress(5, "Préparation de la compression…");
  worker.postMessage({ arrayBuffer, quality }, [arrayBuffer]);
});

cancelBtn.addEventListener("click", () => {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  hideProgress();
  cancelBtn.style.display = "none";
  showMsg("Compression annulée.");
  compressBtn.disabled = false;
});
