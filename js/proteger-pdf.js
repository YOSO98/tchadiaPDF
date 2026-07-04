/* tchadiaPdf : Protéger PDF */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let currentFile = null;

const fileListEl = document.getElementById("fileList");
const pwOptions = document.getElementById("pwOptions");
const pw1 = document.getElementById("pw1");
const pw2 = document.getElementById("pw2");
const protectBtn = document.getElementById("protectBtn");

initDropzone("dropzone", "fileInput", (newFiles) => {
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
  pwOptions.style.display = "flex";
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
  protectBtn.disabled = !currentFile || !pw1.value || pw1.value !== pw2.value;
}
pw1.addEventListener("input", updateState);
pw2.addEventListener("input", updateState);

protectBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");

  if (pw1.value !== pw2.value) {
    showMsg("Les deux mots de passe ne correspondent pas.");
    return;
  }
  if (!pw1.value) {
    showMsg("Veuillez saisir un mot de passe.");
    return;
  }

  protectBtn.disabled = true;
  try {
    setProgress(10, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(currentFile);
    const { PDFDocument } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(bytes);
    } catch (e) {
      throw new Error("Ce PDF est déjà protégé par mot de passe ou est endommagé. Utilisez d'abord l'outil Déverrouiller PDF si besoin.");
    }

    setProgress(40, "Préparation du document…");
    // Reserialise dans le format xref classique attendu par le module de chiffrement,
    // quelle que soit la structure interne du fichier d'origine.
    const flatBytes = await doc.save({ useObjectStreams: false });

    setProgress(70, "Chiffrement du document…");
    const encrypted = PdfCrypt.encryptPdfBytes(flatBytes, pw1.value);

    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(encrypted, "tchadiapdf-protege.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "La protection du PDF a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    updateState();
  }
});
