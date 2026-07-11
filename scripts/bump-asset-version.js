#!/usr/bin/env node
/**
 * Incremente le suffixe de version (?v=N) utilise sur toutes les references
 * locales a css/style.css et aux fichiers js/*.js dans les pages HTML, ainsi
 * que dans la liste APP_SHELL et le CACHE_NAME de sw.js.
 *
 * Pourquoi : _headers force un cache navigateur tres long et immuable sur
 * /css/* et /js/* (Cache-Control: immutable, max-age=1 an). Le site n'a pas
 * d'etape de build ni de nom de fichier avec hash de contenu ; le seul moyen
 * de garantir qu'un visiteur ayant deja mis un de ces fichiers en cache
 * recoive la derniere version est de changer l'URL elle-meme. Voir DEPLOY.md,
 * section "Mettre a jour css/style.css ou un fichier js/*.js".
 *
 * A executer manuellement des qu'on modifie css/style.css ou n'importe quel
 * fichier js/*.js, avant de committer :
 *
 *   node scripts/bump-asset-version.js
 *
 * Aucune dependance externe : uniquement fs/path natifs de Node.
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

const CSS_REF_RE = /href="((?:\.\.\/)?css\/style\.css)(\?v=\d+)?"/g;
const JS_REF_RE = /src="((?:\.\.\/)?js\/[A-Za-z0-9_.\-]+\.js)(\?v=\d+)?"/g;

function findCurrentVersion(htmlFiles) {
  let max = 0;
  let found = false;
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, "utf8");
    for (const re of [CSS_REF_RE, JS_REF_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content))) {
        if (m[2]) {
          found = true;
          const n = parseInt(m[2].slice(3), 10);
          if (n > max) max = n;
        }
      }
    }
  }
  return found ? max : 1; // 1 = etat implicite "jamais encore versionne"
}

const htmlFiles = [];
walkHtmlFiles(ROOT, htmlFiles);

const currentVersion = findCurrentVersion(htmlFiles);
const newVersion = currentVersion + 1;

let filesChanged = 0;
let refsChanged = 0;

for (const file of htmlFiles) {
  const before = fs.readFileSync(file, "utf8");
  let after = before.replace(CSS_REF_RE, (m, p1) => {
    refsChanged++;
    return `href="${p1}?v=${newVersion}"`;
  });
  after = after.replace(JS_REF_RE, (m, p1) => {
    refsChanged++;
    return `src="${p1}?v=${newVersion}"`;
  });
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    filesChanged++;
  }
}

// sw.js : CACHE_NAME (tchadiapdf-shell-vN) et les entrees APP_SHELL deja
// versionnees (celles sans suffixe, comme le worker instancie via new
// Worker(...) plutot que par une balise <script>, ne sont pas touchees).
const swPath = path.join(ROOT, "sw.js");
if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, "utf8");
  sw = sw.replace(/tchadiapdf-shell-v\d+/, `tchadiapdf-shell-v${newVersion}`);
  sw = sw.replace(/"(\/(?:css|js)\/[A-Za-z0-9_.\-]+\.(?:css|js))\?v=\d+"/g, (m, p1) => {
    refsChanged++;
    return `"${p1}?v=${newVersion}"`;
  });
  fs.writeFileSync(swPath, sw, "utf8");
}

console.log(`bump-asset-version : v${currentVersion} -> v${newVersion}`);
console.log(`  ${filesChanged} fichier(s) HTML modifie(s), ${refsChanged} reference(s) mises a jour, sw.js synchronise.`);
console.log("  Verifiez le diff, relancez npm run check-style et npm test, puis committez.");
