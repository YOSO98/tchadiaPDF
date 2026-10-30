/* tchadiaPdf : Compresser PDF */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo par fichier
const MAX_FILES = 50; // fichiers maximum par lot

// Profils inspirés de la boîte « Optimiser le PDF » d'Acrobat : résolution
// cible (ppp), qualité JPEG, conversion des images sans perte en JPEG et
// linéarisation (optimisation pour l'affichage web progressif).
const PROFILES = {
  web: { dpi: 96, quality: 0.6, convertLossless: true, linearize: true },
  print: { dpi: 150, quality: 0.8, convertLossless: true, linearize: false },
  archive: { dpi: 300, quality: 0.9, convertLossless: false, linearize: false },
  custom: null,
};
let profile = "web";
let worker = null; // instance réutilisée pour tout le lot, un seul fichier traité à la fois
let activeReject = null; // permet d'interrompre le fichier en cours en cas d'annulation

let queue = []; // { id, file, status, message, originalSize, newSize, imagesFound }
let nextId = 1;
let isProcessing = false;
let isPaused = false;
let cancelRequested = false;

const fileListEl = document.getElementById("fileList");
const qualityOptions = document.getElementById("qualityOptions");
const dpiInput = document.getElementById("dpiInput");
const qualityInput = document.getElementById("qualityInput");
const qualityValue = document.getElementById("qualityValue");
const convertBox = document.getElementById("convertLossless");
const junkBox = document.getElementById("removeJunk");
const linearizeBox = document.getElementById("linearize");
const customOptions = document.getElementById("customOptions");
const profileHint = document.getElementById("profileHint");
const imagesReportEl = document.getElementById("imagesReport");
const compressBtn = document.getElementById("compressBtn");
const pauseBtn = document.getElementById("pauseBtn");
const cancelAllBtn = document.getElementById("cancelAllBtn");
const globalProgressWrap = document.getElementById("globalProgress");
const resultEl = document.getElementById("result");
const resultTitleEl = document.getElementById("resultTitle");
const sizeBeforeEl = document.getElementById("sizeBefore");
const sizeAfterEl = document.getElementById("sizeAfter");
const sizeReductionEl = document.getElementById("sizeReduction");
const batchSummaryEl = document.getElementById("batchSummary");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setGlobalProgress(pct, label) {
  globalProgressWrap.classList.add("visible");
  globalProgressWrap.querySelector(".progress-bar > div").style.width = pct + "%";
  if (label) document.getElementById("globalProgressLabel").textContent = label;
}
function hideGlobalProgress() {
  globalProgressWrap.classList.remove("visible");
}

function statusLabel(item) {
  switch (item.status) {
    case "attente": return "En attente";
    case "encours": return "En cours…";
    case "termine": return item.message || "Terminé";
    case "erreur": return "Erreur : " + (item.message || "la compression a échoué");
    case "ignore": return "Ignoré" + (item.message ? " : " + item.message : "");
    default: return "";
  }
}

function renderQueue() {
  fileListEl.innerHTML = "";

  queue.forEach((item) => {
    const row = document.createElement("div");
    row.className = "file-item";
    row.dataset.id = String(item.id);

    const nameEl = document.createElement("span");
    nameEl.className = "f-name";
    nameEl.textContent = item.file.name;
    row.appendChild(nameEl);

    const metaEl = document.createElement("span");
    metaEl.className = "f-meta";
    metaEl.textContent = fmtSize(item.file.size);
    row.appendChild(metaEl);

    const statusEl = document.createElement("span");
    statusEl.className = "f-status";
    statusEl.textContent = statusLabel(item);
    row.appendChild(statusEl);

    if (item.status === "attente" || item.status === "ignore") {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "icon-btn";
      removeBtn.title = "Retirer";
      removeBtn.setAttribute("aria-label", "Retirer " + item.file.name);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        queue = queue.filter((q) => q.id !== item.id);
        renderQueue();
      });
      row.appendChild(removeBtn);
    }

    fileListEl.appendChild(row);
  });

  qualityOptions.style.display = queue.length > 0 ? "flex" : "none";
  updateStartButton();
}

