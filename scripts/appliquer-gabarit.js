#!/usr/bin/env node
/**
 * Gabarit transversal de tchadiaPdf : applique a TOUTES les pages HTML
 * (racine, en/, es/, pt/, ar/, guides/) les elements communs du design
 * system v2, sans toucher au corps des pages (que d'autres chantiers
 * modifient en parallele) :
 *
 *   1. <head>  : meta theme-color (si absente) ;
 *   2. <body>  : lien d'evitement "Aller au contenu" en premier element,
 *                et id="contenu" sur <main> s'il n'en a pas ;
 *   3. en-tete : bloc <header class="site-header"> unifie (logo, recherche
 *                d'outil depuis toute page via /?q=, "Tous les outils",
 *                selecteur de langue sur l'accueil et /soutenir, lien GitHub
 *                discret) ;
 *   4. pied    : bloc <footer class="site-footer"> unifie, avec le bloc
 *                "Confidentialite : 0 octet envoye" ;
 *   5. corps   : emplacement vide <!-- outils-associes --> ... <!-- /outils-associes -->
 *                juste avant </main>, que l'equipe SEO remplira.
 *
 * Idempotent : relancable sans effet si deja applique (git diff vide).
 * Ne touche jamais aux balises <script>/<link> ni a leurs suffixes ?v=.
 *
 *   node scripts/appliquer-gabarit.js            # applique
 *   node scripts/appliquer-gabarit.js --check    # code 1 si une page n'est pas a jour (CI)
 *
 * Aucune dependance externe : uniquement fs/path natifs de Node.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHECK_ONLY = process.argv.includes("--check");
const DIRS = ["", "en", "es", "pt", "ar", "guides"];
const GITHUB_URL = "https://github.com/YOSO98/tchadiaPDF";

/* ---------- Textes par langue (tout ce qui est visible dans l'en-tete et le pied) ---------- */
const I18N = {
  fr: {
    skip: "Aller au contenu",
    home: "tchadiaPdf, accueil",
    allTools: "Tous les outils",
    search: "Rechercher un outil",
    github: "Code source sur GitHub",
    lang: "Choisir la langue",
    mainNav: "Navigation principale",
    footerNav: "Pied de page",
    privacyStrong: "Confidentialité : 0 octet envoyé.",
    privacyText: "Vos fichiers sont traités dans votre navigateur et n'en sortent jamais. Aucun compte, aucune limite.",
    about: "À propos",
    trust: "Confiance et sécurité",
    support: "Soutenir le projet",
    privacy: "Confidentialité",
    legal: "Mentions légales",
    manageAds: "Gérer les publicités",
    copyright: "© 2026 tchadiaPdf. Outils PDF gratuits, open source, traitement 100% local.",
  },
  en: {
    skip: "Skip to content",
    home: "tchadiaPdf, home",
    allTools: "All tools",
    search: "Search a tool",
    github: "Source code on GitHub",
    lang: "Choose language",
    mainNav: "Main navigation",
    footerNav: "Footer",
    privacyStrong: "Privacy: 0 bytes sent.",
    privacyText: "Your files are processed in your browser and never leave it. No account, no limits.",
    about: "About",
    trust: "Trust and security",
    support: "Support the project",
    privacy: "Privacy",
    legal: "Legal notice",
    manageAds: "Manage ads",
    copyright: "© 2026 tchadiaPdf. Free PDF tools, open source, 100% local processing.",
  },
  es: {
    skip: "Saltar al contenido",
    home: "tchadiaPdf, inicio",
    allTools: "Todas las herramientas",
    search: "Buscar una herramienta",
    github: "Código fuente en GitHub",
    lang: "Elegir idioma",
    mainNav: "Navegación principal",
    footerNav: "Pie de página",
    privacyStrong: "Privacidad: 0 bytes enviados.",
    privacyText: "Sus archivos se procesan en su navegador y nunca salen de él. Sin cuenta, sin límites.",
    about: "Acerca de",
    trust: "Confianza y seguridad",
    support: "Apoyar el proyecto",
    privacy: "Privacidad",
    legal: "Aviso legal",
    manageAds: "Gestionar anuncios",
    copyright: "© 2026 tchadiaPdf. Herramientas PDF gratuitas, de código abierto, procesamiento 100% local.",
  },
  pt: {
    skip: "Saltar para o conteúdo",
    home: "tchadiaPdf, início",
    allTools: "Todas as ferramentas",
    search: "Pesquisar uma ferramenta",
    github: "Código-fonte no GitHub",
    lang: "Escolher idioma",
    mainNav: "Navegação principal",
    footerNav: "Rodapé",
    privacyStrong: "Privacidade: 0 bytes enviados.",
    privacyText: "Os seus ficheiros são processados no seu navegador e nunca saem dele. Sem conta, sem limites.",
    about: "Sobre",
    trust: "Confiança e segurança",
    support: "Apoiar o projeto",
    privacy: "Privacidade",
    legal: "Aviso legal",
    manageAds: "Gerir anúncios",
    copyright: "© 2026 tchadiaPdf. Ferramentas PDF gratuitas, de código aberto, processamento 100% local.",
  },
  ar: {
    skip: "تخطي إلى المحتوى",
    home: "tchadiaPdf، الصفحة الرئيسية",
    allTools: "جميع الأدوات",
    search: "البحث عن أداة",
    github: "الشفرة المصدرية على GitHub",
    lang: "اختيار اللغة",
    mainNav: "التنقل الرئيسي",
    footerNav: "تذييل الصفحة",
    privacyStrong: "الخصوصية: 0 بايت مُرسَل.",
    privacyText: "تتم معالجة ملفاتك داخل متصفحك ولا تغادره أبدًا. بدون حساب، بدون حدود.",
    about: "حول",
    trust: "الثقة والأمان",
    support: "دعم المشروع",
    privacy: "الخصوصية",
    legal: "الإشعار القانوني",
    manageAds: "إدارة الإعلانات",
    copyright: "© 2026 tchadiaPdf. أدوات PDF مجانية، مفتوحة المصدر، معالجة محلية بنسبة 100%.",
  },
};
const LANG_NAMES = { fr: "Français", en: "English", es: "Español", pt: "Português", ar: "العربية" };
const LANG_ORDER = ["fr", "en", "es", "pt", "ar"];

