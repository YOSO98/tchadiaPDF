/* tchadiaPdf : utilitaires communs */

// Configuration de pdf.js (rendu des miniatures)
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "/vendor/pdf.worker-3.11.174.min.js";
}

// Support hors ligne (PWA) : enregistre le service worker une fois la page
// chargee, jamais avant (pour ne jamais retarder le premier affichage).
if ("serviceWorker" in navigator) {
  // sw.js prend le controle immediatement a chaque mise a jour (skipWaiting
  // + clients.claim), mais la page deja chargee en memoire reste figee sur
  // l'ancien HTML/CSS/JS tant qu'elle n'est pas rechargee. "controllerchange"
  // se declenche juste apres cette prise de controle : on ignore la toute
  // premiere occurrence (simple activation initiale, pas une mise a jour) et
  // on affiche le bandeau uniquement pour les suivantes (vraie mise a jour
  // pendant que l'onglet est deja ouvert).
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) showUpdateBanner();
    hadController = true;
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Echec silencieux volontaire : le site fonctionne normalement sans
      // support hors ligne (navigation privee, navigateur ancien, etc.),
      // ce n'est jamais une fonctionnalite bloquante.
    });
  });
}

function showUpdateBanner() {
  if (document.getElementById("swUpdateBanner")) return;
  const bar = document.createElement("div");
  bar.id = "swUpdateBanner";
  bar.className = "sw-update-banner";
  const text = document.createElement("span");
  text.textContent = "Nouvelle version disponible";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Actualiser";
  btn.addEventListener("click", () => window.location.reload());
  bar.appendChild(text);
  bar.appendChild(btn);
  document.body.appendChild(bar);
}

/**
 * Initialise une zone de glisser-déposer.
 * @param {string} dzId       id de la dropzone
 * @param {string} inputId    id de l'input file caché
 * @param {(files: File[]) => void} onFiles  callback avec les fichiers acceptés
 */
function initDropzone(dzId, inputId, onFiles) {
  const dz = document.getElementById(dzId);
  const input = document.getElementById(inputId);

  decorateDropzone(dz, input);

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => {
    if (input.files.length) onFiles(Array.from(input.files));
    input.value = "";
  });

  ["dragover", "dragenter"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  });

  // Si un fichier a ete depose sur l'accueil et route automatiquement vers
  // cet outil (js/index-page.js), le charge ici comme s'il venait d'etre
  // selectionne normalement. Ne fait rien si aucun transfert n'est en attente.
  consumePendingFile().then((file) => {
    if (file) onFiles([file]);
  });
}

/* Libelles lisibles des types acceptes (attribut accept de l'input file),
   affiches sous la dropzone : l'utilisateur sait avant de choisir ce que
   l'outil attend. Un type inconnu est ignore plutot qu'affiche brut. */
const ACCEPT_LABELS = {
  "application/pdf": "PDF", ".pdf": "PDF",
  "image/jpeg": "JPG", ".jpg": "JPG", ".jpeg": "JPG",
  "image/png": "PNG", ".png": "PNG",
  "image/webp": "WebP", ".webp": "WebP",
  "image/tiff": "TIFF", ".tif": "TIFF", ".tiff": "TIFF",
  "image/bmp": "BMP", ".bmp": "BMP",
  "image/heic": "HEIC", "image/heif": "HEIC", ".heic": "HEIC", ".heif": "HEIC",
  "image/svg+xml": "SVG", ".svg": "SVG",
  "image/*": "Images",
  ".docx": "DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  ".xlsx": "XLSX", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  ".csv": "CSV", "text/csv": "CSV",
  ".pptx": "PPTX", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  ".txt": "TXT", "text/plain": "TXT",
  ".md": "Markdown", ".markdown": "Markdown", "text/markdown": "Markdown",
  ".html": "HTML", ".htm": "HTML", "text/html": "HTML",
  ".epub": "EPUB", "application/epub+zip": "EPUB",
};

/**
 * Complete l'accessibilite et l'affordance d'une dropzone sans toucher au
 * HTML des pages : nom accessible = texte visible (WCAG 2.5.3), description
 * = texte secondaire, et liste des formats acceptes derivee de l'attribut
 * accept de l'input (jamais dupliquee a la main dans 46 pages).
 */