function updateStartButton() {
  const pending = queue.filter((q) => q.status === "attente").length;
  compressBtn.disabled = isProcessing || pending === 0;
  if (queue.length === 1 && pending === 1) {
    compressBtn.textContent = "Compresser le PDF";
  } else if (pending > 0) {
    compressBtn.textContent = "Démarrer le traitement (" + pending + " fichier" + (pending > 1 ? "s" : "") + ")";
  } else {
    compressBtn.textContent = "Compresser le PDF";
  }
}

initDropzone("dropzone", "fileInput", (newFiles) => {
  if (isProcessing) {
    showMsg("Le traitement est en cours. Attendez la fin ou annulez avant d'ajouter d'autres fichiers.");
    return;
  }
  hideMsg();
  resultEl.classList.remove("visible");

  // Un nouveau dépôt après un lot entièrement traité repart d'une file vide.
  const hasPending = queue.some((q) => q.status === "attente");
  if (!hasPending && queue.length > 0) {
    queue = [];
  }

  const pdfFiles = newFiles.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfFiles.length < newFiles.length) {
    showMsg("Seuls les fichiers PDF sont acceptés, les autres ont été ignorés.");
  }

  const spaceLeft = Math.max(0, MAX_FILES - queue.length);
  let toAdd = pdfFiles;
  let overflow = false;
  if (toAdd.length > spaceLeft) {
    overflow = true;
    toAdd = toAdd.slice(0, spaceLeft);
  }

  const oversized = toAdd.filter((f) => f.size > MAX_SIZE);
  toAdd.forEach((file) => {
    queue.push({ id: nextId++, file, status: "attente", message: "" });
  });

  const messages = [];
  if (overflow) {
    messages.push("Vous avez dépassé la limite de " + MAX_FILES + " fichiers. Les " + MAX_FILES + " premiers ont été conservés, les suivants ont été ignorés.");
  }
  if (oversized.length) {
    messages.push(oversized.length + " fichier(s) de plus de 100 Mo : le traitement reste possible mais peut être lent.");
  }
  if (messages.length) showMsg(messages.join(" "));

  renderQueue();
});

const PROFILE_HINTS = {
  web: "96 ppp, qualité JPEG 60 %, photos sans perte converties en JPEG, fichier linéarisé : idéal pour l'envoi par e-mail et la lecture à l'écran.",
  print: "150 ppp, qualité JPEG 80 %, photos sans perte converties en JPEG : bon compromis pour une impression de bureau.",
  archive: "300 ppp, qualité JPEG 90 %, images sans perte conservées telles quelles : qualité maximale, gain plus modeste.",
  custom: "Réglez la résolution cible (72 à 600 ppp), la qualité JPEG et les options ci-dessous.",
};

