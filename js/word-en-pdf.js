/* tchadiaPdf : Word en PDF */

const MAX_SIZE = 25 * 1024 * 1024; // 25 Mo
const MAX_BATCH_FILES = 20;
// Delai maximal accorde au worker d'analyse mammoth avant d'abandonner (fichier trop
// volumineux/pathologique ou corrompu au point de faire boucler le parseur).
const MAMMOTH_WORKER_TIMEOUT_MS = 30000;

// Dimensions de rendu hors écran (96 dpi), avant rasterisation.
const PAGE_PX_W = 794;   // A4 largeur ~ 210mm
const PAGE_PX_H = 1123;  // A4 hauteur ~ 297mm
const PAD_PX = 76;       // marges ~ 20mm
const CONTENT_W = PAGE_PX_W - PAD_PX * 2;
const CONTENT_H = PAGE_PX_H - PAD_PX * 2;

// Dimensions du PDF final (points, A4).
const PDF_W = 595.28;
const PDF_H = 841.89;

let currentFile = null;
let currentArrayBuffer = null;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const convertBtn = document.getElementById("convertBtn");
const resultEl = document.getElementById("result");

const fileListEl = document.getElementById("fileList");
const batchActionsEl = document.getElementById("batchActions");
const startBatchBtn = document.getElementById("startBatchBtn");
const pauseBatchBtn = document.getElementById("pauseBatchBtn");
const cancelBatchBtn = document.getElementById("cancelBatchBtn");
const globalProgressEl = document.getElementById("globalProgress");
const globalProgressLabel = document.getElementById("globalProgressLabel");

let batchQueue = [];
let batchRunning = false;
let batchPaused = false;
let batchCancelled = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDocxFile(file) {
  return (
    file.name.toLowerCase().endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

/** Attend que toutes les images d'un conteneur soient chargées avant toute mesure de hauteur. */
function waitForImages(container) {
  const imgs = Array.from(container.querySelectorAll("img"));
  return Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    })
  );
}

/**
 * Découpe un conteneur HTML (déjà rempli et attaché hors écran) en pages,
 * en répliquant l'en-tête des tableaux coupés entre deux pages.
 * Retourne un tableau de <div> de page, prêts pour html2canvas.
 */
function paginateContainer(container) {
  // 1) Pré-découpage des tableaux de premier niveau trop hauts pour une page.
  const directTables = Array.from(container.children).filter((el) => el.tagName === "TABLE");
  directTables.forEach((table) => {
    const rows = Array.from(table.rows);
    if (rows.length <= 1) return;
    const headerRow = rows[0];
    const headerHeight = headerRow.getBoundingClientRect().height;
    const dataRows = rows.slice(1);

    // Regroupe les lignes en blocs qui tiennent chacun dans la hauteur utile d'une page.
    const chunks = [];
    let current = [];
    let currentHeight = headerHeight;
    dataRows.forEach((row) => {
      const h = row.getBoundingClientRect().height;
      if (currentHeight + h > CONTENT_H && current.length > 0) {
        chunks.push(current);
        current = [];
        currentHeight = headerHeight;
      }
      current.push(row);
      currentHeight += h;
    });
    if (current.length) chunks.push(current);

    if (chunks.length <= 1) return; // le tableau tient déjà sur une seule page, rien à faire

    const newTables = chunks.map((chunkRows) => {
      const newTable = document.createElement("table");
      newTable.className = table.className;
      const tbody = document.createElement("tbody");
      tbody.appendChild(headerRow.cloneNode(true));
      chunkRows.forEach((row) => tbody.appendChild(row.cloneNode(true)));
      newTable.appendChild(tbody);
      return newTable;
    });

    newTables.forEach((t) => container.insertBefore(t, table));
    container.removeChild(table);
  });

  // 2) Pagination par blocs : on cumule la hauteur des enfants directs.
  const children = Array.from(container.children);
  const pages = [];
  let current = [];
  let currentHeight = 0;

  children.forEach((child) => {
    const h = child.getBoundingClientRect().height;
    if (currentHeight + h > CONTENT_H && current.length > 0) {
      pages.push(current);
      current = [];
      currentHeight = 0;
    }
    current.push(child);
    currentHeight += h;
  });
  if (current.length) pages.push(current);
  if (pages.length === 0) pages.push([]);

  // 3) Construit un <div> de page par groupe, en y déplaçant les nœuds.
  const pageDivs = pages.map((group) => {
    const pageDiv = document.createElement("div");
    pageDiv.className = "docx-render";
    pageDiv.style.position = "absolute";
    pageDiv.style.left = "-9999px";
    pageDiv.style.top = "0";
    pageDiv.style.width = PAGE_PX_W + "px";
    pageDiv.style.height = PAGE_PX_H + "px";
    pageDiv.style.boxSizing = "border-box";
    pageDiv.style.padding = PAD_PX + "px";
    pageDiv.style.background = "#ffffff";
    pageDiv.style.overflow = "hidden";
    document.body.appendChild(pageDiv);
    group.forEach((node) => pageDiv.appendChild(node));
    return pageDiv;
  });

  return pageDivs;
}

