#!/usr/bin/env node
/**
 * Régénère sitemap.xml à partir de :
 *   - l'accueil et les pages annexes indexables (liste PAGES_ANNEXES),
 *   - les outils du registre data/outils.json dont le fichier HTML existe
 *     (un outil pas encore livré n'apparaît pas : aucune URL en 404),
 *   - les guides (guides/*.html),
 *   - les versions traduites (ar/, en/, es/, pt/), avec les alternatives
 *     hreflang (xhtml:link) sur chaque URL du groupe.
 *
 * lastmod = date du dernier commit touchant le fichier (git log -1
 * --format=%cs), ou la date du jour si le fichier n'est pas encore commité.
 * Les URL sont canoniques : sans extension .html, dossiers avec barre
 * finale, triées de façon stable. Idempotent : le fichier n'est réécrit que
 * si son contenu change.
 *
 *   node scripts/generer-sitemap.js
 *
 * Aucune dépendance externe : fs/path/child_process natifs de Node.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const REGISTRE = JSON.parse(fs.readFileSync(path.join(ROOT, "data/outils.json"), "utf8"));
const SITE = REGISTRE.site.replace(/\/$/, "");

// Pages annexes indexables de la racine (404.html et offline.html sont
// exclues : noindex et page de repli du service worker).
const PAGES_ANNEXES = [
  "a-propos",
  "confiance",
  "confidentialite",
  "conversions",
  "mentions-legales",
  "pourquoi-gratuit",
  "securite",
  "soutenir",
  "tchadiapdf-vs-adobe-acrobat",
];

const LANGUES = ["en", "es", "pt", "ar"];

function lastmod(fichierRelatif) {
  try {
    const date = execFileSync("git", ["log", "-1", "--format=%cs", "--", fichierRelatif], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  } catch (e) {
    // git absent ou dépôt indisponible : repli sur la date du jour.
  }
  return new Date().toISOString().slice(0, 10);
}

function existe(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// Chaque entrée : { loc, fichier, alternates? : [{ lang, href }] }
const entrees = [];

function ajouter(loc, fichier, alternates) {
  if (!existe(fichier)) return;
  entrees.push({ loc, fichier, alternates });
}

// Groupes traduits : la page racine et ses équivalents dans chaque dossier
// de langue. hreflang x-default pointe vers la version française.
function groupeTraduit(nomRacine, nomFichier) {
  const membres = [{ lang: "fr", href: SITE + "/" + nomRacine, fichier: nomFichier }];
  for (const l of LANGUES) {
    const f = l + "/" + nomFichier;
    if (!existe(f)) continue;
    const loc = nomRacine === "" ? `${SITE}/${l}/` : `${SITE}/${l}/${nomRacine}`;
    membres.push({ lang: l, href: loc, fichier: f });
  }
  if (membres.length < 2) return null;
  const alternates = membres.map((m) => ({ lang: m.lang, href: m.href }));
  alternates.push({ lang: "x-default", href: membres[0].href });
  return { membres, alternates };
}

// Accueil (+ traductions)
const accueil = groupeTraduit("", "index.html");
ajouter(SITE + "/", "index.html", accueil ? accueil.alternates : undefined);

// Pages annexes (+ traductions éventuelles, ex. soutenir)
for (const p of PAGES_ANNEXES) {
  const groupe = groupeTraduit(p, p + ".html");
  ajouter(SITE + "/" + p, p + ".html", groupe ? groupe.alternates : undefined);
}

// Outils du registre
for (const o of REGISTRE.outils) ajouter(o.url, o.fichier);

// Guides
if (existe("guides")) {
  for (const f of fs.readdirSync(path.join(ROOT, "guides")).filter((f) => f.endsWith(".html")).sort()) {
    ajouter(SITE + "/guides/" + f.replace(/\.html$/, ""), "guides/" + f);
  }
}

// Versions traduites (toutes les pages des dossiers de langue)
for (const l of LANGUES) {
  if (!existe(l)) continue;
  for (const f of fs.readdirSync(path.join(ROOT, l)).filter((f) => f.endsWith(".html")).sort()) {
    const nom = f.replace(/\.html$/, "");
    const loc = nom === "index" ? `${SITE}/${l}/` : `${SITE}/${l}/${nom}`;
    const groupe = groupeTraduit(nom === "index" ? "" : nom, f);
    ajouter(loc, l + "/" + f, groupe ? groupe.alternates : undefined);
  }
}

// Tri stable : accueil d'abord, puis ordre alphabétique des URL.
entrees.sort((a, b) => {
  if (a.loc === SITE + "/") return -1;
  if (b.loc === SITE + "/") return 1;
  return a.loc.localeCompare(b.loc, "fr");
});

// Dédoublonnage (sécurité, si une page figure dans deux listes).
const vues = new Set();
const uniques = entrees.filter((e) => (vues.has(e.loc) ? false : (vues.add(e.loc), true)));

function xmlEsc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const lignes = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
];
for (const e of uniques) {
  lignes.push("  <url>");
  lignes.push(`    <loc>${xmlEsc(e.loc)}</loc>`);
  lignes.push(`    <lastmod>${lastmod(e.fichier)}</lastmod>`);
  for (const a of e.alternates || []) {
    lignes.push(`    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${xmlEsc(a.href)}"/>`);
  }
  lignes.push("  </url>");
}
lignes.push("</urlset>");
const contenu = lignes.join("\n") + "\n";

const cible = path.join(ROOT, "sitemap.xml");
const avant = fs.existsSync(cible) ? fs.readFileSync(cible, "utf8") : null;
if (avant === contenu) {
  console.log(`sitemap.xml déjà à jour (${uniques.length} URL).`);
} else {
  fs.writeFileSync(cible, contenu);
  console.log(`sitemap.xml régénéré : ${uniques.length} URL.`);
}