/* ---------- Icones (SVG statiques, trait 1.8, 24x24) ---------- */
const ICON_SEARCH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
const ICON_GITHUB =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .3C5.37.3 0 5.67 0 12.3c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.41-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22v3.29c0 .32.22.7.83.58C20.57 22.1 24 17.6 24 12.3 24 5.67 18.63.3 12 .3z"/></svg>';
const ICON_LOCK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const ICON_HEART =
  '<svg class="heart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';

/* ---------- Construction des blocs ---------- */
function langPrefix(lang) {
  return lang === "fr" ? "/" : "/" + lang + "/";
}

function buildLangSwitch(lang, kind, t) {
  const options = LANG_ORDER.map((code) => {
    const target = kind === "soutenir" ? (code === "fr" ? "/soutenir" : "/" + code + "/soutenir") : langPrefix(code);
    if (code === lang) return '          <option value="" selected disabled>' + LANG_NAMES[code] + "</option>";
    return '          <option value="' + target + '">' + LANG_NAMES[code] + "</option>";
  });
  return (
    '      <span class="lang-switch">\n' +
    '        <select id="langSwitch" aria-label="' + t.lang + '">\n' +
    options.join("\n") + "\n" +
    "        </select>\n" +
    "      </span>\n"
  );
}

function buildHeader(lang, kind) {
  const t = I18N[lang];
  const home = langPrefix(lang);
  const search =
    kind === "index"
      ? ""
      : '    <form class="header-search" role="search" action="' + home + '" method="get">\n' +
        "      " + ICON_SEARCH + "\n" +
        '      <input type="search" name="q" placeholder="' + t.search + '" aria-label="' + t.search + '" autocomplete="off">\n' +
        "    </form>\n";
  const langSwitch = kind === "index" || kind === "soutenir" ? buildLangSwitch(lang, kind, t) : "";
  return (
    '<header class="site-header">\n' +
    '  <div class="container">\n' +
    '    <a href="' + home + '" class="logo" aria-label="' + t.home + '">tchadia<span>Pdf</span></a>\n' +
    search +
    '    <nav class="nav-tools" aria-label="' + t.mainNav + '">\n' +
    '      <a href="' + (kind === "index" ? "#outils" : home + "#outils") + '">' + t.allTools + "</a>\n" +
    langSwitch +
    '      <a class="github-link" href="' + GITHUB_URL + '" rel="noopener" aria-label="' + t.github + '" title="' + t.github + '">' + ICON_GITHUB + "</a>\n" +
    "    </nav>\n" +
    "  </div>\n" +
    "</header>"
  );
}

