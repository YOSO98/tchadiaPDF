/* tchadiaPdf : Réparer PDF
 *
 * S'appuie sur qpdf (WebAssembly) : ouvrir puis réenregistrer un PDF avec
 * qpdf reconstruit automatiquement une table de références croisées
 * manquante ou invalide, ce qui répare la grande majorité des fichiers
 * PDF endommagés rencontrés en pratique. Limite honnête : un fichier
 * tronqué au point de ne plus contenir aucune structure PDF exploitable
 * (ni trailer, ni objets) ne peut être réparé par aucun outil, qpdf inclus.
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let currentFile = null;

const fileListEl = document.getElementById("fileList");
const repairOptions = document.getElementById("repairOptions");
const linearizeBox = document.getElementById("linearize");
const repairBtn = document.getElementById("repairBtn");

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
  repairOptions.style.display = "flex";
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
    repairOptions.style.display = "none";
    updateState();
  };
  fileListEl.appendChild(row);
}

function updateState() {
  repairBtn.disabled = !currentFile;
}

repairBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  repairBtn.disabled = true;

  try {
    setProgress(5, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(currentFile);

    setProgress(15, "Téléchargement du moteur de réparation (une seule fois)…");
    let outBytes;
    try {
      outBytes = await window.QpdfEngine.runQpdf(
        new Uint8Array(bytes),
        (inName, outName) => {
          const args = [];
          if (linearizeBox.checked) args.push("--linearize");
          args.push(inName, outName);
          return args;
        },
        (pct) => setProgress(15 + Math.round(pct * 0.55), "Téléchargement du moteur de réparation…" + (pct < 100 ? " " + pct + "%" : ""))
      );
    } catch (engineErr) {
      const stderr = (engineErr && engineErr.qpdfStderr) || "";
      if (/password/i.test(stderr)) {
        throw new Error("Ce PDF est protégé par mot de passe. Utilisez d'abord l'outil Déverrouiller PDF.");
      }
      if (engineErr && engineErr.qpdfCode !== undefined) {
        throw new Error("Ce fichier est trop endommagé pour être réparé automatiquement : sa structure PDF est illisible même après reconstruction.");
      }
      throw new Error("Le moteur de réparation n'a pas pu être chargé (problème réseau). Réessayez dans un instant.");
    }

    setProgress(90, "Finalisation…");
    hideProgress();
    offerDownload(outBytes, "tchadiapdf-repare.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "La réparation a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    updateState();
  }
});
