// Tests de bout en bout de l'outil "Numéros de page" et de ses deux modes
// supplémentaires (numérotation Bates, en-tête et pied de page). Chaque test
// relit le PDF PRODUIT (blob du lien de téléchargement) et vérifie le texte
// réellement dessiné sur les pages via pdf.js, chargé dans la page de l'outil.
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const os = require("os");
const JSZip = require("jszip");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");
let FIXTURE_3_PAGES; // generee avant les tests : 3 pages, titre "Dossier Martin"

test.beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.setTitle("Dossier Martin");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText("Contenu de la page " + i, { x: 60, y: 700, size: 14, font });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tchadia-bates-"));
  FIXTURE_3_PAGES = path.join(dir, "contrat.pdf");
  fs.writeFileSync(FIXTURE_3_PAGES, await doc.save());
});

function surveillerErreurs(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return () => {
    expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
    expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
  };
}

/** Octets du fichier propose au telechargement. */
async function lireResultat(page) {
  return page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
}

/** Texte de chaque page d'un PDF (tableau de chaines), extrait par pdf.js dans la page. */
async function textesDesPages(page, octets) {
  return page.evaluate(async (data) => {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    const textes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const contenu = await pg.getTextContent();
      textes.push(contenu.items.map((it) => it.str).join(""));
    }
    await pdf.destroy();
    return textes;
  }, octets);
}

test("Bates : numerotation continue sur deux fichiers, noms avec plage", async ({ page }) => {
  const verifierErreurs = surveillerErreurs(page);
  await page.goto("/numeros-de-pages.html");

  await page.locator("#fileInput").setInputFiles([FIXTURE_1, FIXTURE_3_PAGES]);
  await expect(page.locator("#fileList .file-item")).toHaveCount(2);

  await page.locator('#modeSeg button[data-mode="bates"]').click();
  await page.locator("#batesPrefixe").fill("ABC");
  await page.locator("#batesDepart").fill("1");
  await page.locator("#batesChiffres").fill("6");

  // Apercu du premier et du dernier numero (1 + 3 pages = 4 numeros).
  const apercu = page.locator("#apercuBates");
  await expect(apercu).toContainText("ABC000001");
  await expect(apercu).toContainText("ABC000004", { timeout: 15000 });
  await expect(page.locator("#apercuPage")).toHaveClass(/visible/, { timeout: 15000 });

  await page.locator("#startBatchBtn").click();
  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });
  await expect(result.locator("a.btn-primary")).toHaveAttribute("download", /\.zip$/);
  await expect(result.locator("p").first()).toContainText("ABC000001 à ABC000004");

  const zip = await JSZip.loadAsync(Buffer.from(await lireResultat(page)));
  const noms = Object.keys(zip.files).sort();
  expect(noms).toEqual(["contrat_ABC000002-ABC000004.pdf", "test1_ABC000001-ABC000001.pdf"]);

  const second = Array.from(await zip.file("contrat_ABC000002-ABC000004.pdf").async("uint8array"));
  const textes = await textesDesPages(page, second);
  expect(textes).toHaveLength(3);
  expect(textes[0]).toContain("ABC000002");
  expect(textes[2]).toContain("ABC000004");
  expect(textes[2]).not.toContain("ABC000003");

  const premier = Array.from(await zip.file("test1_ABC000001-ABC000001.pdf").async("uint8array"));
  const textesPremier = await textesDesPages(page, premier);
  expect(textesPremier[0]).toContain("ABC000001");

  verifierErreurs();
});

test("Bates : prefixe accentue « Déposition n° » en Times, texte selectionnable", async ({ page }) => {
  const verifierErreurs = surveillerErreurs(page);
  await page.goto("/numeros-de-pages.html");

  await page.locator("#fileInput").setInputFiles(FIXTURE_3_PAGES);
  await expect(page.locator("#numBtn")).toBeEnabled();

  await page.locator('#modeSeg button[data-mode="bates"]').click();
  await page.locator('#fontSeg button[data-font="times"]').click();
  await page.locator("#batesPrefixe").fill("Déposition n° ");
  await page.locator("#batesDepart").fill("41");
  await page.locator("#batesChiffres").fill("4");
  await expect(page.locator("#numBtn")).toHaveText("Appliquer la numérotation Bates");
  await page.locator("#numBtn").click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });
  await expect(result.locator("a.btn-primary")).toHaveAttribute("download", "contrat_Déposition n° 0041-Déposition n° 0043.pdf");

  const textes = await textesDesPages(page, await lireResultat(page));
  expect(textes[0]).toContain("Déposition n° 0041");
  expect(textes[2]).toContain("Déposition n° 0043");

  verifierErreurs();
});

