/* tchadiaPdf : Déverrouiller PDF
 *
 * Déchiffrement réel via qpdf (WebAssembly) : le texte et les vecteurs du
 * document d'origine sont préservés (contrairement à une simple mise à plat
 * en images). Si le moteur qpdf ne peut pas être chargé (coupure réseau),
 * on se replie sur pdf.js + pdf-lib pour reconstruire le PDF à partir du
 * rendu de chaque page : le résultat reste utilisable, mais le texte n'est
 * alors plus sélectionnable.
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

/** Repli : reconstruit le PDF à partir du rendu de chaque page (texte non sélectionnable). */
async function deverrouillerParImages(bytes, options) {
  const pdf = await pdfjsLib.getDocument(options).promise;
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
  return outDoc.save();
}

unlockBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  unlockBtn.disabled = true;

  try {
    setProgress(5, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(currentFile);

    let outBytes;
    try {
      setProgress(10, "Téléchargement du moteur de déchiffrement (une seule fois)…");
      outBytes = await window.QpdfEngine.runQpdf(
        new Uint8Array(bytes),
        (inName, outName) => {
          const args = [];
          if (needsPassword) args.push("--password=" + pw1.value);
          args.push("--decrypt", "--", inName, outName);
          return args;
        },
        (pct) => setProgress(10 + Math.round(pct * 0.6), "Téléchargement du moteur de déchiffrement…" + (pct < 100 ? " " + pct + "%" : ""))
      );
      setProgress(95, "Finalisation…");
    } catch (engineErr) {
      const stderr = (engineErr && engineErr.qpdfStderr) || "";
      if (/password/i.test(stderr)) {
        throw new Error("Mot de passe incorrect. Vérifiez-le et réessayez.");
      }
      if (engineErr && engineErr.qpdfCode !== undefined) {
        // Le moteur a bien tourné mais a échoué pour une autre raison (fichier non chiffré
        // avec ce mot de passe, structure invalide...) : on considère le PDF illisible.
        throw new Error("Impossible de déverrouiller ce PDF. Il est peut-être endommagé.");
      }
      // Le moteur qpdf n'a pas pu être chargé du tout (réseau) : repli sur pdf.js + pdf-lib.
      setProgress(20, "Le moteur avancé est indisponible, utilisation de la méthode de secours…");
      const options = { data: bytes.slice(0) };
      if (needsPassword) options.password = pw1.value;
      try {
        outBytes = await deverrouillerParImages(bytes, options);
      } catch (e) {
        if (e && e.name === "PasswordException") {
          throw new Error("Mot de passe incorrect. Vérifiez-le et réessayez.");
        }
        throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être endommagé.");
      }
      setTimeout(() => showMsg("Le moteur de déverrouillage avancé n'a pas pu être chargé (problème réseau). Une méthode de secours a été utilisée : le PDF est déverrouillé, mais son texte n'est plus sélectionnable."), 0);
    }

    hideProgress();
    offerDownload(outBytes, "tchadiapdf-deverrouille.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "Le déverrouillage a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    updateState();
  }
});
