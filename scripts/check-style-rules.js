#!/usr/bin/env node
/**
 * Verifie deux regles permanentes du projet tchadiaPdf sur tout le depot :
 *
 *   1. Aucun tiret long (U+2014, "—") ou moyen (U+2013, "–") nulle part
 *      dans les fichiers .html, .js, .css, .md.
 *   2. Aucune couleur hexadecimale hors de la palette autorisee dans les
 *      fichiers .css, ni dans les attributs style="..." ou les blocs
 *      <style>...</style> des fichiers .html.
 *
 * Aucune dependance externe : uniquement fs/path natifs de Node.
 * Code de sortie 1 et message clair (fichier + ligne) en cas de violation,
 * 0 sinon.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// Dossiers ignores lors du parcours recursif.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "tests",
  ".github",
  ".claude",
]);

function relPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

// Fichiers ignores individuellement : ce script doit lui-meme contenir les
// caracteres qu'il recherche (tirets litteraux dans DASH_CHARS) pour pouvoir
// les detecter, ce qui n'est pas une vraie violation du contenu du site.
const IGNORED_FILES = new Set([relPath(__filename)]);

// Extensions concernees par la regle des tirets.
const DASH_EXTENSIONS = new Set([".html", ".js", ".css", ".md"]);

// Extensions concernees par la regle des couleurs.
const COLOR_CHECK_EXTENSIONS = new Set([".css", ".html"]);

// Palette de couleurs autorisee (insensible a la casse), sans le "#".
// 475569 (--slate) remplace l'ancien 64748B (contraste WCAG AA insuffisant
// sur fond blanc, 4.76:1 pour un seuil de 4.5:1) : voir css/style.css.
const ALLOWED_HEX_COLORS = new Set(
  ["2563EB", "1D4ED8", "EFF6FF", "FFFFFF", "FFF", "1E293B", "475569", "E2E8F0"].map((c) =>
    c.toUpperCase()
  )
);

const DASH_CHARS = [
  { char: "—", label: "tiret long (—, U+2014)" },
  { char: "–", label: "tiret moyen (–, U+2013)" },
];

const HEX_COLOR_RE = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

let violations = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      checkFile(path.join(dir, entry.name));
    }
  }
}

function checkFile(filePath) {
  if (IGNORED_FILES.has(relPath(filePath))) return;

  const ext = path.extname(filePath).toLowerCase();
  const checksDash = DASH_EXTENSIONS.has(ext);
  const checksColor = COLOR_CHECK_EXTENSIONS.has(ext);
  if (!checksDash && !checksColor) return;

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return; // fichier binaire ou illisible en UTF-8, on ignore
  }

  const lines = content.split(/\r\n|\r|\n/);

  if (checksDash) {
    lines.forEach((line, i) => {
      // Suppression explicite ligne par ligne (comme eslint-disable-line) :
      // reservee aux cas legitimes ou le caractere litteral est necessaire
      // en donnee (ex: table de conversion qui neutralise justement ces
      // caracteres avant de les inserer dans un PDF), jamais pour du texte
      // utilisateur ou un simple oubli.
      if (line.includes("style-check-ignore-line")) return;
      for (const { char, label } of DASH_CHARS) {
        if (line.includes(char)) {
          violations.push({
            file: relPath(filePath),
            line: i + 1,
            message: `${label} trouve : "${line.trim().slice(0, 100)}"`,
          });
        }
      }
    });
  }

  if (checksColor) {
    if (ext === ".css") {
      lines.forEach((line, i) => checkColorsInLine(line, i + 1, filePath));
    } else if (ext === ".html") {
      checkColorsInHtml(content, lines, filePath);
    }
  }
}

/** Verifie les couleurs hexadecimales d'une ligne de CSS pur. */
function checkColorsInLine(line, lineNumber, filePath) {
  let match;
  HEX_COLOR_RE.lastIndex = 0;
  while ((match = HEX_COLOR_RE.exec(line)) !== null) {
    const hex = match[1].toUpperCase();
    if (!ALLOWED_HEX_COLORS.has(hex)) {
      violations.push({
        file: relPath(filePath),
        line: lineNumber,
        message: `couleur hors palette "#${match[1]}" trouvee : "${line.trim().slice(0, 100)}"`,
      });
    }
  }
}

/**
 * Verifie les couleurs hexadecimales dans un fichier HTML, mais uniquement
 * a l'interieur des blocs <style>...</style> et des attributs style="...".
 * Les couleurs SVG comme fill="none" ou stroke="currentColor" ne sont pas
 * des couleurs hexadecimales et ne sont donc jamais concernees par le motif
 * de recherche (#[0-9a-fA-F]{3,6}) : elles sont naturellement ignorees.
 */
function checkColorsInHtml(content, lines, filePath) {
  // 1. Blocs <style>...</style> : on verifie ligne par ligne en se limitant
  //    aux lignes situees a l'interieur d'un tel bloc.
  let inStyleBlock = false;
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    if (!inStyleBlock && lower.includes("<style")) {
      inStyleBlock = true;
      // Si la balise se ferme sur la meme ligne (rare), on verifie quand meme la ligne.
    }
    if (inStyleBlock) {
      checkColorsInLine(line, i + 1, filePath);
    }
    if (inStyleBlock && lower.includes("</style>")) {
      inStyleBlock = false;
    }
  });

  // 2. Attributs style="..." : recherche independante des lignes, avec
  //    calcul du numero de ligne a partir de l'offset trouve.
  const styleAttrRe = /style\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = styleAttrRe.exec(content)) !== null) {
    const attrValue = match[1];
    let colorMatch;
    HEX_COLOR_RE.lastIndex = 0;
    while ((colorMatch = HEX_COLOR_RE.exec(attrValue)) !== null) {
      const hex = colorMatch[1].toUpperCase();
      if (!ALLOWED_HEX_COLORS.has(hex)) {
        const lineNumber = content.slice(0, match.index).split(/\r\n|\r|\n/).length;
        violations.push({
          file: relPath(filePath),
          line: lineNumber,
          message: `couleur hors palette "#${colorMatch[1]}" trouvee dans un attribut style="..."`,
        });
      }
    }
  }
}

walk(ROOT);

if (violations.length > 0) {
  console.error(`\n${violations.length} violation(s) des regles de style trouvee(s) :\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} : ${v.message}`);
  }
  console.error("");
  process.exit(1);
} else {
  console.log("check-style-rules : aucune violation trouvee (tirets et palette de couleurs).");
  process.exit(0);
}
