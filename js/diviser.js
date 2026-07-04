/* tchadiaPdf : Diviser PDF */

let srcBytes = null;
let selected = new Set();
let pageCount = 0;

const thumbsEl = document.getElementById("thumbs");
const splitBtn = document.getElementById("splitBtn");
const selTools = document.getElementById("selTools");
const selCount = document.getElementById("selCount");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  try {
    setProgress(5, "Lecture du fichier…");
    srcBytes = await readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
    pageCount = pdf.numPages;
    selected = new Set();
    thumbsEl.innerHTML = "";
    selTools.style.display = "flex";

    for (let i = 1; i <= pageCount; i++) {
      setProgress(5 + Math.round((i / pageCount) * 90), "Aperçu de la page " + i + " / " + pageCount + "…");
      const div = document.createElement("div");
      div.className = "thumb";
      div.setAttribute("role", "checkbox");
      div.setAttribute("aria-checked", "false");
      div.tabIndex = 0;
      const canvas = document.createElement("canvas");
      div.appendChild(canvas);
      const num = document.createElement("div");
      num.className = "t-num";
      num.textContent = "Page " + i;
      div.appendChild(num);
      thumbsEl.appendChild(div);
      await renderPdfPage(pdf, i, canvas, 130);
      const toggle = () => {
        if (selected.has(i)) { selected.delete(i); div.classList.remove("selected"); div.setAttribute("aria-checked", "false"); }
        else { selected.add(i); div.classList.add("selected"); div.setAttribute("aria-checked", "true"); }
        updateState();
      };
      div.addEventListener("click", toggle);
      div.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    }
    hideProgress();
    updateState();
  } catch (e) {
    hideProgress();
    showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }
});

function updateState() {
  selCount.textContent = selected.size + (selected.size > 1 ? " pages sélectionnées" : " page sélectionnée");
  splitBtn.disabled = selected.size === 0;
}

document.getElementById("selectAll").addEventListener("click", () => {
  selected = new Set(Array.from({ length: pageCount }, (_, i) => i + 1));
  thumbsEl.querySelectorAll(".thumb").forEach((t) => { t.classList.add("selected"); t.setAttribute("aria-checked", "true"); });
  updateState();
});
document.getElementById("selectNone").addEventListener("click", () => {
  selected.clear();
  thumbsEl.querySelectorAll(".thumb").forEach((t) => { t.classList.remove("selected"); t.setAttribute("aria-checked", "false"); });
  updateState();
});

splitBtn.addEventListener("click", async () => {
  hideMsg();
  splitBtn.disabled = true;
  try {
    setProgress(20, "Extraction des pages…");
    const { PDFDocument } = PDFLib;
    const src = await PDFDocument.load(srcBytes);
    const out = await PDFDocument.create();
    const indices = Array.from(selected).sort((a, b) => a - b).map((n) => n - 1);
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    setProgress(90, "Génération du fichier…");
    const bytes = await out.save();
    hideProgress();
    offerDownload(bytes, "tchadiapdf-extrait.pdf");
  } catch (e) {
    hideProgress();
    showMsg("L'extraction a échoué. Réessayez avec un autre fichier.");
  } finally {
    splitBtn.disabled = selected.size === 0;
  }
});