function decorateDropzone(dz, input) {
  if (!dz || dz.dataset.decorated === "1") return;
  dz.dataset.decorated = "1";

  // Nom accessible = tout le texte visible de la zone (WCAG 2.5.3), construit
  // apres l'ajout eventuel des formats ci-dessous (voir fin de fonction).
  const title = dz.querySelector("strong");
  const hint = dz.querySelector("span");
  if (title && !title.id) title.id = dz.id + "-titre";
  if (hint && !hint.id) hint.id = dz.id + "-aide";

  const accept = input && input.getAttribute("accept");
  let list = dz.querySelector(".dz-formats");
  if (accept && !list) {
    const labels = [];
    accept.split(",").forEach((raw) => {
      const key = raw.trim().toLowerCase();
      const label = ACCEPT_LABELS[key];
      if (label && labels.indexOf(label) === -1) labels.push(label);
    });
    if (labels.length) {
      list = document.createElement("div");
      list.className = "dz-formats";
      labels.forEach((label) => {
        const chip = document.createElement("span");
        chip.textContent = label;
        list.appendChild(chip);
      });
      dz.appendChild(list);
    }
  }
  if (list && !list.id) list.id = dz.id + "-formats";

  const labelIds = [title, hint, list].filter(Boolean).map((el) => el.id);
  if (labelIds.length) {
    dz.setAttribute("aria-labelledby", labelIds.join(" "));
    dz.removeAttribute("aria-label");
    dz.removeAttribute("aria-describedby");
  }
}

const PENDING_FILE_DB = "tchadiapdf-handoff";

/** Enregistre un fichier pour le transferer vers la prochaine page (routage
 * intelligent depuis l'accueil). Utilise IndexedDB plutot que sessionStorage :
 * un fichier peut depasser largement le quota de sessionStorage (quelques Mo),
 * IndexedDB accepte des blobs bien plus volumineux. */
function savePendingFile(file) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { resolve(); return; }
    const req = indexedDB.open(PENDING_FILE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(file, "pending");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

/** Recupere (et efface, usage unique) le fichier en attente de transfert, le
 * cas echeant. Ne echoue jamais silencieusement : resout `null` si rien
 * n'est en attente ou si IndexedDB n'est pas disponible. */
function consumePendingFile() {
  return new Promise((resolve) => {
    if (!window.indexedDB) { resolve(null); return; }
    const req = indexedDB.open(PENDING_FILE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("files", "readwrite");
      const store = tx.objectStore("files");
      const getReq = store.get("pending");
      getReq.onsuccess = () => {
        const file = getReq.result || null;
        store.delete("pending");
        tx.oncomplete = () => { db.close(); resolve(file); };
      };
      getReq.onerror = () => { db.close(); resolve(null); };
    };
    req.onerror = () => resolve(null);
  });
}

/** Affiche la barre de progression (0 à 100) avec un texte et le pourcentage. */
function setProgress(pct, label) {
  const wrap = document.getElementById("progress");
  wrap.classList.add("visible");
  const bar = wrap.querySelector(".progress-bar");
  const fill = wrap.querySelector(".progress-bar > div");
  const labelEl = wrap.querySelector(".progress-label");
  const value = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  fill.style.width = value + "%";
  if (bar) {
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(value));
  }
  if (labelEl) {
    if (!labelEl.id) labelEl.id = "progress-libelle";
    if (bar) bar.setAttribute("aria-labelledby", labelEl.id);
    labelEl.setAttribute("aria-live", "polite");
    let pctEl = labelEl.querySelector(".progress-pct");
    if (label) {
      labelEl.textContent = label;
      pctEl = null;
    }
    if (!pctEl) {
      pctEl = document.createElement("span");
      pctEl.className = "progress-pct";
      labelEl.appendChild(pctEl);
    }
    pctEl.textContent = value + " %";
  }
}
function hideProgress() {
  document.getElementById("progress").classList.remove("visible");
}

const MSG_ICONS = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.01"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 16.5H2.5z"/><path d="M12 10v4"/><path d="M12 17v.01"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>',
};

