/* tchadiaPdf : moteur qpdf (WebAssembly), chargement paresseux et partagé
 *
 * qpdf (licence Apache 2.0, compilé en WASM par le wrapper ISC
 * @neslinesli93/qpdf-wasm) fournit un traitement PDF de qualité
 * professionnelle : chiffrement AES-256 réel, réparation de fichiers
 * corrompus, linéarisation. Le module (~1,3 Mo) n'est téléchargé qu'au
 * premier besoin réel (jamais au chargement de la page), avec une
 * progression de téléchargement affichée à l'utilisateur, puis mis en
 * cache pour le reste de la session.
 */

const QPDF_JS_URL = "https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js";
const QPDF_WASM_URL = "https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm";

let qpdfInstancePromise = null;
let lastStderr = "";

// qpdf-wasm capture une référence directe à console.error au chargement du
// module : le correctif doit donc être posé une fois pour toutes, ici, et
// non pas seulement autour de chaque appel (une interception plus tardive
// n'aurait aucun effet sur la référence déjà capturée par le module).
const realConsoleError = console.error;
console.error = function () {
  lastStderr += Array.prototype.slice.call(arguments).join(" ") + "\n";
  realConsoleError.apply(console, arguments);
};

/**
 * Télécharge le binaire .wasm en suivant la progression, et le fournit via
 * une URL de blob locale : cela permet d'afficher une vraie barre de
 * progression (ce que l'API du module ne propose pas nativement), tout en
 * ne déclenchant qu'un seul téléchargement réel.
 */
async function fetchWasmWithProgress(onProgress) {
  const resp = await fetch(QPDF_WASM_URL);
  if (!resp.ok || !resp.body) {
    // Repli : pas de suivi de progression possible, mais ça fonctionne quand même.
    return QPDF_WASM_URL;
  }
  const total = parseInt(resp.headers.get("Content-Length") || "0", 10);
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0 && onProgress) onProgress(Math.round((received / total) * 100));
  }
  const blob = new Blob(chunks, { type: "application/wasm" });
  return URL.createObjectURL(blob);
}

/**
 * Charge (une seule fois par session) et renvoie l'instance qpdf-wasm.
 * @param {(pct: number) => void} onProgress appelé pendant le téléchargement du moteur
 */
function loadQpdf(onProgress) {
  if (qpdfInstancePromise) return qpdfInstancePromise;

  qpdfInstancePromise = (async () => {
    const wasmUrl = await fetchWasmWithProgress(onProgress);

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = QPDF_JS_URL;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Impossible de charger le moteur qpdf (problème réseau)."));
      document.head.appendChild(script);
    });

    if (typeof window.Module !== "function") {
      throw new Error("Le moteur qpdf n'a pas pu être initialisé.");
    }
    const instance = await window.Module({
      locateFile: () => wasmUrl,
      print: (text) => { lastStderr += text + "\n"; },
      printErr: (text) => { lastStderr += text + "\n"; },
    });
    return instance;
  })();

  return qpdfInstancePromise;
}

/**
 * Exécute qpdf sur un PDF en mémoire.
 * @param {Uint8Array} inputBytes
 * @param {(inName: string, outName: string) => string[]} buildArgs construit les arguments qpdf
 * @param {(pct: number) => void} [onProgress] progression du téléchargement du moteur (0-100)
 * @returns {Promise<Uint8Array>} le fichier produit par qpdf
 */
async function runQpdf(inputBytes, buildArgs, onProgress) {
  const qpdf = await loadQpdf(onProgress);

  const inName = "/entree-" + Date.now() + ".pdf";
  const outName = "/sortie-" + Date.now() + ".pdf";
  qpdf.FS.writeFile(inName, inputBytes);
  lastStderr = "";

  const args = buildArgs(inName, outName);
  let code;
  try {
    code = qpdf.callMain(args);
  } catch (e) {
    throw new Error("qpdf a rencontré une erreur : " + (e && e.message ? e.message : "erreur inconnue") + ".");
  }

  let outBytes;
  try {
    outBytes = qpdf.FS.readFile(outName);
  } catch (e) {
    const err = new Error("qpdf n'a pas pu produire de fichier de sortie (code " + code + ").");
    err.qpdfStderr = lastStderr;
    err.qpdfCode = code;
    throw err;
  } finally {
    try { qpdf.FS.unlink(inName); } catch (_) { /* ignore */ }
    try { qpdf.FS.unlink(outName); } catch (_) { /* ignore */ }
  }

  // qpdf renvoie parfois un code non nul pour de simples avertissements
  // (ex. PDF légèrement non conforme mais réparé avec succès) : on ne
  // traite comme une erreur que l'absence de fichier de sortie exploitable.
  return outBytes;
}

window.QpdfEngine = { runQpdf };