function applyProfile(name) {
  profile = name;
  document.querySelectorAll("#profileSeg button").forEach((b) => {
    const active = b.dataset.profile === name;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const preset = PROFILES[name];
  const isCustom = !preset;
  customOptions.hidden = !isCustom;
  if (preset) {
    dpiInput.value = String(preset.dpi);
    qualityInput.value = String(preset.quality);
    convertBox.checked = preset.convertLossless;
    linearizeBox.checked = preset.linearize;
  }
  convertBox.disabled = !isCustom;
  qualityValue.textContent = Math.round(parseFloat(qualityInput.value) * 100) + " %";
  profileHint.textContent = PROFILE_HINTS[name];
}

/** Lit les options courantes (profil ou réglages personnalisés) pour un fichier. */
function currentOptions() {
  const preset = PROFILES[profile];
  let dpi = parseInt(dpiInput.value, 10);
  if (!Number.isFinite(dpi)) dpi = 150;
  dpi = Math.min(600, Math.max(72, dpi));
  let quality = parseFloat(qualityInput.value);
  if (!Number.isFinite(quality)) quality = 0.7;
  quality = Math.min(0.95, Math.max(0.3, quality));
  return {
    dpi: preset ? preset.dpi : dpi,
    quality: preset ? preset.quality : quality,
    convertLossless: preset ? preset.convertLossless : convertBox.checked,
    removeJunk: junkBox.checked,
    linearize: linearizeBox.checked,
  };
}

document.querySelectorAll("#profileSeg button").forEach((btn) => {
  btn.addEventListener("click", () => applyProfile(btn.dataset.profile));
});
qualityInput.addEventListener("input", () => {
  qualityValue.textContent = Math.round(parseFloat(qualityInput.value) * 100) + " %";
});
dpiInput.addEventListener("change", () => {
  let v = parseInt(dpiInput.value, 10);
  if (!Number.isFinite(v)) v = 150;
  dpiInput.value = String(Math.min(600, Math.max(72, v)));
});
applyProfile("web");

/** Étape 1 : images et nettoyage dans le Web Worker partagé, retourne une promesse. */
function compressInWorker(file, options, onProgress) {
  return new Promise((resolve, reject) => {
    activeReject = reject;
    onProgress(2, "Lecture du fichier…");

    readAsArrayBuffer(file)
      .then((arrayBuffer) => {
        if (!worker) worker = new Worker("js/compresser-pdf.worker.js");
        const w = worker;

        w.onmessage = (e) => {
          const data = e.data;

          if (data.type === "progress") {
            onProgress(data.pct, data.label);
            return;
          }

          if (data.type === "done") {
            activeReject = null;
            resolve({
              bytes: data.bytes,
              originalSize: data.originalSize,
              newSize: data.newSize,
              imagesFound: data.imagesFound,
              stats: data.stats || null,
            });
            return;
          }

          if (data.type === "error") {
            activeReject = null;
            reject(new Error(data.message || "La compression a échoué. Vérifiez votre fichier et réessayez."));
          }
        };

        w.onerror = () => {
          activeReject = null;
          worker = null; // on abandonne ce worker, un nouveau sera créé pour le fichier suivant
          reject(new Error("La compression a échoué de manière inattendue."));
        };

        onProgress(5, "Préparation de la compression…");
        w.postMessage({ arrayBuffer, options }, [arrayBuffer]);
      })
      .catch(() => {
        activeReject = null;
        reject(new Error("Impossible de lire ce fichier."));
      });
  });
}

const QPDF_ARGS = [
  "--object-streams=generate",
  "--recompress-flate",
  "--compression-level=9",
  "--remove-unreferenced-resources=yes",
  "--stream-data=compress",
];

/**
 * Étape 2 : passe finale qpdf (flux d'objets, recompression Flate maximale,
 * ressources non référencées, linéarisation optionnelle). Renvoie null si
 * qpdf échoue : le résultat du worker reste alors utilisable tel quel.
 */
async function qpdfPass(bytes, linearize, onProgress) {
  if (!window.QpdfEngine) return null;
  try {
    return await window.QpdfEngine.runQpdf(
      bytes,
      (inName, outName) => QPDF_ARGS.concat(linearize ? ["--linearize"] : [], [inName, outName]),
      (pct) => onProgress(86 + Math.round(pct * 0.08), "Téléchargement du moteur d'optimisation (une seule fois)…" + (pct < 100 ? " " + pct + "%" : ""))
    );
  } catch (err) {
    return null;
  }
}

/**
 * Compresse un fichier de bout en bout. Règle absolue : jamais un fichier
 * plus gros que l'original ; dans ce cas l'original est livré tel quel et
 * signalé comme déjà optimisé.
 */
async function compressOneFile(file, options, onProgress) {
  const originalSize = file.size;
  const workerResult = await compressInWorker(file, options, onProgress);
  if (cancelRequested) throw new Error("Traitement annulé.");

  onProgress(86, "Optimisation de la structure du fichier…");
  const qpdfBytes = await qpdfPass(workerResult.bytes, options.linearize, onProgress);
  if (cancelRequested) throw new Error("Traitement annulé.");

  let bytes = workerResult.bytes;
  if (qpdfBytes) {
    // Linéarisation demandée : on garde la sortie qpdf dès qu'elle gagne sur
    // l'original, sinon on retient simplement la plus petite des deux.
    if (options.linearize ? qpdfBytes.byteLength < originalSize : qpdfBytes.byteLength < bytes.byteLength) {
      bytes = qpdfBytes;
    }
  }

  let alreadyOptimized = false;
  if (bytes.byteLength >= originalSize) {
    bytes = new Uint8Array(await readAsArrayBuffer(file));
    alreadyOptimized = true;
  }

  return {
    bytes,
    originalSize,
    newSize: bytes.byteLength,
    imagesFound: workerResult.imagesFound,
    stats: workerResult.stats || { imagesFound: workerResult.imagesFound, recompressed: 0, resampled: 0, converted: 0, skipped: 0 },
    alreadyOptimized,
    qpdfApplied: !!qpdfBytes,
  };
}

function gainPercent(r) {
  return r.originalSize > 0 ? Math.max(0, Math.round((1 - r.newSize / r.originalSize) * 100)) : 0;
}

function imagesReportText(stats) {
  if (!stats || stats.imagesFound === 0) return "Aucune image dans ce PDF : seule la structure du fichier a été optimisée.";
  const parts = [
    stats.imagesFound + " image(s) trouvée(s)",
    (stats.recompressed + stats.converted) + " traitée(s)",
    stats.resampled + " ré-échantillonnée(s)",
    stats.converted + " convertie(s) en JPEG",
  ];
  let text = "Images : " + parts.join(", ") + ".";
  if (stats.skipped > 0) {
    text += " " + stats.skipped + " image(s) non traitée(s) (masque de transparence, couleur indexée, CMJN ou format non pris en charge).";
  }
  return text;
}

function rowSummary(r) {
  if (r.alreadyOptimized) return "Déjà optimisé : " + fmtSize(r.originalSize) + ", original conservé";
  return "Terminé : " + fmtSize(r.originalSize) + " vers " + fmtSize(r.newSize) + ", gain " + gainPercent(r) + " %";
}

function baseNameCompressed(originalName) {
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  return base + "-compresse.pdf";
}

async function finalizeResults(successResults, failureCount, totalToProcess) {
  if (successResults.length === 0) {
    showMsg("Aucun fichier n'a pu être compressé. Consultez la liste ci-dessus pour le détail des erreurs.");
    return;
  }

  sizeBeforeEl.style.display = "";
  sizeAfterEl.style.display = "";
  sizeReductionEl.style.display = "";
  batchSummaryEl.style.display = "none";

  if (successResults.length === 1) {
    // Comportement identique à l'ancien mode un seul fichier : téléchargement direct, pas de ZIP.
    const r = successResults[0];

    resultTitleEl.textContent = r.alreadyOptimized
      ? "Ce PDF est déjà optimisé : l'original est livré tel quel."
      : "Votre PDF compressé est prêt.";
    sizeBeforeEl.textContent = "Taille avant : " + fmtSize(r.originalSize);
    sizeAfterEl.textContent = "Taille après : " + fmtSize(r.newSize);
    sizeReductionEl.textContent = r.alreadyOptimized ? "Aucun gain possible sans perte de contenu" : "Réduction de " + gainPercent(r) + " %";
    imagesReportEl.textContent = imagesReportText(r.stats);

    offerDownload(r.bytes, "tchadiapdf-compresse.pdf");
    return;
  }

  // Plusieurs fichiers traités avec succès : on regroupe le tout dans une archive ZIP.
  sizeBeforeEl.style.display = "none";
  sizeAfterEl.style.display = "none";
  sizeReductionEl.style.display = "none";
  batchSummaryEl.style.display = "block";

  const totalBefore = successResults.reduce((acc, r) => acc + r.originalSize, 0);
  const totalAfter = successResults.reduce((acc, r) => acc + r.newSize, 0);
  const totalGain = totalBefore > 0 ? Math.max(0, Math.round((1 - totalAfter / totalBefore) * 100)) : 0;
  const alreadyCount = successResults.filter((r) => r.alreadyOptimized).length;

  resultTitleEl.textContent = successResults.length + " fichier(s) traité(s) avec succès sur " + totalToProcess + ".";
  batchSummaryEl.textContent = "Total : " + fmtSize(totalBefore) + " vers " + fmtSize(totalAfter) + ", gain " + totalGain + " %." +
    (alreadyCount > 0 ? " " + alreadyCount + " fichier(s) déjà optimisé(s), livré(s) tel(s) quel(s)." : "") +
    (failureCount > 0 ? " " + failureCount + " fichier(s) en échec, voir la liste ci-dessus." : "");
  imagesReportEl.textContent = "Le détail par fichier (taille avant et après, gain) figure dans la liste ci-dessus.";

  const zip = new JSZip();
  successResults.forEach((r) => {
    zip.file(baseNameCompressed(r.name), r.bytes);
  });
  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  offerDownload(zipBytes, "tchadiapdf-compresses.zip", "application/zip");
}

async function processQueue() {
  const toProcess = queue.filter((q) => q.status === "attente");
  const totalToProcess = toProcess.length;
  let doneCount = 0;
  let failureCount = 0;
  const successResults = [];
  const options = currentOptions();

  setGlobalProgress(0, "0 / " + totalToProcess + " fichier(s) traité(s)");

  for (let i = 0; i < toProcess.length; i++) {
    if (cancelRequested) break;

    while (isPaused && !cancelRequested) {
      await sleep(200);
    }
    if (cancelRequested) break;

    const item = toProcess[i];
    item.status = "encours";
    renderQueue();

    try {
      const outcome = await compressOneFile(item.file, options, (pct, label) => {
        setProgress(pct, (totalToProcess > 1 ? "Fichier " + (i + 1) + " / " + totalToProcess + " : " : "") + label);
      });
      item.status = "termine";
      item.message = rowSummary(outcome);
      successResults.push(Object.assign({ name: item.file.name }, outcome));
    } catch (err) {
      item.status = "erreur";
      item.message = (err && err.message) ? err.message : "La compression a échoué.";
      failureCount++;
    }

    if (cancelRequested) break; // annulé pendant le traitement de ce fichier : on ne remet pas l'affichage à jour

    doneCount++;
    renderQueue();
    setGlobalProgress(Math.round((doneCount / totalToProcess) * 100), doneCount + " / " + totalToProcess + " fichier(s) traité(s)");
  }

  if (worker) {
    worker.terminate();
    worker = null;
  }
  hideProgress();

  if (cancelRequested) {
    hideGlobalProgress();
    return; // le bouton "Tout annuler" gère déjà le message et la réinitialisation de la file
  }

  hideGlobalProgress();
  await finalizeResults(successResults, failureCount, totalToProcess);
}

compressBtn.addEventListener("click", async () => {
  if (isProcessing) return;
  hideMsg();
  resultEl.classList.remove("visible");

  isProcessing = true;
  isPaused = false;
  cancelRequested = false;
  pauseBtn.textContent = "Mettre en pause";
  pauseBtn.style.display = "inline-flex";
  cancelAllBtn.style.display = "inline-flex";
  compressBtn.disabled = true;

  await processQueue();

  isProcessing = false;
  pauseBtn.style.display = "none";
  cancelAllBtn.style.display = "none";
  updateStartButton();
});

pauseBtn.addEventListener("click", () => {
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? "Reprendre" : "Mettre en pause";
  if (isPaused) {
    showMsg("Traitement en pause, il reprendra avant le prochain fichier.");
  } else {
    hideMsg();
  }
});

cancelAllBtn.addEventListener("click", () => {
  cancelRequested = true;
  isPaused = false;

  if (worker) {
    try { worker.terminate(); } catch (err) { /* ignoré */ }
    worker = null;
  }
  if (activeReject) {
    const reject = activeReject;
    activeReject = null;
    reject(new Error("Traitement annulé."));
  }

  queue = [];
  renderQueue();
  hideProgress();
  hideGlobalProgress();

  isProcessing = false;
  pauseBtn.style.display = "none";
  cancelAllBtn.style.display = "none";
  showMsg("Traitement annulé, la file a été réinitialisée.");
  updateStartButton();
});
