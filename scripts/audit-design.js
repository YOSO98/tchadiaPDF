#!/usr/bin/env node
/**
 * Audit visuel et d'accessibilite de tchadiaPdf (equipe design).
 *
 * Capture 5 pages representatives en 1280 px et 390 px (accueil, conversion,
 * caviardage, numeros de page, editeur), avec un PDF de test charge la ou
 * c'est pertinent, puis lance axe-core (WCAG 2.x A/AA) sur chaque page et
 * ecrit un resume JSON. Sert a produire les captures "avant/apres" de
 * docs/design-audit/ et les chiffres de docs/DESIGN-AUDIT.md.
 *
 *   node scripts/audit-design.js <dossier-de-sortie> [--port 8961]
 *
 * Prerequis : un serveur statique sur le port indique, par exemple
 *   npx http-server -p 8961 -a 127.0.0.1 -e html --silent .
 * Aucune requete reseau externe : tout est servi en local.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const ROOT = path.resolve(__dirname, "..");
const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage : node scripts/audit-design.js <dossier-de-sortie> [--port 8961]");
  process.exit(1);
}
const portIdx = process.argv.indexOf("--port");
const PORT = portIdx !== -1 ? process.argv[portIdx + 1] : "8961";
const BASE = "http://127.0.0.1:" + PORT;
const FIXTURE = path.join(ROOT, "tests", "fixtures", "test1.pdf");

const PAGES = [
  { id: "accueil", url: "/", full: true },
  { id: "pdf-en-word", url: "/pdf-en-word", upload: "#fileInput", waitFor: "#fileInfo.visible, #fileList .file-item", full: true },
  { id: "caviarder-pdf", url: "/caviarder-pdf", upload: "#fileInput", waitFor: "#cavPreviewHolder", full: true },
  { id: "numeros-de-pages", url: "/numeros-de-pages", upload: "#fileInput", waitFor: "#numOptions", full: true },
  { id: "modifier-pdf", url: "/modifier-pdf", upload: "#fileInput", waitFor: "#thumbRail .thumb-item", full: false },
];
const WIDTHS = [1280, 390];

fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const axeSummary = {};
  for (const pg of PAGES) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: width < 600 ? 844 : 800 },
        deviceScaleFactor: 1,
        // Le bandeau de consentement est deja repondu : il masquerait le bas
        // de page sur mobile et n'est pas l'objet de l'audit (capture a part).
        storageState: { cookies: [], origins: [{ origin: BASE, localStorage: [{ name: "tchadiapdf_ad_consent", value: "denied" }] }] },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE + pg.url, { waitUntil: "networkidle" });
      if (pg.upload && fs.existsSync(FIXTURE)) {
        await page.locator(pg.upload).setInputFiles(FIXTURE);
        try {
          await page.locator(pg.waitFor).first().waitFor({ state: "visible", timeout: 15000 });
        } catch (e) {
          console.warn("  (" + pg.id + " : attente de " + pg.waitFor + " expiree)");
        }
        await page.waitForTimeout(600);
      }
      const file = path.join(outDir, pg.id + "-" + width + ".png");
      await page.screenshot({ path: file, fullPage: pg.full });
      console.log("capture", path.relative(ROOT, file));

      if (width === 1280) {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        axeSummary[pg.id] = {
          url: pg.url,
          violations: results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.length,
            targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
          })),
          passes: results.passes.length,
          incomplete: results.incomplete.length,
          pageErrors: errors,
        };
        console.log("  axe :", results.violations.length, "violation(s)");
      }
      await context.close();
    }
  }
  fs.writeFileSync(path.join(outDir, "axe.json"), JSON.stringify(axeSummary, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