/** Rasterise un tableau de <div> de page en un PDFDocument. */
async function renderPagesToPdf(pageDivs, onPageProgress) {
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < pageDivs.length; i++) {
    const div = pageDivs[i];
    const canvas = await html2canvas(div, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = await pdfDoc.embedJpg(bytes);
    const page = pdfDoc.addPage([PDF_W, PDF_H]);
    page.drawImage(img, { x: 0, y: 0, width: PDF_W, height: PDF_H });
    document.body.removeChild(div);
    if (onPageProgress) onPageProgress(i + 1, pageDivs.length);
  }

  return pdfDoc.save();
}

/**
 * Lance mammoth.convertToHtml() dans un Web Worker dédié (js/word-en-pdf.worker.js), avec un
 * délai maximal. C'est l'étape de traitement la plus exposée de cet outil : elle parse une
 * archive ZIP et du XML fournis par l'utilisateur. L'isoler dans un worker évite qu'un fichier
 * pathologique ne gèle l'onglet, et le délai maximal permet d'abandonner proprement plutôt que
 * d'attendre indéfiniment. Repli sur un appel direct dans le thread principal si les Web
 * Workers ne sont pas disponibles (comportement identique à avant ce changement).
 *
 * Remarque de couverture (voir rapport de la Phase Sécurité, Bloc 3) : cette isolation par
 * worker n'a été mise en place que sur cet outil, à titre de preuve de faisabilité. Elle n'est
 * PAS généralisée aux autres convertisseurs du site.
 */
function convertToHtmlIsolated(arrayBuffer, timeoutMs) {
  if (typeof Worker === "undefined") {
    return mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    try {
      worker = new Worker("js/word-en-pdf.worker.js");
    } catch (e) {
      mammoth.convertToHtml({ arrayBuffer: arrayBuffer }).then(resolve, reject);
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(
        "L'analyse de ce document a dépassé le délai maximal (" + Math.round(timeoutMs / 1000) +
        " s). Le fichier est peut-être trop volumineux ou corrompu."
      ));
    }, timeoutMs);

    worker.onmessage = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      const data = e.data || {};
      if (data.ok) {
        resolve({ value: data.html, messages: data.warnings || [] });
      } else {
        reject(new Error(data.error || "Le worker d'analyse du document a échoué."));
      }
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("Le worker d'analyse du document a rencontré une erreur inattendue."));
    };

    worker.postMessage({ arrayBuffer: arrayBuffer }, [arrayBuffer]);
  });
}

/** Convertit un fichier DOCX (ArrayBuffer) en PDF. Retourne { bytes, warnings }. */
async function convertDocxToPdf(arrayBuffer, onPageProgress) {
  // Validation par octets magiques : un .docx est une archive ZIP contenant "word/".
  // On informe/refuse si le contenu réel est manifestement incohérent avec l'extension,
  // plutôt que de se fier uniquement au nom de fichier ou au type MIME du navigateur.
  const sniffed = sniffFileType(arrayBuffer);
  if (sniffed !== "docx" && sniffed !== "ooxml" && sniffed !== "zip") {
    throw new Error("Ce fichier ne semble pas être un document Word (.docx) valide (contenu détecté : " + sniffed + ").");
  }

  // arrayBuffer est transféré (detaché) au worker : on en garde une copie pour la suite
  // (pagination/rasterisation), le worker n'en a besoin que pour son propre traitement.
  const bufferForWorker = arrayBuffer.slice(0);
  const result = await convertToHtmlIsolated(bufferForWorker, MAMMOTH_WORKER_TIMEOUT_MS);
  const html = result.value;
  const warnings = (result.messages || []).filter((m) => m.type === "warning" || m.type === "error");

  const measure = document.createElement("div");
  measure.className = "docx-render";
  measure.style.position = "absolute";
  measure.style.left = "-9999px";
  measure.style.top = "0";
  measure.style.width = CONTENT_W + "px";
  // Ce conteneur est attaché au DOM réel de la page (html2canvas doit pouvoir le rasteriser),
  // et le HTML vient de mammoth.convertToHtml() sur un fichier .docx potentiellement malveillant :
  // on l'assainit systématiquement avant insertion (voir js/security-utils.js).
  measure.innerHTML = sanitizeHtmlForDisplay(html || "<p></p>");
  document.body.appendChild(measure);

  let bytes;
  try {
    await waitForImages(measure);
    const pageDivs = paginateContainer(measure);
    bytes = await renderPagesToPdf(pageDivs, onPageProgress);
  } finally {
    if (measure.parentNode) document.body.removeChild(measure);
  }

  return { bytes, warnings };
}