/** Prepare la zone #msg : icone (info / avertissement / erreur), corps,
 * attributs ARIA. Retourne l'element de corps dans lequel ecrire. Jamais de
 * couleur dediee : seuls l'icone, le texte et l'epaisseur du trait changent. */
function prepareMsg(kind) {
  const el = document.getElementById("msg");
  el.innerHTML = "";
  el.classList.remove("msg-info", "msg-warn", "msg-error");
  el.classList.add("msg-" + kind);
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  const icon = document.createElement("span");
  icon.className = "msg-icon";
  icon.innerHTML = MSG_ICONS[kind] || MSG_ICONS.info; // SVG statique du site, jamais de contenu utilisateur
  const body = document.createElement("div");
  body.className = "msg-body";
  el.appendChild(icon);
  el.appendChild(body);
  el.classList.add("visible");
  return body;
}

/** Affiche un message d'information (texte simple). */
function showMsg(text) {
  const body = prepareMsg("info");
  const p = document.createElement("p");
  p.textContent = text;
  body.appendChild(p);
}
/** Affiche un avertissement (le traitement reste possible, mais attention). */
function showWarning(text) {
  const body = prepareMsg("warn");
  const p = document.createElement("p");
  p.textContent = text;
  body.appendChild(p);
}
function hideMsg() {
  const el = document.getElementById("msg");
  if (el) el.classList.remove("visible");
}

/**
 * Composant d'erreur uniforme : message clair, bouton "Réessayer" optionnel
 * (relance l'action fournie) et suggestion d'outil alternatif optionnelle.
 * Réutilise la même zone que showMsg (id "msg"), pour rester cohérent avec
 * le reste du site plutôt que d'ajouter un second emplacement à l'écran.
 *
 * @param {string} text Message d'erreur, clair et en français.
 * @param {{retry?: () => void, suggestionHref?: string, suggestionText?: string}} [options]
 */
function showError(text, options) {
  options = options || {};
  const el = prepareMsg("error");

  const p = document.createElement("p");
  p.textContent = text;
  el.appendChild(p);

  if (options.retry || options.suggestionHref) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    if (options.retry) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary";
      btn.textContent = "Réessayer";
      btn.addEventListener("click", options.retry);
      actions.appendChild(btn);
    }
    if (options.suggestionHref) {
      const a = document.createElement("a");
      a.href = options.suggestionHref;
      a.textContent = options.suggestionText || "Essayer un autre outil";
      actions.appendChild(a);
    }
    el.appendChild(actions);
  }
}

/** Propose le téléchargement d'un fichier généré. */
function offerDownload(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime || "application/pdf" });
  const url = URL.createObjectURL(blob);
  const result = document.getElementById("result");
  const link = result.querySelector("a.btn-primary");
  link.href = url;
  link.download = filename;
  showResultSummary(result, link, filename, blob.size);
  result.setAttribute("role", "status");
  result.setAttribute("aria-live", "polite");
  result.classList.add("visible");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  result.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  showFunLine(result);
  showSupportLine(result);
  link.focus({ preventScroll: true });
}

/**
 * Carte de resultat : resume (nom du fichier, taille) sous le titre, puis
 * action secondaire "Traiter un autre fichier" sous le bouton de
 * telechargement. Idempotent (mode lot : offerDownload appelee plusieurs
 * fois met simplement le resume a jour).
 */
function showResultSummary(result, link, filename, size) {
  let summary = result.querySelector(".result-summary");
  if (!summary) {
    summary = document.createElement("p");
    summary.className = "result-summary";
    link.parentNode.insertBefore(summary, link);
  }
  summary.textContent = filename + " · " + fmtSize(size);

  if (!result.querySelector(".result-actions")) {
    const actions = document.createElement("div");
    actions.className = "result-actions";
    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn-ghost";
    again.textContent = "Traiter un autre fichier";
    again.addEventListener("click", () => window.location.reload());
    actions.appendChild(again);
    link.parentNode.insertBefore(actions, link.nextSibling);
  }
}

