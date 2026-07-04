/* tchadiaPdf : utilitaires communs */

// Configuration de pdf.js (rendu des miniatures)
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/**
 * Initialise une zone de glisser-déposer.
 * @param {string} dzId       id de la dropzone
 * @param {string} inputId    id de l'input file caché
 * @param {(files: File[]) => void} onFiles  callback avec les fichiers acceptés
 */
function initDropzone(dzId, inputId, onFiles) {
  const dz = document.getElementById(dzId);
  const input = document.getElementById(inputId);

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => {
    if (input.files.length) onFiles(Array.from(input.files));
    input.value = "";
  });

  ["dragover", "dragenter"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  });
}

/** Affiche la barre de progression (0 à 100) avec un texte. */
function setProgress(pct, label) {
  const wrap = document.getElementById("progress");
  wrap.classList.add("visible");
  wrap.querySelector(".progress-bar > div").style.width = pct + "%";
  if (label) wrap.querySelector(".progress-label").textContent = label;
}
function hideProgress() {
  document.getElementById("progress").classList.remove("visible");
}

/** Affiche un message d'erreur ou d'information. */
function showMsg(text) {
  const el = document.getElementById("msg");
  el.textContent = "ⓘ " + text;
  el.classList.add("visible");
}
function hideMsg() {
  const el = document.getElementById("msg");
  if (el) el.classList.remove("visible");
}

/** Propose le téléchargement d'un fichier généré. */
function offerDownload(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime || "application/pdf" });
  const url = URL.createObjectURL(blob);
  const result = document.getElementById("result");
  const link = result.querySelector("a.btn-primary");
  link.href = url;
  link.download = filename;
  result.classList.add("visible");
  result.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Taille lisible. */
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " o";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " Ko";
  return (bytes / 1048576).toFixed(1) + " Mo";
}

/** Lit un File en ArrayBuffer. */
function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Impossible de lire le fichier " + file.name));
    r.readAsArrayBuffer(file);
  });
}

/** Rend la première page (ou une page donnée) d'un PDF dans un canvas. */
async function renderPdfPage(pdfDoc, pageNum, canvas, maxWidth) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const scale = (maxWidth || 150) / viewport.width;
  const vp = page.getViewport({ scale });
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
}