test("En-tete et pied de page : variables {fichier}, {page}, {pages}, {titre}", async ({ page }) => {
  const verifierErreurs = surveillerErreurs(page);
  await page.goto("/numeros-de-pages.html");

  await page.locator("#fileInput").setInputFiles(FIXTURE_3_PAGES);
  await expect(page.locator("#numBtn")).toBeEnabled();

  await page.locator('#modeSeg button[data-mode="entete"]').click();
  await page.locator("#zoneHautCentre").fill("{fichier}");
  await page.locator("#zoneHautGauche").fill("{titre}");
  await page.locator("#zoneBasDroite").fill("Page {page} sur {pages}");
  await expect(page.locator("#apercuPage")).toHaveClass(/visible/, { timeout: 15000 });
  await page.locator("#numBtn").click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });
  await expect(result.locator("a.btn-primary")).toHaveAttribute("download", "contrat-en-tete-pied-de-page.pdf");

  const textes = await textesDesPages(page, await lireResultat(page));
  expect(textes).toHaveLength(3);
  expect(textes[1]).toContain("Page 2 sur 3");
  expect(textes[1]).toContain("contrat.pdf");
  expect(textes[1]).toContain("Dossier Martin");
  expect(textes[0]).toContain("Page 1 sur 3");
  expect(textes[2]).toContain("Page 3 sur 3");

  verifierErreurs();
});

test("En-tete et pied de page : « ne pas appliquer sur la premiere page »", async ({ page }) => {
  const verifierErreurs = surveillerErreurs(page);
  await page.goto("/numeros-de-pages.html");

  await page.locator("#fileInput").setInputFiles(FIXTURE_3_PAGES);
  await expect(page.locator("#numBtn")).toBeEnabled();

  await page.locator('#modeSeg button[data-mode="entete"]').click();
  await page.locator("#zoneBasCentre").fill("Confidentiel {page}");
  await page.locator("#sauterPremiere").check();
  await page.locator("#numBtn").click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });

  const textes = await textesDesPages(page, await lireResultat(page));
  expect(textes[0]).not.toContain("Confidentiel");
  expect(textes[1]).toContain("Confidentiel 2");
  expect(textes[2]).toContain("Confidentiel 3");

  verifierErreurs();
});

test("En-tete et pied de page : plage de pages et champ vide refuse", async ({ page }) => {
  const verifierErreurs = surveillerErreurs(page);
  await page.goto("/numeros-de-pages.html");

  await page.locator("#fileInput").setInputFiles(FIXTURE_3_PAGES);
  await expect(page.locator("#numBtn")).toBeEnabled();
  await page.locator('#modeSeg button[data-mode="entete"]').click();

  // Aucune zone saisie : message clair, pas de resultat.
  await page.locator("#numBtn").click();
  await expect(page.locator("#msg")).toContainText("au moins une zone");
  await expect(page.locator("#result")).not.toHaveClass(/visible/);

  await page.locator("#zoneHautDroite").fill("Annexe {page}");
  await page.locator("#plagePages").fill("2-2");
  await page.locator("#numBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });

  const textes = await textesDesPages(page, await lireResultat(page));
  expect(textes[0]).not.toContain("Annexe");
  expect(textes[1]).toContain("Annexe 2");
  expect(textes[2]).not.toContain("Annexe");

  verifierErreurs();
});

test("Numeros de page : mode d'origine conserve (format « Page 1 »)", async ({ page }) => {
  const verifierErreurs = surveillerErreurs(page);
  await page.goto("/numeros-de-pages.html");

  await page.locator("#fileInput").setInputFiles(FIXTURE_3_PAGES);
  await expect(page.locator("#numBtn")).toBeEnabled();
  await expect(page.locator("#numBtn")).toHaveText("Ajouter les numéros");
  await page.locator('#formatSeg button[data-format="page-n"]').click();
  await page.locator("#numBtn").click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });
  await expect(result.locator("a.btn-primary")).toHaveAttribute("download", "tchadiapdf-numerote.pdf");

  const textes = await textesDesPages(page, await lireResultat(page));
  expect(textes[0]).toContain("Page 1");
  expect(textes[2]).toContain("Page 3");

  verifierErreurs();
});
