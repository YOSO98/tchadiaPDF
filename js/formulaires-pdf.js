/* tchadiaPdf : Remplir un formulaire PDF */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let pdfDoc = null; // document pdf-lib chargé, réutilisé pour l'enregistrement
let fieldsMap = null; // Map<nomDuChamp, { field, kind, el }>

const fieldsEl = document.getElementById("formFields");
const fillBtn = document.getElementById("fillBtn");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const flattenOption = document.getElementById("flattenOption");
const flattenAfterFill = document.getElementById("flattenAfterFill");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  fieldsEl.innerHTML = "";
  fieldsEl.style.display = "none";
  fillBtn.disabled = true;
  fieldsMap = null;
  pdfDoc = null;
  fileInfo.style.display = "none";
  flattenOption.style.display = "none";
  flattenAfterFill.checked = false;

  const file = newFiles[0];
  const validation = validateFile(file, { accept: ["pdf", "application/pdf"], acceptLabel: "un fichier PDF" });
  if (!validation.ok) {
    showMsg(validation.message);
    return;
  }
  if (validation.warning) showMsg(validation.warning);

  try {
    setProgress(20, "Lecture du fichier…");
    const buffer = await readAsArrayBuffer(file);

    const { PDFDocument } = PDFLib;
    let doc;
    try {
      doc = await PDFDocument.load(buffer, { updateMetadata: false });
    } catch (e) {
      hideProgress();
      showMsg("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
      return;
    }

    setProgress(55, "Analyse du formulaire…");
    let form;
    try {
      form = doc.getForm();
    } catch (e) {
      hideProgress();
      showMsg("Impossible de lire le formulaire de ce PDF.");
      return;
    }

    let fields;
    try {
      fields = form.getFields();
    } catch (e) {
      hideProgress();
      showMsg("Impossible de lire le formulaire de ce PDF.");
      return;
    }

    if (!fields || fields.length === 0) {
      hideProgress();
      showMsg("Ce PDF ne contient aucun champ de formulaire à remplir.");
      return;
    }

    pdfDoc = doc;
    fileName.textContent = file.name;
    fileMeta.textContent =
      fmtSize(file.size) + " · " + fields.length + " champ" + (fields.length > 1 ? "s" : "") +
      " détecté" + (fields.length > 1 ? "s" : "");
    fileInfo.style.display = "flex";

    genererChamps(fields);
    hideProgress();
  } catch (e) {
    hideProgress();
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
});

/** Construit la ligne label + input pour un champ. */
function creerLabel(id, nom, typeLisible) {
  const label = document.createElement("label");
  label.setAttribute("for", id);
  label.textContent = nom + " ";
  const span = document.createElement("span");
  span.className = "field-type";
  span.textContent = "(" + typeLisible + ")";
  label.appendChild(span);
  return label;
}

/** Remplit un <select> avec des options, présélectionne la valeur donnée si présente. */
function remplirOptions(selectEl, options, valeurSelectionnee) {
  options.forEach((opt) => {
    const optionEl = document.createElement("option");
    optionEl.value = opt;
    optionEl.textContent = opt;
    if (valeurSelectionnee !== null && valeurSelectionnee !== undefined && opt === valeurSelectionnee) {
      optionEl.selected = true;
    }
    selectEl.appendChild(optionEl);
  });
}