initDropzone("dropzone", "fileInput", async (newFiles) => {
  if (newFiles.length > 1) {
    setupBatch(newFiles);
  } else {
    setupSingleFile(newFiles);
  }
});

async function setupSingleFile(newFiles) {
  resetBatchUI();
  convertBtn.style.display = "";

  hideMsg();
  resultEl.classList.remove("visible");
  const file = newFiles[0];

  if (!isDocxFile(file)) {
    showMsg("Veuillez choisir un fichier Word au format .docx.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 25 Mo. Choisissez un fichier plus léger.");
    return;
  }

  currentFile = file;
  currentArrayBuffer = null;
  fileName.textContent = file.name;
  fileMeta.textContent = fmtSize(file.size);
  fileInfo.classList.add("visible");
  convertBtn.disabled = false;
}

convertBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  hideMsg();
  resultEl.classList.remove("visible");
  convertBtn.disabled = true;

  try {
    setProgress(5, "Lecture du fichier...");
    const arrayBuffer = await readAsArrayBuffer(currentFile);
    setProgress(15, "Analyse du document Word...");
    const { bytes, warnings } = await convertDocxToPdf(arrayBuffer, (p, total) => {
      setProgress(15 + Math.round((p / total) * 80), "Mise en page : page " + p + " / " + total);
    });
    setProgress(100, "Terminé");
    hideProgress();
    const baseName = currentFile.name.replace(/\.docx$/i, "");
    offerDownload(bytes, "tchadiapdf-" + baseName + ".pdf", "application/pdf");
    if (warnings.length > 0) {
      showMsg("Conversion terminée. Certains éléments avancés (" + warnings.length + ") comme des styles très spécifiques ou des objets non standards ont pu être simplifiés.");
    }
  } catch (e) {
    hideProgress();
    if (e && /(contenu détecté|délai maximal)/.test(e.message || "")) {
      showMsg(e.message);
    } else {
      showMsg("Impossible de convertir ce fichier. Vérifiez qu'il s'agit bien d'un fichier .docx valide et non protégé par un mot de passe.");
    }
  } finally {
    convertBtn.disabled = !currentFile;
  }
});

/* ===================== Mode lot (jusqu'à 20 fichiers) ===================== */

function resetBatchUI() {
  batchQueue = [];
  batchRunning = false;
  batchPaused = false;
  batchCancelled = false;
  fileListEl.innerHTML = "";
  fileListEl.style.display = "none";
  batchActionsEl.style.display = "none";
  globalProgressEl.classList.remove("visible");
  startBatchBtn.disabled = false;
  pauseBatchBtn.disabled = true;
  pauseBatchBtn.textContent = "Mettre en pause";
  cancelBatchBtn.disabled = true;
}

function setupBatch(newFiles) {
  hideMsg();
  resultEl.classList.remove("visible");
  hideProgress();

  currentFile = null;
  currentArrayBuffer = null;
  fileInfo.classList.remove("visible");
  convertBtn.disabled = true;
  convertBtn.style.display = "none";

  if (newFiles.length > MAX_BATCH_FILES) {
    showMsg("Vous pouvez traiter au maximum " + MAX_BATCH_FILES + " fichiers à la fois. Sélectionnez-en moins.");
    resetBatchUI();
    convertBtn.style.display = "";
    return;
  }

  batchQueue = newFiles.map((file) => ({
    file: file,
    baseName: file.name.replace(/\.docx$/i, "").replace(/[\/\\]/g, "_"),
    status: "attente",
    error: null,
    bytes: null,
  }));

  batchQueue.forEach((entry) => {
    if (!isDocxFile(entry.file)) {
      entry.status = "erreur";
      entry.error = "Ce n'est pas un fichier .docx.";
    } else if (entry.file.size > MAX_SIZE) {
      entry.status = "erreur";
      entry.error = "Fichier trop volumineux (limite 25 Mo).";
    }
  });

  fileListEl.style.display = "flex";
  batchActionsEl.style.display = "flex";
  startBatchBtn.disabled = false;
  pauseBatchBtn.disabled = true;
  cancelBatchBtn.disabled = false;
  renderFileList();
}

function statusLabel(entry) {
  switch (entry.status) {
    case "attente": return "En attente";
    case "encours": return "En cours...";
    case "termine": return "Terminé";
    case "erreur": return "Erreur : " + (entry.error || "échec du traitement");
    default: return "";
  }
}

