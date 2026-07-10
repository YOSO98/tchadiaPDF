/* tchadiaPdf : Organiser PDF */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let srcBytes = null;          // ArrayBuffer du PDF source (pour pdf-lib)
let pageCount = 0;            // nombre de pages du PDF source
let thumbCache = [];          // thumbCache[srcIndex] = canvas déjà rendu (une seule fois par page source)
let order = [];                // [{ id, srcIndex }] : ordre courant des pages dans le document de sortie
let nextId = 1;                // identifiant unique croissant pour chaque entrée de "order"
let dragSrcId = null;          // id de l'entrée en cours de glisser-déposer
let pendingFocus = null;       // { id, action } : élément à refocaliser après un nouveau rendu de la grille

const thumbsEl = document.getElementById("thumbs");
const applyBtn = document.getElementById("applyBtn");
const resultEl = document.getElementById("result");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");

  const file = newFiles[0];
  if (!file) return;

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier est trop volumineux (limite : 100 Mo). Choisissez un fichier plus léger.");
    return;
  }

  thumbsEl.innerHTML = "";
  applyBtn.disabled = true;

  try {
    setProgress(5, "Lecture du fichier…");
    srcBytes = await readAsArrayBuffer(file);

    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
    } catch (e) {
      throw new Error("Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
    }

    pageCount = pdf.numPages;
    if (!pageCount) {
      throw new Error("Ce PDF ne contient aucune page.");
    }

    order = [];
    thumbCache = new Array(pageCount).fill(null);
    nextId = 1;

    for (let i = 1; i <= pageCount; i++) {
      setProgress(5 + Math.round((i / pageCount) * 85), "Aperçu de la page " + i + " / " + pageCount + "…");
      const canvas = document.createElement("canvas");
      await renderPdfPage(pdf, i, canvas, 150);
      thumbCache[i - 1] = canvas;
      order.push({ id: nextId++, srcIndex: i - 1, rotation: 0 });
    }

    hideProgress();
    renderGrid();
  } catch (err) {
    hideProgress();
    thumbsEl.innerHTML = "";
    applyBtn.disabled = true;
    srcBytes = null;
    pageCount = 0;
    thumbCache = [];
    order = [];
    showMsg(err.message || "Impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
  }
});

/** Clone un canvas déjà rendu, sans jamais redemander un rendu à pdf.js. */
function cloneCachedCanvas(cached) {
  const canvas = document.createElement("canvas");
  canvas.width = cached.width;
  canvas.height = cached.height;
  canvas.getContext("2d").drawImage(cached, 0, 0);
  return canvas;
}

/** Applique un aperçu visuel (CSS) de la rotation choisie pour une miniature. */
function applyThumbRotation(canvas, rotation) {
  if (!rotation) return;
  canvas.style.transition = "transform 150ms ease";
  canvas.style.transform = "rotate(" + rotation + "deg)" + (rotation % 180 !== 0 ? " scale(0.75)" : "");
}

