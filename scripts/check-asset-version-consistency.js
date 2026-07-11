#!/usr/bin/env node
/**
 * Verifie que toutes les references locales a css/style.css et aux fichiers
 * js/*.js, dans toutes les pages HTML, utilisent exactement le meme suffixe
 * ?v=N. Sert de garde-fou CI contre un bump partiel (scripts/bump-asset-
 * version.js pas relance sur toutes les pages, edition manuelle oubliee sur
 * une page, etc.) : si une seule page etait en retard, ses visiteurs avec un
 * cache navigateur perime (Cache-Control: immutable, max-age=1 an sur
 * /css/* et /js/* dans _headers) recevraient une ancienne version.
 *
 * N'echoue PAS si aucune reference n'est versionnee du tout (etat qui
 * precede le premier bump) : ce n'est une violation que s'il existe deja au
 * moins un ?v= quelque part et qu'une autre reference locale ne le partage
 * pas.
 *
 * Aucune dependance externe : uniquement fs/path natifs de Node.
 * Code de sortie 1 et message clair en cas d'incoherence, 0 sinon.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const IGNORED_DIRS = new Set(["node_modules", ".git", "tests", ".github", ".claude"]);

function walkHtmlFiles(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkHtmlFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      out.push(path.join(dir, entry.name));
    }
  }
}

function relPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

const CSS_REF_RE = /href="((?:\.\.\/)?css\/style\.css)(\?v=(\d+))?"/g;
const JS_REF_RE = /src="((?:\.\.\/)?js\/[A-Za-z0-9_.\-]+\.js)(\?v=(\d+))?"/g;

const htmlFiles = [];
walkHtmlFiles(ROOT, htmlFiles);

const versionsSeen = new Map(); // version (string) -> [{file, ref}]
const unversionedRefs = []; // references locales sans aucun ?v=

for (const file of htmlFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const re of [CSS_REF_RE, JS_REF_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const ref = m[1];
      const version = m[3];
      if (version) {
        if (!versionsSeen.has(version)) versionsSeen.set(version, []);
        versionsSeen.get(version).push({ file: relPath(file), ref });
      } else {
        unversionedRefs.push({ file: relPath(file), ref });
      }
    }
  }
}

const distinctVersions = Array.from(versionsSeen.keys());

if (distinctVersions.length === 0) {
  console.log("check-asset-version-consistency : aucune reference versionnee trouvee, rien a verifier.");
  process.exit(0);
}

let hasError = false;

if (distinctVersions.length > 1) {
  hasError = true;
  console.error(`\n${distinctVersions.length} suffixes de version differents trouves (attendu : un seul) :\n`);
  for (const version of distinctVersions) {
    const refs = versionsSeen.get(version);
    console.error(`  ?v=${version} (${refs.length} reference(s)) :`);
    refs.slice(0, 5).forEach((r) => console.error(`    ${r.file} -> ${r.ref}?v=${version}`));
    if (refs.length > 5) console.error(`    ... et ${refs.length - 5} autre(s)`);
  }
}

if (unversionedRefs.length > 0) {
  hasError = true;
  console.error(`\n${unversionedRefs.length} reference(s) locale(s) a css/style.css ou js/*.js sans suffixe ?v= alors que d'autres pages en ont un :\n`);
  unversionedRefs.slice(0, 10).forEach((r) => console.error(`  ${r.file} -> ${r.ref}`));
  if (unversionedRefs.length > 10) console.error(`  ... et ${unversionedRefs.length - 10} autre(s)`);
}

if (hasError) {
  console.error("\nLancez node scripts/bump-asset-version.js pour uniformiser, puis committez.\n");
  process.exit(1);
} else {
  console.log(`check-asset-version-consistency : coherent, toutes les references utilisent ?v=${distinctVersions[0]}.`);
  process.exit(0);
}