function renderFileList() {
  fileListEl.innerHTML = "";
  batchQueue.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "file-item";

    const name = document.createElement("span");
    name.className = "f-name";
    name.textContent = entry.file.name;

    const meta = document.createElement("span");
    meta.className = "f-meta";
    meta.textContent = fmtSize(entry.file.size);

    const status = document.createElement("span");
    status.className = "f-status";
    status.textContent = statusLabel(entry);

    div.appendChild(name);
    div.appendChild(meta);
    div.appendChild(status);
    fileListEl.appendChild(div);
  });
}

function updateGlobalProgress(done, total) {
  globalProgressEl.classList.add("visible");
  const pct = total ? Math.round((done / total) * 100) : 0;
  globalProgressEl.querySelector(".progress-bar > div").style.width = pct + "%";
  globalProgressLabel.textContent = "Fichiers traités : " + done + " / " + total;
}

startBatchBtn.addEventListener("click", () => {
  if (batchQueue.length === 0 || batchRunning) return;
  runBatchProcessing();
});

pauseBatchBtn.addEventListener("click", () => {
  if (!batchRunning) return;
  batchPaused = !batchPaused;
  pauseBatchBtn.textContent = batchPaused ? "Reprendre" : "Mettre en pause";
});

cancelBatchBtn.addEventListener("click", () => {
  batchCancelled = true;
  batchPaused = false;
  if (!batchRunning) {
    resetBatchUI();
    convertBtn.style.display = "";
    hideProgress();
  }
});

async function runBatchProcessing() {
  batchRunning = true;
  batchCancelled = false;
  batchPaused = false;
  hideMsg();
  resultEl.classList.remove("visible");
  startBatchBtn.disabled = true;
  pauseBatchBtn.disabled = false;
  pauseBatchBtn.textContent = "Mettre en pause";
  cancelBatchBtn.disabled = false;

  const total = batchQueue.length;
  let done = batchQueue.filter((e) => e.status === "termine" || e.status === "erreur").length;
  updateGlobalProgress(done, total);

  for (let idx = 0; idx < batchQueue.length; idx++) {
    const entry = batchQueue[idx];
    if (entry.status === "termine" || entry.status === "erreur") continue;

    while (batchPaused && !batchCancelled) {
      await sleep(150);
    }
    if (batchCancelled) break;

    entry.status = "encours";
    renderFileList();

    try {
      const arrayBuffer = await readAsArrayBuffer(entry.file);
      const { bytes } = await convertDocxToPdf(arrayBuffer, (p, totalPages) => {
        setProgress(
          Math.round((p / totalPages) * 100),
          "Fichier " + (idx + 1) + " / " + total + " : " + entry.file.name + ", page " + p + " / " + totalPages
        );
      });
      entry.bytes = bytes;
      entry.status = "termine";
    } catch (e) {
      entry.status = "erreur";
      entry.error = "Corrompu ou format non pris en charge.";
    }

    done++;
    updateGlobalProgress(done, total);
    renderFileList();
  }

  hideProgress();
  batchRunning = false;
  pauseBatchBtn.disabled = true;
  pauseBatchBtn.textContent = "Mettre en pause";
  batchPaused = false;

  if (batchCancelled) {
    resetBatchUI();
    convertBtn.style.display = "";
    showMsg("Traitement annulé.");
    return;
  }

  startBatchBtn.disabled = true;
  cancelBatchBtn.disabled = true;
  await finalizeBatchResults();
}

async function finalizeBatchResults() {
  const succeeded = batchQueue.filter((e) => e.status === "termine");
  const failedCount = batchQueue.length - succeeded.length;

  if (succeeded.length === 0) {
    showMsg("Aucun fichier n'a pu être converti. Consultez la liste ci-dessus pour le détail des erreurs.");
    return;
  }

  try {
    if (succeeded.length === 1) {
      const only = succeeded[0];
      offerDownload(only.bytes, "tchadiapdf-" + only.baseName + ".pdf", "application/pdf");
    } else {
      setProgress(0, "Génération de l'archive ZIP du lot...");
      const zip = new JSZip();
      succeeded.forEach((entry) => {
        zip.file(entry.baseName + ".pdf", entry.bytes);
      });
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(Math.round(meta.percent), "Génération de l'archive ZIP du lot...");
      });
      hideProgress();
      offerDownload(zipBlob, "tchadiapdf-documents.zip", "application/zip");
    }

    if (failedCount > 0) {
      showMsg(failedCount + " fichier(s) sur " + batchQueue.length + " n'ont pas pu être convertis. Consultez la liste ci-dessus pour le détail.");
    }
  } catch (e) {
    hideProgress();
    showMsg("La génération de l'archive finale a échoué. Réessayez.");
  }
}
