/* tchadiaPdf : Compresser PDF */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo par fichier
const MAX_FILES = 50; // fichiers maximum par lot

let quality = 0.6;
let worker = null; // instance réutilisée pour tout le lot, un seul fichier traité à la fois
let activeReject = null; // permet d'interrompre le fichier en cours en cas d'annulation

let queue = []; // { id, file, status, message, originalSize, newSize, imagesFound }
let nextId = 1;
let isProcessing = false;
let isPaused = false;
let cancelRequested = false;

const fileListEl = document.getElementById("fileList");
const qualityOptions = document.getElementById("qualityOptions");
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
    case "termine": return "Terminé";
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

  toAdd.forEach((file) => {
    if (file.size > MAX_SIZE) {
      queue.push({ id: nextId++, file, status: "ignore", message: "fichier trop volumineux (100 Mo maximum)" });
    } else {
      queue.push({ id: nextId++, file, status: "attente", message: "" });
    }
  });

  if (overflow) {
    showMsg("Vous avez dépassé la limite de " + MAX_FILES + " fichiers. Les " + MAX_FILES + " premiers ont été conservés, les suivants ont été ignorés.");
  }

  renderQueue();
});

document.querySelectorAll("#qualitySeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#qualitySeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    quality = parseFloat(btn.dataset.quality);
  });
});

/** Compresse un seul fichier via le Web Worker partagé, retourne une promesse. */
function compressOneFile(file, onProgress) {
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
        w.postMessage({ arrayBuffer, quality }, [arrayBuffer]);
      })
      .catch(() => {
        activeReject = null;
        reject(new Error("Impossible de lire ce fichier."));
      });
  });
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
    const reduction = r.originalSize > 0 ? Math.max(0, Math.round((1 - r.newSize / r.originalSize) * 100)) : 0;

    resultTitleEl.textContent = "Votre PDF compressé est prêt.";
    sizeBeforeEl.textContent = "Taille avant : " + fmtSize(r.originalSize);
    sizeAfterEl.textContent = "Taille après : " + fmtSize(r.newSize);
    sizeReductionEl.textContent = "Réduction de " + reduction + " %";

    offerDownload(r.bytes, "tchadiapdf-compresse.pdf");

    if (r.imagesFound === 0) {
      showMsg("Aucune image compressible n'a été trouvée dans ce PDF.");
    }
    return;
  }

  // Plusieurs fichiers traités avec succès : on regroupe le tout dans une archive ZIP.
  sizeBeforeEl.style.display = "none";
  sizeAfterEl.style.display = "none";
  sizeReductionEl.style.display = "none";
  batchSummaryEl.style.display = "block";

  resultTitleEl.textContent = successResults.length + " fichier(s) compressé(s) avec succès sur " + totalToProcess + ".";
  batchSummaryEl.textContent = failureCount > 0
    ? failureCount + " fichier(s) en échec. Consultez la liste ci-dessus pour le détail."
    : "Tous les fichiers ont été compressés sans erreur.";

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
      const outcome = await compressOneFile(item.file, (pct, label) => {
        setProgress(pct, (totalToProcess > 1 ? "Fichier " + (i + 1) + " / " + totalToProcess + " : " : "") + label);
      });
      item.status = "termine";
      item.message = "";
      successResults.push({
        name: item.file.name,
        bytes: outcome.bytes,
        originalSize: outcome.originalSize,
        newSize: outcome.newSize,
        imagesFound: outcome.imagesFound,
      });
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