/** Reconstruit entièrement la grille de miniatures à partir du tableau "order". */
function renderGrid() {
  thumbsEl.innerHTML = "";

  if (order.length === 0) {
    applyBtn.disabled = true;
    showMsg("Le document ne peut pas être vide.");
    pendingFocus = null;
    return;
  }

  hideMsg();
  applyBtn.disabled = false;

  order.forEach((entry, idx) => {
    const position = idx + 1;

    const div = document.createElement("div");
    div.className = "thumb";
    div.draggable = true;
    div.tabIndex = 0;
    div.dataset.id = String(entry.id);
    div.setAttribute("aria-label", "Page en position " + position);

    const cached = thumbCache[entry.srcIndex];
    if (cached) {
      const canvas = cloneCachedCanvas(cached);
      applyThumbRotation(canvas, entry.rotation);
      div.appendChild(canvas);
    }

    const num = document.createElement("div");
    num.className = "t-num";
    num.textContent = "Position " + position;
    div.appendChild(num);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";
    actions.innerHTML =
      '<button type="button" class="icon-btn" data-action="up" title="Monter" aria-label="Monter la page ' + position + '">↑</button>' +
      '<button type="button" class="icon-btn" data-action="down" title="Descendre" aria-label="Descendre la page ' + position + '">↓</button>' +
      '<button type="button" class="icon-btn" data-action="rotate" title="Pivoter" aria-label="Pivoter la page ' + position + ' de 90 degres">⟳</button>' +
      '<button type="button" class="icon-btn" data-action="dup" title="Dupliquer" aria-label="Dupliquer la page ' + position + '">⧉</button>' +
      '<button type="button" class="icon-btn" data-action="del" title="Supprimer" aria-label="Supprimer la page ' + position + '">✕</button>';
    div.appendChild(actions);

    const upBtn = actions.querySelector('[data-action="up"]');
    const downBtn = actions.querySelector('[data-action="down"]');
    const rotateBtn = actions.querySelector('[data-action="rotate"]');
    const dupBtn = actions.querySelector('[data-action="dup"]');
    const delBtn = actions.querySelector('[data-action="del"]');

    upBtn.disabled = idx === 0;
    downBtn.disabled = idx === order.length - 1;

    upBtn.addEventListener("click", () => {
      if (idx === 0) return;
      [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
      pendingFocus = { id: entry.id, action: "up" };
      renderGrid();
    });
    downBtn.addEventListener("click", () => {
      if (idx === order.length - 1) return;
      [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
      pendingFocus = { id: entry.id, action: "down" };
      renderGrid();
    });
    rotateBtn.addEventListener("click", () => {
      entry.rotation = (entry.rotation + 90) % 360;
      pendingFocus = { id: entry.id, action: "rotate" };
      renderGrid();
    });
    dupBtn.addEventListener("click", () => {
      const copy = { id: nextId++, srcIndex: entry.srcIndex, rotation: entry.rotation };
      order.splice(idx + 1, 0, copy);
      pendingFocus = { id: copy.id, action: "dup" };
      renderGrid();
    });
    delBtn.addEventListener("click", () => {
      order.splice(idx, 1);
      const neighbor = order[idx] || order[idx - 1];
      pendingFocus = neighbor ? { id: neighbor.id, action: "del" } : null;
      renderGrid();
    });

    div.addEventListener("dragstart", (e) => {
      dragSrcId = entry.id;
      div.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", String(entry.id)); } catch (err) { /* ignoré */ }
    });
    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");
      thumbsEl.querySelectorAll(".thumb.drag-over").forEach((t) => t.classList.remove("drag-over"));
      dragSrcId = null;
    });
    div.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragSrcId !== null && dragSrcId !== entry.id) div.classList.add("drag-over");
    });
    div.addEventListener("dragleave", () => {
      div.classList.remove("drag-over");
    });
    div.addEventListener("drop", (e) => {
      e.preventDefault();
      div.classList.remove("drag-over");
      if (dragSrcId === null || dragSrcId === entry.id) return;
      const fromIdx = order.findIndex((o) => o.id === dragSrcId);
      const toIdx = order.findIndex((o) => o.id === entry.id);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = order.splice(fromIdx, 1);
      order.splice(toIdx, 0, moved);
      pendingFocus = { id: moved.id, action: "drop" };
      renderGrid();
    });

    thumbsEl.appendChild(div);
  });

  if (pendingFocus) {
    const target = thumbsEl.querySelector('[data-id="' + pendingFocus.id + '"]');
    if (target) {
      const actionToButton = { up: "up", down: "down", rotate: "rotate", dup: "dup" };
      const btnAction = actionToButton[pendingFocus.action];
      const toFocus = btnAction ? target.querySelector('[data-action="' + btnAction + '"]') : target;
      if (toFocus) toFocus.focus();
    }
    pendingFocus = null;
  }
}

applyBtn.addEventListener("click", async () => {
  hideMsg();
  resultEl.classList.remove("visible");

  if (!srcBytes || order.length === 0) {
    showMsg("Le document ne peut pas être vide.");
    return;
  }

  applyBtn.disabled = true;
  try {
    setProgress(10, "Préparation du document…");
    const { PDFDocument, degrees } = PDFLib;
    let src;
    try {
      src = await PDFDocument.load(srcBytes);
    } catch (e) {
      throw new Error("Ce PDF est protégé par mot de passe ou endommagé, la génération est impossible.");
    }

    const out = await PDFDocument.create();
    setProgress(35, "Copie des pages…");
    const pages = await out.copyPages(src, order.map((o) => o.srcIndex));
    pages.forEach((p, i) => {
      const rotation = order[i].rotation || 0;
      if (rotation) {
        const current = p.getRotation().angle || 0;
        p.setRotation(degrees((current + rotation) % 360));
      }
      out.addPage(p);
    });

    setProgress(85, "Génération du fichier final…");
    const bytes = await out.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(bytes, "tchadiapdf-organise.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "La génération a échoué. Vérifiez votre fichier et réessayez.");
  } finally {
    applyBtn.disabled = order.length === 0;
  }
});