const FUN_LINES = [
  "Votre fichier est prêt, il n'a même pas eu le temps de s'ennuyer.",
  "Terminé, plus vite qu'un café qui refroidit.",
  "Et voilà, sans effort... enfin, le vôtre en tout cas.",
  "Mission accomplie, aucun octet n'a été blessé.",
  "C'est prêt, même pas eu besoin de croiser les doigts.",
  "Fait. Votre PDF vous remercie de ne pas l'avoir imprimé pour rien.",
  "Voilà votre fichier, tout frais, tout chaud.",
  "Prêt ! Ça a pris moins de temps qu'à le raconter.",
];

/** Petite phrase legere au succes d'une action, en plus de (jamais a la
 * place de) la ligne de soutien sobre juste en dessous. */
function showFunLine(result) {
  let line = result.querySelector(".fun-line");
  if (!line) {
    line = document.createElement("p");
    line.className = "fun-line";
    result.appendChild(line);
  }
  line.textContent = FUN_LINES[Math.floor(Math.random() * FUN_LINES.length)];
}

const SUPPORT_CLICKED_KEY = "tchadiapdf_support_clicked";

/**
 * Ajoute, sous le bouton de telechargement, une invitation discrete a
 * soutenir le projet (une seule ligne, jamais de popup ni de bandeau
 * bloquant). Idempotent : ne duplique pas la ligne si offerDownload est
 * appelee plusieurs fois (mode lot par exemple).
 */
function showSupportLine(result) {
  let line = result.querySelector(".support-line");
  if (!line) {
    line = document.createElement("p");
    line.className = "support-line";
    result.appendChild(line);
  }
  const alreadySupported = localStorage.getItem(SUPPORT_CLICKED_KEY) === "1";
  if (alreadySupported) {
    line.textContent = "Merci de soutenir tchadiaPdf.";
    return;
  }
  line.textContent = "tchadiaPdf est gratuit et le restera. Si cet outil vous a aidé, vous pouvez ";
  const a = document.createElement("a");
  a.href = "/soutenir";
  a.textContent = "soutenir le projet";
  a.addEventListener("click", () => {
    localStorage.setItem(SUPPORT_CLICKED_KEY, "1");
  });
  line.appendChild(a);
  line.appendChild(document.createTextNode("."));
}

/**
 * Validation uniforme d'un fichier a l'entree d'un outil : type accepte et
 * avertissement (pas de refus) au-dela d'une taille consideree comme lente.
 * Ne remplace pas les verifications specifiques a chaque outil (ex. lecture
 * reelle du PDF pour detecter un mot de passe), seulement le premier filtre
 * commun : extension/MIME et taille.
 *
 * @param {File} file
 * @param {{accept: string[], acceptLabel: string, maxWarnBytes?: number}} rules
 *   accept: extensions minuscules sans le point (ex. ["pdf"]) OU types MIME
 *   complets (ex. ["application/pdf"]) ; acceptLabel : description lisible
 *   pour le message de refus (ex. "un fichier PDF").
 * @returns {{ok: true, warning?: string} | {ok: false, message: string}}
 */
function validateFile(file, rules) {
  const maxWarnBytes = rules.maxWarnBytes || 100 * 1024 * 1024; // 100 Mo par defaut
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();

  const matches = rules.accept.some((rule) => {
    const r = rule.toLowerCase();
    return r.indexOf("/") !== -1 ? type === r : name.endsWith("." + r);
  });

  if (!matches) {
    return { ok: false, message: "Ce fichier n'est pas " + rules.acceptLabel + ". Choisissez un autre fichier." };
  }

  if (file.size > maxWarnBytes) {
    return {
      ok: true,
      warning: "Ce fichier est volumineux (" + fmtSize(file.size) + ") : le traitement reste possible mais peut être lent selon votre appareil.",
    };
  }

  return { ok: true };
}

/** Taille lisible. */
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " o";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " Ko";
  return (bytes / 1048576).toFixed(1) + " Mo";
}

/** Lit un File en ArrayBuffer. */
function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Impossible de lire le fichier " + file.name));
    r.readAsArrayBuffer(file);
  });
}

/** Rend la première page (ou une page donnée) d'un PDF dans un canvas. */
async function renderPdfPage(pdfDoc, pageNum, canvas, maxWidth) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const scale = (maxWidth || 150) / viewport.width;
  const vp = page.getViewport({ scale });
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
}