function buildFooter(lang, hasConsentScript) {
  const t = I18N[lang];
  const supportHref = lang === "fr" ? "/soutenir" : "/" + lang + "/soutenir";
  const manage = hasConsentScript
    ? '    <button type="button" class="consent-banner-reopen-link">' + t.manageAds + "</button>\n"
    : "";
  return (
    '<footer class="site-footer">\n' +
    '  <div class="container footer-inner">\n' +
    '    <p class="footer-privacy">' + ICON_LOCK + "<span><strong>" + t.privacyStrong + "</strong>" + t.privacyText + "</span></p>\n" +
    '    <nav aria-label="' + t.footerNav + '">\n' +
    '      <a href="/a-propos">' + t.about + "</a>\n" +
    '      <a href="/confiance">' + t.trust + "</a>\n" +
    '      <a href="' + supportHref + '" class="support-link">' + ICON_HEART + t.support + "</a>\n" +
    '      <a href="/confidentialite">' + t.privacy + "</a>\n" +
    '      <a href="/mentions-legales">' + t.legal + "</a>\n" +
    '      <a href="' + GITHUB_URL + '" rel="noopener">GitHub</a>\n' +
    "    </nav>\n" +
    '    <p class="footer-legal">\n' +
    manage +
    "    <span>" + t.copyright + "</span>\n" +
    "    </p>\n" +
    "  </div>\n" +
    "</footer>"
  );
}

/* ---------- Application a une page ---------- */
const HEADER_RE = /<header class="site-header">[\s\S]*?<\/header>/;
const FOOTER_RE = /<footer class="site-footer">[\s\S]*?<\/footer>/;
const MAIN_OPEN_RE = /<main\b([^>]*)>/;

function detectLang(html) {
  const m = html.match(/<html[^>]*\blang="([a-z]{2})/i);
  const lang = m ? m[1].toLowerCase() : "fr";
  return I18N[lang] ? lang : "fr";
}

function detectKind(relPath) {
  const base = path.basename(relPath);
  if (base === "index.html") return "index";
  if (base === "soutenir.html") return "soutenir";
  return "page";
}

function apply(html, relPath) {
  const lang = detectLang(html);
  const kind = detectKind(relPath);
  const t = I18N[lang];
  let out = html;

  // 1. theme-color
  if (!/<meta name="theme-color"/i.test(out)) {
    out = out.replace(/(<meta name="viewport"[^>]*>)/i, '$1\n  <meta name="theme-color" content="#2563EB">');
  }

  // 2. id sur <main> + lien d'evitement
  let mainId = null;
  const mainMatch = out.match(MAIN_OPEN_RE);
  if (mainMatch) {
    const idMatch = mainMatch[1].match(/\bid="([^"]+)"/);
    if (idMatch) {
      mainId = idMatch[1];
    } else {
      mainId = "contenu";
      out = out.replace(MAIN_OPEN_RE, '<main id="contenu"$1>');
    }
  }
  if (mainId && !/class="skip-link"/.test(out)) {
    out = out.replace(/(<body[^>]*>)/, '$1\n<a class="skip-link" href="#' + mainId + '">' + t.skip + "</a>");
  } else if (mainId) {
    // Idempotence : realigne le texte et la cible si la langue ou l'id ont change.
    out = out.replace(/<a class="skip-link" href="#[^"]*">[^<]*<\/a>/, '<a class="skip-link" href="#' + mainId + '">' + t.skip + "</a>");
  }

  // 3. En-tete unifie
  if (HEADER_RE.test(out)) {
    out = out.replace(HEADER_RE, () => buildHeader(lang, kind));
  }

  // 4. Pied de page unifie
  if (FOOTER_RE.test(out)) {
    const hasConsentScript = /consent-banner\.js/.test(out);
    out = out.replace(FOOTER_RE, () => buildFooter(lang, hasConsentScript));
  }

  // 5. Emplacement "outils associes" avant </main>
  if (mainMatch && !/<!-- outils-associes -->/.test(out)) {
    out = out.replace(/\n?([ \t]*)<\/main>/, "\n\n  <!-- outils-associes -->\n  <!-- /outils-associes -->\n$1</main>");
  }

  return out;
}

/* ---------- Parcours ---------- */
function listPages() {
  const pages = [];
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (name.toLowerCase().endsWith(".html")) pages.push(path.join(dir, name));
    }
  }
  return pages.sort();
}

let changed = 0;
let unchanged = 0;
for (const rel of listPages()) {
  const abs = path.join(ROOT, rel);
  const before = fs.readFileSync(abs, "utf8");
  const after = apply(before, rel);
  if (after === before) {
    unchanged++;
    continue;
  }
  changed++;
  if (CHECK_ONLY) {
    console.log("a mettre a jour : " + rel);
  } else {
    fs.writeFileSync(abs, after);
    console.log("gabarit applique : " + rel);
  }
}

if (CHECK_ONLY) {
  if (changed) {
    console.error("\n" + changed + " page(s) ne portent pas le gabarit courant : lancez node scripts/appliquer-gabarit.js");
    process.exit(1);
  }
  console.log("appliquer-gabarit --check : " + unchanged + " page(s) a jour.");
} else {
  console.log("\n" + changed + " page(s) modifiee(s), " + unchanged + " deja a jour.");
}
