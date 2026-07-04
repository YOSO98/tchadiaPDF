/* tchadiaPdf : Métadonnées PDF
 *
 * Affiche et modifie les métadonnées standard d'un PDF (titre, auteur,
 * sujet, mots-clés, créateur, producteur) via pdf-lib.
 *
 * Point d'attention important : par défaut, PDFDocument.save() de pdf-lib
 * met à jour lui-même les champs Producer et ModDate au moment de
 * l'enregistrement, ce qui écraserait silencieusement les valeurs saisies
 * par l'utilisateur. On appelle donc doc.save({ updateMetadata: false })
 * pour que seules les valeurs choisies ici soient écrites, et on gère la
 * date de modification nous-mêmes.
 */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let currentFile = null;
let currentDoc = null;

const fileListEl = document.getElementById("fileList");
const metaForm = document.getElementById("metaForm");
const saveBtn = document.getElementById("saveBtn");

const titleInput = document.getElementById("metaTitle");
const authorInput = document.getElementById("metaAuthor");
const subjectInput = document.getElementById("metaSubject");
const keywordsInput = document.getElementById("metaKeywords");
const creatorInput = document.getElementById("metaCreator");
const producerInput = document.getElementById("metaProducer");
const creationDateEl = document.getElementById("metaCreationDate");
const modDateEl = document.getElementById("metaModDate");

/** Formate une date en français lisible, ou renvoie un message par défaut. */
function formatDateFr(date) {
  if (!date || isNaN(date.getTime())) return "Non renseignée";
  const datePart = date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  const timePart = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });
  return datePart + " à " + timePart;
}

function resetForm() {
  currentDoc = null;
  metaForm.classList.remove("visible");
  titleInput.value = "";
  authorInput.value = "";
  subjectInput.value = "";
  keywordsInput.value = "";
  creatorInput.value = "";
  producerInput.value = "";
  creationDateEl.textContent = "Non renseignée";
  modDateEl.textContent = "Non renseignée";
}

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
    resetForm();
    updateState();
  };
  fileListEl.appendChild(row);
}

function updateState() {
  saveBtn.disabled = !currentFile || !currentDoc;
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  resetForm();

  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    updateState();
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo).");
    updateState();
    return;
  }

  currentFile = file;
  renderFile();

  try {
    const bytes = await readAsArrayBuffer(file);
    const { PDFDocument } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(bytes);
    } catch (e) {
      const detail = (e && e.message) ? e.message.toLowerCase() : "";
      if (detail.indexOf("encrypt") !== -1) {
        throw new Error("Ce PDF est protégé par mot de passe. Utilisez d'abord l'outil Déverrouiller PDF, puis revenez ici pour modifier ses métadonnées.");
      }
      throw new Error("Impossible de lire ce PDF. Il est peut-être endommagé ou n'est pas un fichier PDF valide. Essayez l'outil Réparer PDF si besoin.");
    }

    currentDoc = doc;

    titleInput.value = doc.getTitle() || "";
    authorInput.value = doc.getAuthor() || "";
    subjectInput.value = doc.getSubject() || "";
    keywordsInput.value = doc.getKeywords() || "";
    creatorInput.value = doc.getCreator() || "";
    producerInput.value = doc.getProducer() || "";
    creationDateEl.textContent = formatDateFr(doc.getCreationDate());
    modDateEl.textContent = formatDateFr(doc.getModificationDate());

    metaForm.classList.add("visible");
  } catch (err) {
    currentFile = null;
    fileListEl.innerHTML = "";
    showMsg(err.message || "Impossible de lire ce PDF.");
  }

  updateState();
});

saveBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");

  if (!currentDoc) {
    showMsg("Veuillez d'abord choisir un fichier PDF.");
    return;
  }

  saveBtn.disabled = true;
  try {
    setProgress(20, "Application des métadonnées…");

    currentDoc.setTitle(titleInput.value);
    currentDoc.setAuthor(authorInput.value);
    currentDoc.setSubject(subjectInput.value);

    const keywordsList = keywordsInput.value
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    currentDoc.setKeywords(keywordsList);

    currentDoc.setCreator(creatorInput.value);
    currentDoc.setProducer(producerInput.value);
    currentDoc.setModificationDate(new Date());

    setProgress(60, "Enregistrement du PDF…");
    const outBytes = await currentDoc.save({ updateMetadata: false });

    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(outBytes, "tchadiapdf-metadonnees.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "L'enregistrement des métadonnées a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    updateState();
  }
});
