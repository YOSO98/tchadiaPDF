#!/usr/bin/env node
/**
 * Verifie que toutes les references locales a un fichier css/*.css ou
 * js/*.js, dans toutes les pages HTML (et dans sw.js), portent exactement
 * le hash de CONTENU actuel de ce fichier (?v=<hash SHA-256, 8 caracteres>,
 * genere par scripts/version-assets.js).
 *
 * Sert de garde-fou CI contre un oubli de `npm run version-assets` apres
 * modification d'un fichier css/js (voir DEPLOY.md) : si une seule page
 * portait encore l'ancien hash, ses visiteurs avec un cache navigateur
 * perime (Cache-Control: immutable, max-age=1 an sur /css/* et /js/* dans
 * _headers) recevraient une ancienne version de ce fichier.
 *
 * Contrairement a l'ancienne version de ce script (schema de version
 * globale ?v=N partagee par tous les fichiers), l'invariant verifie ici est
 * PAR FICHIER : deux fichiers differents ont legitimement des hash
 * differents, seul compte le fait que chaque reference corresponde bien au
 * fichier qu'elle designe.
 *
 * N'echoue PAS si aucune reference n'est versionnee du tout (etat qui
 * precede le tout premier passage de version-assets.js).
 *
 * Aucune dependance externe : uniquement fs/path/crypto natifs de Node.
 * Code de sortie 1 et message clair en cas d'incoherence, 0 sinon.
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

function relPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

// ---------- Hash reel actuel de chaque fichier css/js ----------
const cssFiles = [];
walk(path.join(ROOT, "css"), (n) => n.endsWith(".css"), cssFiles);
const jsFiles = [];
walk(path.join(ROOT, "js"), (n) => n.endsWith(".js") && n !== "compresser-pdf.worker.js", jsFiles);

const hashByRelPath = new Map();
for (const abs of [...cssFiles, ...jsFiles]) {
  hashByRelPath.set(relPath(abs), shortHash(fs.readFileSync(abs)));
}
const buildHash = shortHash(
  Buffer.from(
    Array.from(hashByRelPath.keys())
      .sort()
      .map((k) => k + ":" + hashByRelPath.get(k))
      .join("\n")
  )
);

// ---------- Collecte de toutes les references dans le HTML ----------
const htmlFiles = [];
walk(ROOT, (n) => n.toLowerCase().endsWith(".html"), htmlFiles);

const REF_RE = /(?:href|src)="((?:\.\.\/)*(?:css|js)\/[A-Za-z0-9_.\-]+\.(?:css|js))(\?v=([0-9a-fA-F]+))?"/g;

let anyVersionedRefSeen = false;
const staleRefs = []; // hash present mais ne correspond pas au contenu actuel
const unversionedRefs = []; // aucun ?v= du tout
const unknownFileRefs = []; // reference a un fichier absent du disque (lien casse, hors perimetre ici)

for (const file of htmlFiles) {
  const content = fs.readFileSync(file, "utf8");
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(content))) {
    const refPath = m[1];
    const suffix = m[2];
    const seenHash = m[3];
    const normalized = refPath.replace(/^(\.\.\/)+/, "");
    const realHash = hashByRelPath.get(normalized);
    if (!realHash) { unknownFileRefs.push({ file: relPath(file), ref: refPath }); continue; }
    if (!suffix) { unversionedRefs.push({ file: relPath(file), ref: refPath }); continue; }
    anyVersionedRefSeen = true;
    if (seenHash !== realHash) {
      staleRefs.push({ file: relPath(file), ref: refPath, seenHash, realHash });
    }
  }
}

// ---------- CACHE_NAME de sw.js ----------
let swMismatch = null;
const swPath = path.join(ROOT, "sw.js");
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, "utf8");
  const cacheNameMatch = sw.match(/tchadiapdf-shell-v([0-9a-fA-F]+)/);
  if (cacheNameMatch && cacheNameMatch[1] !== buildHash) {
    swMismatch = { seen: cacheNameMatch[1], expected: buildHash };
  }
}

if (!anyVersionedRefSeen && staleRefs.length === 0) {
  console.log("check-asset-version-consistency : aucune reference versionnee trouvee, rien a verifier.");
  process.exit(0);
}

let hasError = false;

if (staleRefs.length > 0) {
  hasError = true;
  console.error(`\n${staleRefs.length} reference(s) avec un hash perime (le fichier a change depuis) :\n`);
  staleRefs.slice(0, 10).forEach((r) => console.error(`  ${r.file} -> ${r.ref}?v=${r.seenHash} (attendu : ?v=${r.realHash})`));
  if (staleRefs.length > 10) console.error(`  ... et ${staleRefs.length - 10} autre(s)`);
}

if (unversionedRefs.length > 0) {
  hasError = true;
  console.error(`\n${unversionedRefs.length} reference(s) locale(s) sans suffixe ?v= alors que d'autres en ont un :\n`);
  unversionedRefs.slice(0, 10).forEach((r) => console.error(`  ${r.file} -> ${r.ref}`));
  if (unversionedRefs.length > 10) console.error(`  ... et ${unversionedRefs.length - 10} autre(s)`);
}

if (swMismatch) {
  hasError = true;
  console.error(`\nCACHE_NAME de sw.js perime : tchadiapdf-shell-v${swMismatch.seen} (attendu : v${swMismatch.expected})\n`);
}

if (hasError) {
  console.error("\nLancez npm run version-assets pour resynchroniser, puis committez.\n");
  process.exit(1);
} else {
  console.log(`check-asset-version-consistency : coherent, ${hashByRelPath.size} fichier(s) css/js a jour (build v${buildHash}).`);
  process.exit(0);
}