/** Génère la liste des champs de formulaire à remplir à partir des champs détectés par pdf-lib. */
function genererChamps(fields) {
  const map = new Map();
  fieldsEl.innerHTML = "";
  let index = 0;

  fields.forEach((field) => {
    const nom = field.getName();
    const id = "champ-formulaire-" + (index++);
    const row = document.createElement("div");
    row.className = "form-field-row";
    let kind = null;
    let inputEl = null;

    if (field instanceof PDFLib.PDFTextField) {
      kind = "text";
      const multiligne = typeof field.isMultiline === "function" && field.isMultiline();
      inputEl = document.createElement(multiligne ? "textarea" : "input");
      if (!multiligne) inputEl.type = "text";
      inputEl.id = id;
      let valeur = "";
      try { valeur = field.getText() || ""; } catch (e) { valeur = ""; }
      inputEl.value = valeur;
      row.appendChild(creerLabel(id, nom, "texte"));
      row.appendChild(inputEl);
    } else if (field instanceof PDFLib.PDFCheckBox) {
      kind = "checkbox";
      row.classList.add("checkbox-row");
      inputEl = document.createElement("input");
      inputEl.type = "checkbox";
      inputEl.id = id;
      let coche = false;
      try { coche = field.isChecked(); } catch (e) { coche = false; }
      inputEl.checked = coche;
      row.appendChild(creerLabel(id, nom, "case à cocher"));
      row.appendChild(inputEl);
    } else if (field instanceof PDFLib.PDFRadioGroup) {
      kind = "radio";
      inputEl = document.createElement("select");
      inputEl.id = id;
      let options = [];
      try { options = field.getOptions() || []; } catch (e) { options = []; }
      let selection = null;
      try { selection = field.getSelected(); } catch (e) { selection = null; }
      remplirOptions(inputEl, options, selection);
      row.appendChild(creerLabel(id, nom, "choix unique"));
      row.appendChild(inputEl);
    } else if (field instanceof PDFLib.PDFDropdown) {
      kind = "dropdown";
      inputEl = document.createElement("select");
      inputEl.id = id;
      let options = [];
      try { options = field.getOptions() || []; } catch (e) { options = []; }
      let selectionArr = [];
      try { selectionArr = field.getSelected() || []; } catch (e) { selectionArr = []; }
      const selection = selectionArr.length ? selectionArr[0] : null;
      remplirOptions(inputEl, options, selection);
      row.appendChild(creerLabel(id, nom, "liste déroulante"));
      row.appendChild(inputEl);
    } else if (field instanceof PDFLib.PDFOptionList) {
      kind = "optionlist";
      inputEl = document.createElement("select");
      inputEl.id = id;
      inputEl.multiple = true;
      let options = [];
      try { options = field.getOptions() || []; } catch (e) { options = []; }
      let selectionArr = [];
      try { selectionArr = field.getSelected() || []; } catch (e) { selectionArr = []; }
      options.forEach((opt) => {
        const optionEl = document.createElement("option");
        optionEl.value = opt;
        optionEl.textContent = opt;
        optionEl.selected = selectionArr.indexOf(opt) !== -1;
        inputEl.appendChild(optionEl);
      });
      row.appendChild(creerLabel(id, nom, "liste à sélection multiple"));
      row.appendChild(inputEl);
    } else {
      // Type de champ non reconnu par cet outil : ignoré sans bloquer les autres champs.
      return;
    }

    fieldsEl.appendChild(row);
    map.set(nom, { field, kind, el: inputEl });
  });

  fieldsMap = map;

  if (map.size > 0) {
    fieldsEl.style.display = "flex";
    fillBtn.disabled = false;
    flattenOption.style.display = "flex";
  } else {
    fieldsEl.style.display = "none";
    fillBtn.disabled = true;
    flattenOption.style.display = "none";
    showMsg("Ce PDF ne contient aucun champ de formulaire à remplir.");
  }
}

async function runFill() {
  if (!pdfDoc || !fieldsMap || fieldsMap.size === 0) return;
  hideMsg();
  fillBtn.disabled = true;
  try {
    setProgress(30, "Application des valeurs…");

    fieldsMap.forEach(({ field, kind, el }) => {
      try {
        if (kind === "text") {
          field.setText(el.value);
        } else if (kind === "checkbox") {
          if (el.checked) field.check();
          else field.uncheck();
        } else if (kind === "radio") {
          if (el.value) field.select(el.value);
        } else if (kind === "dropdown") {
          if (el.value) field.select(el.value);
        } else if (kind === "optionlist") {
          const valeurs = Array.from(el.selectedOptions).map((o) => o.value);
          field.select(valeurs);
        }
      } catch (e) {
        // Une valeur invalide sur ce champ ne doit pas empêcher les autres d'être appliquées.
      }
    });

    let avertissement = null;
    if (flattenAfterFill.checked) {
      setProgress(60, "Aplatissement du formulaire…");
      try {
        pdfDoc.getForm().flatten();
      } catch (e) {
        avertissement =
          "L'aplatissement automatique de certains champs a échoué. Le fichier téléchargé contient " +
          "l'aplatissement partiel qui a pu être réalisé.";
      }
    }

    setProgress(75, "Génération du fichier…");
    const bytes = await pdfDoc.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, "tchadiapdf-formulaire-rempli.pdf");

    if (avertissement) showMsg(avertissement);
  } catch (e) {
    hideProgress();
    showError("L'enregistrement du PDF rempli a échoué. Réessayez avec un autre fichier.", { retry: runFill });
  } finally {
    fillBtn.disabled = false;
  }
}

fillBtn.addEventListener("click", runFill);
