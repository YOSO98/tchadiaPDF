#!/usr/bin/env node
/**
 * Construit vendor/pades-libs.min.js : pkijs + asn1js + @signpdf/signpdf +
 * @signpdf/placeholder-pdf-lib (+ le polyfill Buffer), en un seul fichier
 * IIFE servi depuis notre propre domaine (aucun CDN, aucun appel reseau).
 *
 * Le site reste sans etape de build : ce script n'est lance qu'a la mise a
 * jour volontaire de ces dependances, et son resultat est versionne dans le
 * depot. Il met aussi a jour, dans js/pades.js, l'URL (?v=hash) et
 * l'empreinte SRI (integrity sha384) du fichier genere.
 *
 *   npm run vendor-pades
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "vendor", "pades-libs.min.js");
const PADES_JS = path.join(ROOT, "js", "pades.js");

function versionDe(nom) {
  return require(path.join(ROOT, "node_modules", nom, "package.json")).version;
}

(async () => {
  const versions = ["pkijs", "asn1js", "@signpdf/signpdf", "@signpdf/placeholder-pdf-lib", "@signpdf/utils", "buffer"]
    .map((n) => n + "@" + versionDe(n)).join(", ");

  const resultat = await esbuild.build({
    metafile: true,
    entryPoints: [path.join(__dirname, "vendor-src", "pades-entry.mjs")],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    legalComments: "eof",
    charset: "utf8",
    alias: { "pdf-lib": path.join(__dirname, "vendor-src", "pdf-lib-global.cjs") },
    inject: [path.join(__dirname, "vendor-src", "buffer-shim.mjs")],
    banner: { js: "/*! tchadiaPdf : paquet vendorise (" + versions + "). Licences : voir vendor/LICENSES-pades.txt */" },
    outfile: OUT,
  });

  // Licences : texte complet de chaque paquet réellement embarqué.
  const paquets = new Set();
  for (const f of Object.keys(resultat.metafile.inputs)) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(f);
    if (m) paquets.add(m[1]);
  }
  let licences = "Licences des bibliothèques embarquées dans vendor/pades-libs.min.js\n" +
    "(fichier généré par scripts/build-vendor-pades.js, ne pas modifier à la main)\n";
  for (const nom of [...paquets].sort()) {
    const dossier = path.join(ROOT, "node_modules", nom);
    const pkg = require(path.join(dossier, "package.json"));
    const fichierLicence = fs.readdirSync(dossier).find((f) => /^licen[cs]e/i.test(f));
    licences += "\n==============================================================\n" +
      nom + "@" + pkg.version + " (" + (pkg.license || "voir ci-dessous") + ")\n" +
      "==============================================================\n" +
      (fichierLicence ? fs.readFileSync(path.join(dossier, fichierLicence), "utf8").trim() : "Licence : " + pkg.license) + "\n";
  }
  fs.writeFileSync(path.join(ROOT, "vendor", "LICENSES-pades.txt"), licences);

  const contenu = fs.readFileSync(OUT);
  const hash8 = crypto.createHash("sha256").update(contenu).digest("hex").slice(0, 8);
  const sri = "sha384-" + crypto.createHash("sha384").update(contenu).digest("base64");

  let js = fs.readFileSync(PADES_JS, "utf8");
  js = js.replace(/const PADES_LIBS_URL = "[^"]*";/, 'const PADES_LIBS_URL = "/vendor/pades-libs.min.js?v=' + hash8 + '";');
  js = js.replace(/const PADES_LIBS_SRI = "[^"]*";/, 'const PADES_LIBS_SRI = "' + sri + '";');
  fs.writeFileSync(PADES_JS, js);

  console.log("vendor/pades-libs.min.js : " + (contenu.length / 1024).toFixed(1) + " Ko, v=" + hash8);
  console.log(versions);
})().catch((e) => { console.error(e); process.exit(1); });
