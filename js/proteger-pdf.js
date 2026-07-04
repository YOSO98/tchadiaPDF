/* tchadiaPdf : Protéger PDF
 *
 * Chiffrement AES-256 réel via qpdf (WebAssembly), qui offre une bien
 * meilleure sécurité que le chiffrement RC4 128 bits fait main. En cas
 * d'échec de chargement du moteur qpdf (coupure réseau par exemple), on se
 * replie automatiquement sur js/pdf-crypt.js (RC4 128 bits) pour que
 * l'outil reste utilisable, avec un message clair informant l'utilisateur.
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let currentFile = null;

const fileListEl = document.getElementById("fileList");
const pwOptions = document.getElementById("pwOptions");
const pw1 = document.getElementById("pw1");
const pw2 = document.getElementById("pw2");
const linearizeBox = document.getElementById("linearize");
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
    setProgress(5, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(currentFile);
    const { PDFDocument } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(bytes);
    } catch (e) {
      throw new Error("Ce PDF est déjà protégé par mot de passe ou est endommagé. Utilisez d'abord l'outil Déverrouiller PDF ou Réparer PDF si besoin.");
    }

    setProgress(15, "Préparation du document…");
    const flatBytes = await doc.save({ useObjectStreams: false });

    let outBytes;
    try {
      setProgress(20, "Téléchargement du moteur de chiffrement (une seule fois)…");
      outBytes = await window.QpdfEngine.runQpdf(
        new Uint8Array(flatBytes),
        (inName, outName) => {
          const args = [];
          if (linearizeBox.checked) args.push("--linearize");
          args.push("--encrypt", pw1.value, pw1.value, "256", "--", inName, outName);
          return args;
        },
        (pct) => setProgress(20 + Math.round(pct * 0.6), "Téléchargement du moteur de chiffrement…" + (pct < 100 ? " " + pct + "%" : ""))
      );
      setProgress(90, "Chiffrement AES-256 en cours…");
    } catch (engineErr) {
      // Repli sur le chiffrement RC4 128 bits fait maison si le moteur qpdf
      // n'a pas pu être chargé (coupure réseau, bloqueur de contenu…).
      setProgress(60, "Le moteur avancé est indisponible, repli sur le chiffrement standard…");
      outBytes = window.PdfCrypt.encryptPdfBytes(flatBytes, pw1.value);
      setTimeout(() => showMsg("Le chiffrement renforcé (AES-256) n'a pas pu être chargé (problème réseau). Un chiffrement standard (RC4 128 bits) a été appliqué à la place : votre PDF est tout de même protégé par mot de passe."), 0);
    }

    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(outBytes, "tchadiapdf-protege.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "La protection du PDF a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    updateState();
  }
});
