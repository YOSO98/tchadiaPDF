/* tchadiaPdf : Déverrouiller PDF
 *
 * pdf-lib ne sait pas déchiffrer un PDF protégé. On s'appuie donc sur pdf.js
 * (qui sait décoder RC4 et AES avec le bon mot de passe) pour afficher
 * chaque page, puis on reconstruit un nouveau PDF non protégé à partir de
 * ces pages avec pdf-lib. Limitation assumée : le texte du document
 * d'origine n'est plus sélectionnable dans le résultat (les pages sont des
 * images), mais l'apparence visuelle est préservée et le fichier n'est plus
 * protégé par mot de passe.
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let currentFile = null;
let needsPassword = false;

const fileListEl = document.getElementById("fileList");
const pwOptions = document.getElementById("pwOptions");
const pw1 = document.getElementById("pw1");
const unlockBtn = document.getElementById("unlockBtn");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo).");
    return;
  }
  currentFile = file;
  renderFile();

  try {
    const bytes = await readAsArrayBuffer(file);
    await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    needsPassword = false;
    pwOptions.style.display = "none";
    showMsg("Ce PDF n'est pas protégé par mot de passe. Vous pouvez tout de même le déverrouiller si besoin.");
  } catch (e) {
    if (e && e.name === "PasswordException") {
      needsPassword = true;
      pwOptions.style.display = "flex";
      hideMsg();
    } else {
      showMsg("Impossible de lire ce PDF. Il est peut-être endommagé.");
      currentFile = null;
    }
  }
  updateState();
});

function renderFile() {
  fileListEl.innerHTML = "";
  if (!currentFile) return;
  const row = document.createElement("div");
  row.className = "file-item";
  row.innerHTML =
    '<span class="f-name"></span><span class="f-meta"></span>' +
    '<button class="icon-btn" title="Retirer" aria-label="Retirer">✕</button>';
  row.querySelector(".f-name").textContent = currentFile.name;
  row.querySelector(".f-meta").textContent = fmtSize(currentFile.size);
  row.querySelector("button").onclick = () => {
    currentFile = null;
    fileListEl.innerHTML = "";
    pwOptions.style.display = "none";
    updateState();
  };
  fileListEl.appendChild(row);
}

function updateState() {
  unlockBtn.disabled = !currentFile || (needsPassword && !pw1.value);
}
pw1.addEventListener("input", updateState);

unlockBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  unlockBtn.disabled = true;

  try {
    setProgress(5, "Ouverture du document…");
    const bytes = await readAsArrayBuffer(currentFile);
    const options = { data: bytes.slice(0) };
    if (needsPassword) options.password = pw1.value;

    let pdf;
    try {
      pdf = await pdfjsLib.getDocument(options).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") {
        throw new Error("Mot de passe incorrect. Vérifiez-le et réessayez.");
      }
      throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être endommagé.");
    }

    const { PDFDocument } = PDFLib;
    const outDoc = await PDFDocument.create();

    for (let i = 1; i <= pdf.numPages; i++) {
      setProgress(5 + Math.round((i / pdf.numPages) * 85), "Traitement de la page " + i + " / " + pdf.numPages + "…");
      const page = await pdf.getPage(i);
      const ptViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale: 2 });

      const canvas = document.createElement("canvas");
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: renderViewport }).promise;

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      const imgBytes = new Uint8Array(await blob.arrayBuffer());
      const jpg = await outDoc.embedJpg(imgBytes);

      const outPage = outDoc.addPage([ptViewport.width, ptViewport.height]);
      outPage.drawImage(jpg, { x: 0, y: 0, width: ptViewport.width, height: ptViewport.height });
    }

    setProgress(95, "Génération du fichier final…");
    const out = await outDoc.save();
    hideProgress();
    offerDownload(out, "tchadiapdf-deverrouille.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "Le déverrouillage a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    updateState();
  }
});
