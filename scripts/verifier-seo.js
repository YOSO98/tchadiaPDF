#!/usr/bin/env node
/**
 * Vérification SEO de toutes les pages indexables du dépôt (racine, guides/,
 * dossiers de langue). Code de sortie 1 et liste des erreurs si une page
 * indexable :
 *   - n'a pas de <link rel="canonical"> absolu, sans extension .html,
 *     cohérent avec son emplacement ;
 *   - n'a pas de <meta name="description"> entre 70 et 160 caractères ;
 *   - n'a pas exactement un <h1> ;
 *   - n'a pas de <title> ;
 *   - contient un bloc JSON-LD non parsable ;
 *   - (pages d'outils du registre) n'a pas de JSON-LD, pas de bloc
 *     « Outils associés », ou un titre/une description différents du
 *     registre data/outils.json (le registre est la source de vérité) ;
 * ou si une URL de sitemap.xml ne correspond à aucun fichier, ou si une
 * page indexable manque dans sitemap.xml.
 *
 * Les avertissements (titre > 65 caractères, Open Graph absent, lien
 * interne cassé, page sans lien entrant) sont affichés mais ne font pas
 * échouer le script.
 *
 * Pages exclues (non indexables par choix) : 404.html (noindex),
 * offline.html (page de repli du service worker).
 *
 *   node scripts/verifier-seo.js
 *
 * Aucune dépendance externe : uniquement fs/path natifs de Node.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRE = JSON.parse(fs.readFileSync(path.join(ROOT, "data/outils.json"), "utf8"));
const SITE = REGISTRE.site.replace(/\/$/, "");
const LANGUES = ["en", "es", "pt", "ar"];
const EXCLUES = new Set(["404.html", "offline.html"]);

const erreurs = [];
const avertissements = [];

function lister() {
  const pages = [];
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith(".html") && !EXCLUES.has(f)) pages.push(f);
  if (fs.existsSync(path.join(ROOT, "guides"))) {
    for (const f of fs.readdirSync(path.join(ROOT, "guides"))) if (f.endsWith(".html")) pages.push("guides/" + f);
  }
  for (const l of LANGUES) {
    if (!fs.existsSync(path.join(ROOT, l))) continue;
    for (const f of fs.readdirSync(path.join(ROOT, l))) if (f.endsWith(".html")) pages.push(l + "/" + f);
  }
  return pages.sort();
}

// URL canonique attendue pour un fichier : index.html -> dossier/, sinon
// chemin sans .html.
function urlAttendue(fichier) {
  const sansExt = fichier.replace(/\.html$/, "");
  if (sansExt === "index") return SITE + "/";
  if (sansExt.endsWith("/index")) return SITE + "/" + sansExt.slice(0, -"index".length);
  return SITE + "/" + sansExt;
}

function fichierPourUrl(url) {
  if (!url.startsWith(SITE)) return null;
  let chemin = url.slice(SITE.length).split("#")[0].split("?")[0];
  if (chemin === "" || chemin === "/") return "index.html";
  if (chemin.endsWith("/")) return chemin.slice(1) + "index.html";
  chemin = chemin.slice(1);
  if (chemin.endsWith(".html")) return chemin;
  return chemin + ".html";
}

function decoder(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

const parFichier = new Map(REGISTRE.outils.map((o) => [o.fichier, o]));
const liensEntrants = new Map();
const pages = lister();

for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  const ou = (msg) => erreurs.push(`${page} : ${msg}`);
  const avert = (msg) => avertissements.push(`${page} : ${msg}`);

  // Titre
  const titre = html.match(/<title>([\s\S]*?)<\/title>/g) || [];
  if (titre.length !== 1) ou(`${titre.length} balise(s) <title> (1 attendue)`);
  else {
    const t = decoder(titre[0].replace(/<\/?title>/g, "")).trim();
    if (t.length > 65) avert(`titre de ${t.length} caractères (65 max conseillé)`);
  }

  // Description
  const descs = [...html.matchAll(/<meta\s+name="description"\s+content="([^"]*)"/g)];
  if (descs.length !== 1) ou(`${descs.length} meta description (1 attendue)`);
  else {
    const d = decoder(descs[0][1]);
    if (d.length < 70 || d.length > 160) ou(`description de ${d.length} caractères (70 à 160 attendus)`);
  }

  // Canonical
  const canon = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]*)"/g)];
  if (canon.length !== 1) ou(`${canon.length} balise canonical (1 attendue)`);
  else {
    const c = canon[0][1];
    if (!c.startsWith("https://")) ou(`canonical non absolue : ${c}`);
    if (/\.html(\?|#|$)/.test(c)) ou(`canonical avec extension .html : ${c}`);
    if (c !== urlAttendue(page)) ou(`canonical ${c} différente de l'URL attendue ${urlAttendue(page)}`);
  }

  // H1 unique
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) ou(`${h1} balise(s) <h1> (1 attendue)`);

  // JSON-LD parsable
  const blocs = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const b of blocs) {
    try {
      const j = JSON.parse(b[1]);
      if (!j["@context"]) ou("JSON-LD sans @context");
    } catch (e) {
      ou(`JSON-LD non parsable : ${e.message}`);
    }
  }

  // Open Graph (avertissement)
  if (!/property="og:title"/.test(html)) avert("balises Open Graph absentes");

  // Tirets interdits
  if (/[–—]/.test(html)) ou("tiret cadratin ou demi-cadratin présent");

  // Pages d'outils : cohérence avec le registre
  const outil = parFichier.get(page);
  if (outil) {
    if (blocs.length === 0) ou("page d'outil sans JSON-LD");
    if (!html.includes("<!-- outils-associes -->") || !/class="related-tools"/.test(html)) {
      ou("bloc « Outils associés » absent (lancer node scripts/seo-appliquer.js)");
    }
    if (titre.length === 1 && decoder(titre[0].replace(/<\/?title>/g, "")).trim() !== outil.titre_seo) {
      ou("titre différent du registre data/outils.json (lancer node scripts/seo-appliquer.js)");
    }
    if (descs.length === 1 && decoder(descs[0][1]) !== outil.description) {
      ou("description différente du registre data/outils.json (lancer node scripts/seo-appliquer.js)");
    }
    if (!/<meta\s+name="robots"/.test(html)) ou("meta robots explicite absente");
  }

  // Liens internes : existence des cibles, et comptage des liens entrants
  for (const m of html.matchAll(/href="([^"#?]+)(?:[#?][^"]*)?"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|javascript:|data:)/.test(href)) {
      if (href.startsWith(SITE)) {
        const cible = fichierPourUrl(href);
        if (cible && cible.endsWith(".html")) {
          if (!fs.existsSync(path.join(ROOT, cible))) avert(`lien interne absolu cassé : ${href}`);
          else liensEntrants.set(cible, (liensEntrants.get(cible) || 0) + (cible === page ? 0 : 1));
        }
      }
      continue;
    }
    let cible;
    if (href.startsWith("/")) cible = href === "/" ? "index.html" : href.endsWith("/") ? href.slice(1) + "index.html" : href.slice(1);
    else cible = path.posix.normalize(path.posix.join(path.posix.dirname(page), href));
    if (/\.(css|js|json|png|ico|svg|webmanifest|woff2?|xml|txt|pdf|wasm|md)$/.test(cible)) continue;
    if (!cible.endsWith(".html")) cible += ".html";
    if (!fs.existsSync(path.join(ROOT, cible))) avert(`lien interne cassé : ${href}`);
    else if (cible !== page) liensEntrants.set(cible, (liensEntrants.get(cible) || 0) + 1);
  }
}

// Pages sans lien entrant (hors accueil, dont les variantes de langue sont
// reliées par hreflang et par le sélecteur de langue en JavaScript).
for (const page of pages) {
  if (page === "index.html" || /^(en|es|pt|ar)\/index\.html$/.test(page)) continue;
  if (!liensEntrants.get(page)) avertissements.push(`${page} : aucun lien interne entrant (page orpheline)`);
}

// Sitemap : toute URL doit exister, toute page indexable doit y figurer.
const sitemapChemin = path.join(ROOT, "sitemap.xml");
if (!fs.existsSync(sitemapChemin)) {
  erreurs.push("sitemap.xml absent (lancer node scripts/generer-sitemap.js)");
} else {
  const sitemap = fs.readFileSync(sitemapChemin, "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const fichiersSitemap = new Set();
  for (const loc of locs) {
    if (/\.html(\?|#|$)/.test(loc)) erreurs.push(`sitemap.xml : URL avec extension .html : ${loc}`);
    const f = fichierPourUrl(loc);
    if (!f || !fs.existsSync(path.join(ROOT, f))) erreurs.push(`sitemap.xml : URL sans fichier correspondant : ${loc}`);
    else fichiersSitemap.add(f);
  }
  for (const page of pages) {
    if (!fichiersSitemap.has(page)) erreurs.push(`sitemap.xml : page indexable absente : ${page} (lancer node scripts/generer-sitemap.js)`);
  }
  const doublons = locs.filter((l, i) => locs.indexOf(l) !== i);
  for (const d of doublons) erreurs.push(`sitemap.xml : URL en double : ${d}`);
}

// robots.txt doit référencer le sitemap.
const robots = path.join(ROOT, "robots.txt");
if (!fs.existsSync(robots) || !fs.readFileSync(robots, "utf8").includes(SITE + "/sitemap.xml")) {
  erreurs.push("robots.txt : ligne Sitemap absente");
}

// ---------- Rapport ----------
console.log(`verifier-seo : ${pages.length} pages indexables analysées.`);
if (avertissements.length) {
  console.log(`\n${avertissements.length} avertissement(s) (non bloquants) :`);
  for (const a of avertissements) console.log("  - " + a);
}
if (erreurs.length) {
  console.error(`\n${erreurs.length} erreur(s) :`);
  for (const e of erreurs) console.error("  - " + e);
  process.exit(1);
}
console.log("\nAucune erreur : canonical, descriptions, H1, JSON-LD et sitemap sont cohérents.");
