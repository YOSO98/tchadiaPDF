/* tchadiaPdf : Aplatir un PDF */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let pdfDoc = null; // document pdf-lib chargé, réutilisé pour l'aplatissement et l'enregistrement

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const analyseBox = document.getElementById("analyseBox");
const analyseTexte = document.getElementById("analyseTexte");
const flattenBtn = document.getElementById("flattenBtn");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  analyseBox.classList.remove("visible");
  flattenBtn.disabled = true;
  pdfDoc = null;
  fileInfo.style.display = "none";

  const file = newFiles[0];
  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo). Choisissez un fichier plus léger.");
    return;
  }

  try {
    setProgress(20, "Lecture du fichier…");
    const buffer = await readAsArrayBuffer(file);

    const { PDFDocument } = PDFLib;
    let doc;
    try {
      doc = await PDFDocument.load(buffer, { updateMetadata: false });
    } catch (e) {
      hideProgress();
      const details = (e && e.message ? e.message : "").toLowerCase();
      if (details.indexOf("encrypt") !== -1) {
        showMsg(
          "Ce PDF est protégé par mot de passe et ne peut pas être aplati directement. " +
          "Utilisez d'abord l'outil déverrouiller-pdf, puis revenez ici avec le fichier déverrouillé."
        );
      } else {
        showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      }
      return;
    }

    setProgress(55, "Analyse du formulaire…");
    let nbChamps = 0;
    try {
      const form = doc.getForm();
      nbChamps = form.getFields().length;
    } catch (e) {
      // Pas d'AcroForm exploitable : ce n'est pas bloquant, l'aplatissement portera
      // uniquement sur les annotations éventuelles.
      nbChamps = 0;
    }

    pdfDoc = doc;
    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size);
    fileInfo.style.display = "flex";

    if (nbChamps > 0) {
      analyseTexte.textContent =
        "Ce PDF contient " + nbChamps + " champ" + (nbChamps > 1 ? "s" : "") +
        " de formulaire qui seront figés.";
    } else {
      analyseTexte.textContent =
        "Ce PDF ne contient pas de champ de formulaire modifiable ; l'aplatissement figera uniquement les annotations éventuelles.";
    }
    analyseBox.classList.add("visible");

    flattenBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
});

flattenBtn.addEventListener("click", async () => {
  if (!pdfDoc) return;
  hideMsg();
  flattenBtn.disabled = true;
  try {
    setProgress(30, "Aplatissement du formulaire…");

    let avertissement = null;
    try {
      const form = pdfDoc.getForm();
      try {
        form.flatten();
      } catch (e) {
        avertissement =
          "L'aplatissement automatique de certains champs a échoué. Le fichier téléchargé contient " +
          "l'aplatissement partiel qui a pu être réalisé.";
      }
    } catch (e) {
      // Aucun formulaire exploitable dans ce PDF : rien à aplatir, ce n'est pas bloquant.
    }

    setProgress(75, "Génération du fichier…");
    const bytes = await pdfDoc.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, "tchadiapdf-aplati.pdf");

    if (avertissement) showMsg(avertissement);
  } catch (e) {
    hideProgress();
    showMsg("L'aplatissement de ce PDF a échoué. Réessayez avec un autre fichier.");
  } finally {
    flattenBtn.disabled = false;
  }
});
