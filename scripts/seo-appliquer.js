#!/usr/bin/env node
/**
 * Applique les métadonnées SEO du registre data/outils.json aux pages
 * d'outils de tchadiaPdf.
 *
 * Pour chaque outil du registre dont le fichier HTML existe, le script
 * remplace (ou insère) dans le <head> un bloc délimité par les marqueurs
 * <!-- seo:debut --> ... <!-- seo:fin --> contenant :
 *   - <title>, <meta name="description">, <meta name="robots"> explicite
 *   - <link rel="canonical"> sans extension .html
 *   - <link rel="alternate" hreflang="fr"> et hreflang="x-default"
 *     (les pages d'outils n'existent qu'en français : l'auto-référence
 *     dit explicitement aux moteurs que cette URL est la version par défaut)
 *   - les balises Open Graph et Twitter cohérentes avec le titre et la
 *     description (image existante dans docs/og/)
 *   - un JSON-LD @graph : WebApplication (offre gratuite), BreadcrumbList,
 *     FAQPage construit à partir des <details> de <section class="faq">
 *   - une feuille de style minimale pour le bloc « Outils associés »,
 *     basée uniquement sur les variables du design system (à déplacer dans
 *     css/style.css par l'équipe design quand elle le souhaite)
 * et remplit le bloc « Outils associés » (3 à 5 liens à ancres
 * descriptives) au marqueur <!-- outils-associes -->, inséré juste avant
 * <footer si la page ne l'a pas encore.
 *
 * Tout ce qui n'est pas listé ci-dessus est laissé intact, y compris les
 * suffixes ?v= des feuilles de style et des scripts. Les anciennes balises
 * équivalentes présentes hors des marqueurs (title, description, canonical,
 * og:*, twitter:*, ld+json) sont retirées pour éviter les doublons.
 *
 * Idempotent : relançable sans effet si rien n'a changé. Un fichier n'est
 * réécrit que si son contenu diffère.
 *
 *   node scripts/seo-appliquer.js            # toutes les pages d'outils
 *   node scripts/seo-appliquer.js --accueil  # + le JSON-LD de index.html
 *                                            # (Organization, WebSite avec
 *                                            # SearchAction, ItemList)
 *   node scripts/seo-appliquer.js --simuler  # n'écrit rien, liste les écarts
 *
 * Aucune dépendance externe : uniquement fs/path natifs de Node.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRE = JSON.parse(fs.readFileSync(path.join(ROOT, "data/outils.json"), "utf8"));
const SITE = REGISTRE.site.replace(/\/$/, "");
const ORGANISATION_ID = SITE + "/#organization";
const SITE_ID = SITE + "/#website";
const GITHUB = "https://github.com/YOSO98/tchadiaPDF";

const args = new Set(process.argv.slice(2));
const SIMULER = args.has("--simuler");
const ACCUEIL = args.has("--accueil");

const DEBUT = "<!-- seo:debut : bloc généré par scripts/seo-appliquer.js depuis data/outils.json, ne pas modifier à la main -->";
const FIN = "<!-- seo:fin -->";
const MARQUEUR = "<!-- outils-associes -->";
const MARQUEUR_FIN = "<!-- /outils-associes -->";

function echapperAttribut(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function echapperTexte(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decoderEntites(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function texteBrut(html) {
  return decoderEntites(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// JSON-LD : "</" doit être échappé pour qu'un contenu ne puisse pas fermer
// la balise <script> prématurément.
function jsonLd(objet) {
  return JSON.stringify(objet, null, 2).replace(/<\//g, "<\\/");
}

const parSlug = new Map(REGISTRE.outils.map((o) => [o.slug, o]));

function faqDepuisPage(html) {
  const section = html.match(/<section class="faq">([\s\S]*?)<\/section>/);
  if (!section) return [];
  const questions = [];
  for (const m of section[1].matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)) {
    const q = texteBrut(m[1]);
    const r = texteBrut(m[2]);
    if (q && r) questions.push({ question: q, reponse: r });
  }
  return questions;
}

function titreGuide(slugGuide) {
  const fichier = path.join(ROOT, "guides", slugGuide + ".html");
  if (!fs.existsSync(fichier)) return null;
  const h = fs.readFileSync(fichier, "utf8");
  const h1 = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return h1 ? texteBrut(h1[1]) : slugGuide;
}

function graphePourOutil(outil, faq) {
  const categorie = REGISTRE.categories[outil.categorie];
  const filAriane = [{ "@type": "ListItem", position: 1, name: "Accueil", item: SITE + "/" }];
  if (outil.categorie === "convertir") {
    filAriane.push({ "@type": "ListItem", position: 2, name: "Conversions", item: SITE + "/conversions" });
  }
  filAriane.push({ "@type": "ListItem", position: filAriane.length + 1, name: outil.titre_court, item: outil.url });

  const graphe = [
    {
      "@type": "WebApplication",
      "@id": outil.url + "#application",
      name: outil.titre_court,
      alternateName: outil.titre_seo.replace(/\s*:\s*tchadiaPdf\s*$/, ""),
      url: outil.url,
      description: outil.description,
      inLanguage: "fr",
      applicationCategory: "UtilitiesApplication",
      applicationSubCategory: categorie ? categorie.nom : undefined,
      operatingSystem: "Tout système disposant d'un navigateur web récent",
      browserRequirements: "Navigateur web récent avec JavaScript activé ; aucun fichier n'est envoyé sur un serveur",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR", availability: "https://schema.org/InStock" },
      keywords: outil.mots_cles.join(", "),
      license: GITHUB + "/blob/main/LICENSE",
      isPartOf: { "@id": SITE_ID },
      publisher: { "@id": ORGANISATION_ID },
      image: outil.image_og,
    },
    {
      "@type": "BreadcrumbList",
      "@id": outil.url + "#breadcrumb",
      itemListElement: filAriane,
    },
  ];
  if (faq.length > 0) {
    graphe.push({
      "@type": "FAQPage",
      "@id": outil.url + "#faq",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.reponse },
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graphe };
}

// Feuille de style minimale du bloc « Outils associés ». Uniquement des
// variables du design system (aucune couleur hexadécimale), pour rester
// conforme à scripts/check-style-rules.js.
const STYLE_ASSOCIES = `  <style data-seo="outils-associes">
    .related-tools { max-width: 760px; margin: 0 auto; padding: 0 20px 48px; }
    .related-tools h2 { font-size: 1.2rem; margin-bottom: 14px; }
    .related-tools ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .related-tools li { border: 1px solid var(--border); border-radius: var(--radius-btn); padding: 12px 16px; color: var(--slate); }
    .related-tools li a { font-weight: 600; }
    .related-tools .related-guide { background: var(--blue-50); border-color: var(--blue-50); }
  </style>`;

function blocHead(outil, faq) {
  const t = echapperAttribut(outil.titre_seo);
  const d = echapperAttribut(outil.description);
  const lignes = [
    "  " + DEBUT,
    `  <title>${echapperTexte(outil.titre_seo)}</title>`,
    `  <meta name="description" content="${d}">`,
    `  <meta name="robots" content="index, follow, max-image-preview:large">`,
    `  <link rel="canonical" href="${outil.url}">`,
    `  <link rel="alternate" hreflang="fr" href="${outil.url}">`,
    `  <link rel="alternate" hreflang="x-default" href="${outil.url}">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:title" content="${t}">`,
    `  <meta property="og:description" content="${d}">`,
    `  <meta property="og:url" content="${outil.url}">`,
    `  <meta property="og:image" content="${outil.image_og}">`,
    `  <meta property="og:image:alt" content="${echapperAttribut(outil.titre_court + " : tchadiaPdf")}">`,
    `  <meta property="og:locale" content="fr_FR">`,
    `  <meta property="og:site_name" content="tchadiaPdf">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${t}">`,
    `  <meta name="twitter:description" content="${d}">`,
    `  <meta name="twitter:image" content="${outil.image_og}">`,
    `  <script type="application/ld+json">`,
    jsonLd(graphePourOutil(outil, faq)),
    `  </script>`,
    STYLE_ASSOCIES,
    "  " + FIN,
  ];
  return lignes.join("\n");
}

function blocAssocies(outil) {
  const items = [];
  for (const slug of outil.outils_associes) {
    const cible = parSlug.get(slug);
    if (!cible) continue;
    // Un outil pas encore livré (fichier absent) n'est pas lié : pas de lien
    // vers une 404, le lien apparaîtra au prochain passage du script.
    if (!fs.existsSync(path.join(ROOT, cible.fichier))) continue;
    items.push(
      `      <li><a href="/${cible.slug}">${echapperTexte(cible.titre_court)}</a> : ${echapperTexte(cible.accroche)}</li>`
    );
  }
  for (const g of outil.guides || []) {
    const titre = titreGuide(g);
    if (!titre) continue;
    items.push(`      <li class="related-guide">Guide : <a href="/guides/${g}">${echapperTexte(titre)}</a></li>`);
  }
  if (items.length === 0) return "";
  return [
    MARQUEUR,
    `  <nav class="related-tools" aria-labelledby="related-tools-title">`,
    `    <h2 id="related-tools-title">Outils associés</h2>`,
    `    <ul>`,
    ...items,
    `    </ul>`,
    `  </nav>`,
    MARQUEUR_FIN,
  ].join("\n");
}

// Retire du <head> les balises que le bloc géré remplace, où qu'elles soient.
function nettoyerHead(head) {
  let h = head;
  // Ancien bloc géré complet.
  h = h.replace(new RegExp("[ \\t]*<!-- seo:debut[^>]*-->[\\s\\S]*?<!-- seo:fin -->\\n?", "g"), "");
  const motifs = [
    /[ \t]*<title>[\s\S]*?<\/title>\n?/g,
    /[ \t]*<meta\s+name="description"[^>]*>\n?/g,
    /[ \t]*<meta\s+name="robots"[^>]*>\n?/g,
    /[ \t]*<link\s+rel="canonical"[^>]*>\n?/g,
    /[ \t]*<link\s+rel="alternate"\s+hreflang=[^>]*>\n?/g,
    /[ \t]*<meta\s+property="og:[^"]*"[^>]*>\n?/g,
    /[ \t]*<meta\s+name="twitter:[^"]*"[^>]*>\n?/g,
    /[ \t]*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\n?/g,
    /[ \t]*<style data-seo="outils-associes">[\s\S]*?<\/style>\n?/g,
  ];
  for (const m of motifs) h = h.replace(m, "");
  return h;
}

function appliquerHead(html, bloc) {
  const debut = html.indexOf("<head>");
  const fin = html.indexOf("</head>");
  if (debut < 0 || fin < 0) throw new Error("balise <head> introuvable");
  const head = nettoyerHead(html.slice(debut + "<head>".length, fin));
  // Insertion après la balise viewport (ou charset), pour que le titre et
  // la description restent en tout début de <head>.
  const ancre = head.match(/[ \t]*<meta\s+name="viewport"[^>]*>\n?/) || head.match(/[ \t]*<meta\s+charset[^>]*>\n?/);
  let nouveauHead;
  if (ancre) {
    const pos = ancre.index + ancre[0].length;
    nouveauHead = head.slice(0, pos) + bloc + "\n" + head.slice(pos);
  } else {
    nouveauHead = "\n" + bloc + "\n" + head;
  }
  return html.slice(0, debut + "<head>".length) + nouveauHead + html.slice(fin);
}

function retirerBlocsAssociesSupplementaires(html) {
  // Un seul bloc par page : si le gabarit (dans <main>) et une ancienne
  // insertion avant <footer> coexistent, seul le premier est conserve.
  const premier = html.indexOf(MARQUEUR);
  if (premier < 0) return html;
  const premierFin = html.indexOf(MARQUEUR_FIN, premier);
  if (premierFin < 0) return html;
  const tete = html.slice(0, premierFin + MARQUEUR_FIN.length);
  let reste = html.slice(premierFin + MARQUEUR_FIN.length);
  const motif = new RegExp("\\n*[ \\t]*" + MARQUEUR.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "[\\s\\S]*?" + MARQUEUR_FIN.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "[ \\t]*\\n?", "g");
  reste = reste.replace(motif, "\n");
  return tete + reste;
}

function appliquerAssocies(html, bloc) {
  html = retirerBlocsAssociesSupplementaires(html);
  const iDebut = html.indexOf(MARQUEUR);
  if (iDebut >= 0) {
    const iFin = html.indexOf(MARQUEUR_FIN, iDebut);
    if (iFin >= 0) {
      return html.slice(0, iDebut) + bloc + html.slice(iFin + MARQUEUR_FIN.length);
    }
    // Marqueur posé par l'équipe design, encore vide : on le remplit.
    return html.slice(0, iDebut) + bloc + html.slice(iDebut + MARQUEUR.length);
  }
  if (!bloc) return html;
  const iFooter = html.search(/^[ \t]*<footer/m);
  if (iFooter < 0) throw new Error("balise <footer introuvable");
  return html.slice(0, iFooter) + bloc + "\n\n" + html.slice(iFooter);
}

function traiterOutil(outil) {
  const fichier = path.join(ROOT, outil.fichier);
  if (!fs.existsSync(fichier)) return { statut: "absent" };
  const avant = fs.readFileSync(fichier, "utf8");
  const faq = faqDepuisPage(avant);
  let apres = appliquerHead(avant, blocHead(outil, faq));
  apres = appliquerAssocies(apres, blocAssocies(outil));
  if (apres === avant) return { statut: "inchangé" };
  if (!SIMULER) fs.writeFileSync(fichier, apres);
  return { statut: "modifié", faq: faq.length };
}

// ---------- Accueil (optionnel : index.html appartient à l'équipe design) ----------

function grapheAccueil(html) {
  const titre = texteBrut((html.match(/<title>([\s\S]*?)<\/title>/) || [, "tchadiaPdf"])[1]);
  const description = decoderEntites((html.match(/<meta\s+name="description"\s+content="([^"]*)"/) || [, ""])[1]);
  const outilsPresents = REGISTRE.outils.filter((o) => fs.existsSync(path.join(ROOT, o.fichier)));
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANISATION_ID,
        name: "tchadiaPdf",
        url: SITE + "/",
        logo: { "@type": "ImageObject", url: SITE + "/assets/icons/icon-512.png", width: 512, height: 512 },
        email: "contact@tchadiapdf.com",
        sameAs: [GITHUB],
        description:
          "Boîte à outils PDF gratuite et open source (licence MIT). Tout le traitement s'exécute dans le navigateur : aucun fichier n'est envoyé sur un serveur.",
      },
      {
        "@type": "WebSite",
        "@id": SITE_ID,
        name: "tchadiaPdf",
        url: SITE + "/",
        inLanguage: ["fr", "en", "es", "pt", "ar"],
        publisher: { "@id": ORGANISATION_ID },
        license: GITHUB + "/blob/main/LICENSE",
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: SITE + "/?q={search_term_string}" },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "WebPage",
        "@id": SITE + "/#webpage",
        url: SITE + "/",
        name: titre,
        description,
        inLanguage: "fr",
        isPartOf: { "@id": SITE_ID },
        about: { "@id": ORGANISATION_ID },
      },
      {
        "@type": "ItemList",
        "@id": SITE + "/#outils",
        name: "Outils PDF de tchadiaPdf",
        numberOfItems: outilsPresents.length,
        itemListElement: outilsPresents.map((o, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: o.titre_court,
          url: o.url,
        })),
      },
    ],
  };
}

function traiterAccueil() {
  const fichier = path.join(ROOT, "index.html");
  const avant = fs.readFileSync(fichier, "utf8");
  const bloc = `  <script type="application/ld+json">\n${jsonLd(grapheAccueil(avant))}\n  </script>`;
  const motif = /[ \t]*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/;
  let apres;
  if (motif.test(avant)) {
    apres = avant.replace(motif, bloc);
  } else {
    apres = avant.replace("</head>", bloc + "\n</head>");
  }
  if (apres === avant) return { statut: "inchangé" };
  if (!SIMULER) fs.writeFileSync(fichier, apres);
  return { statut: "modifié" };
}

// ---------- Exécution ----------

const bilan = { modifié: [], inchangé: [], absent: [] };
for (const outil of REGISTRE.outils) {
  const r = traiterOutil(outil);
  bilan[r.statut].push(outil.slug);
}
if (ACCUEIL) {
  const r = traiterAccueil();
  bilan[r.statut].push("index");
}

const prefixe = SIMULER ? "[simulation] " : "";
console.log(`${prefixe}${bilan.modifié.length} page(s) modifiée(s)${bilan.modifié.length ? " : " + bilan.modifié.join(", ") : ""}`);
console.log(`${prefixe}${bilan.inchangé.length} page(s) déjà à jour`);
if (bilan.absent.length) {
  console.log(`${bilan.absent.length} outil(s) du registre sans fichier HTML (ignorés) : ${bilan.absent.join(", ")}`);
}
if (!ACCUEIL) {
  console.log("index.html non touché (ajouter --accueil pour y écrire le JSON-LD Organization + WebSite + ItemList).");
}
