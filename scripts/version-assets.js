#!/usr/bin/env node
/**
 * Cache-busting par hash de contenu (remplace l'ancien schema de version
 * globale incrementale ?v=N, voir git log pour scripts/bump-asset-version.js).
 *
 * Pour chaque fichier css/*.css et js/*.js, calcule un hash SHA-256 de son
 * CONTENU (8 caracteres hexadecimaux) et met a jour toutes les references
 * locales (href="css/style.css" / src="js/*.js", avec ou sans "../" selon
 * la profondeur de la page) dans TOUTES les pages HTML du depot au format
 * ?v=<hash>. Le hash d'un fichier ne change QUE si son contenu change :
 * contrairement a l'ancien schema, deux fichiers non modifies entre deux
 * executions gardent exactement le meme suffixe, et un seul fichier modifie
 * n'entraine la mise a jour que des pages qui le referencent effectivement.
 *
 * Injecte aussi un hash de build (derive de tous les hashes individuels,
 * ordre stable) dans CACHE_NAME du service worker (sw.js), pour que le nom
 * du cache change automatiquement des qu'un seul fichier css/js change ;
 * voir la documentation en tete de sw.js pour le detail du cycle de vie.
 *
 * Idempotent : reexecutable sans effet si rien n'a change (remplace
 * l'ancien ?v=... par le meme hash), et sans jamais casser une reference
 * existante (ancien schema numerique ?v=N ou hash ?v=xxxxxxxx, les deux
 * formes sont reconnues et remplacees).
 *
 *   npm run version-assets
 *
 * Aucune dependance externe : uniquement fs/path/crypto natifs de Node.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const IGNORED_DIRS = new Set(["node_modules", ".git", "tests", ".github", ".claude", "test-results"]);

function walk(dir, matchFn, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), matchFn, out);
    } else if (entry.isFile() && matchFn(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
}

function shortHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 8);
}

// ---------- 1) Hash de chaque fichier css/*.css et js/*.js ----------
// Cle : chemin relatif a la racine avec des "/" (ex. "css/style.css",
// "js/fusionner.js"), pour matcher les references "css/..." / "js/..." /
// "../css/..." / "../js/..." trouvees dans le HTML quelle que soit la
// profondeur de la page qui les utilise. Exclut le worker instancie via
// new Worker(...) (jamais reference par une balise <script>, voir sw.js).
const cssFiles = [];
walk(path.join(ROOT, "css"), (n) => n.endsWith(".css"), cssFiles);
const jsFiles = [];
walk(path.join(ROOT, "js"), (n) => n.endsWith(".js") && n !== "compresser-pdf.worker.js", jsFiles);

const hashByRelPath = new Map(); // "css/style.css" -> "a1b2c3d4"
for (const abs of [...cssFiles, ...jsFiles]) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  hashByRelPath.set(rel, shortHash(fs.readFileSync(abs)));
}

// Hash de build global (CACHE_NAME du service worker) : derive de tous les
// hashes individuels dans un ordre stable, pour changer des qu'un seul
// fichier css/js change, sans dependre de l'ordre du systeme de fichiers.
const buildHash = shortHash(
  Buffer.from(
    Array.from(hashByRelPath.keys())
      .sort()
      .map((k) => k + ":" + hashByRelPath.get(k))
      .join("\n")
  )
);

// ---------- 2) Reecriture des references dans toutes les pages HTML ----------
const htmlFiles = [];
walk(ROOT, (n) => n.toLowerCase().endsWith(".html"), htmlFiles);

// Capture le prefixe "../" eventuel (profondeur de la page) + le chemin
// css/xxx.css ou js/xxx.js, avec un ancien suffixe ?v=... (numerique ou
// hash) ou aucun suffixe (etat jamais versionne).
const REF_RE = /((?:href|src)=")((?:\.\.\/)*(?:css|js)\/[A-Za-z0-9_.\-]+\.(?:css|js))(\?v=[0-9a-fA-F]+)?(")/g;

let filesChanged = 0;
let refsChanged = 0;
let refsSkippedNoHash = 0;

for (const file of htmlFiles) {
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(REF_RE, (m, pre, refPath, oldSuffix, post) => {
    // Normalise le chemin relatif ("../../css/style.css" -> "css/style.css")
    // pour retrouver le hash calcule a l'etape 1, independamment du nombre
    // de "../" (qui reflete juste la profondeur de la page courante).
    const normalized = refPath.replace(/^(\.\.\/)+/, "");
    const hash = hashByRelPath.get(normalized);
    if (!hash) { refsSkippedNoHash++; return m; } // fichier introuvable sur disque : laisse tel quel
    const next = pre + refPath + "?v=" + hash + post;
    if (next !== m) refsChanged++;
    return next;
  });
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    filesChanged++;
  }
}

// ---------- 3) Synchronisation de sw.js ----------
const swPath = path.join(ROOT, "sw.js");
if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, "utf8");
  sw = sw.replace(/tchadiapdf-shell-v[0-9a-fA-F]+/, `tchadiapdf-shell-v${buildHash}`);
  sw = sw.replace(
    /"(\/?(?:\.\.\/)*(?:css|js)\/[A-Za-z0-9_.\-]+\.(?:css|js))(\?v=[0-9a-fA-F]+)?"/g,
    (m, refPath, oldSuffix) => {
      const normalized = refPath.replace(/^\//, "").replace(/^(\.\.\/)+/, "");
      const hash = hashByRelPath.get(normalized);
      if (!hash) return m;
      const next = `"${refPath}?v=${hash}"`;
      if (next !== m) refsChanged++;
      return next;
    }
  );
  fs.writeFileSync(swPath, sw, "utf8");
}

console.log(`version-assets : ${cssFiles.length + jsFiles.length} fichier(s) css/js hashe(s), build v${buildHash}.`);
console.log(`  ${filesChanged} page(s) HTML modifiee(s), ${refsChanged} reference(s) mises a jour.`);
if (refsSkippedNoHash > 0) {
  console.log(`  ${refsSkippedNoHash} reference(s) ignoree(s) (fichier introuvable sur disque, verifiez les liens casses).`);
}
console.log("  Verifiez le diff, relancez npm run check-style et npm test, puis committez.");
