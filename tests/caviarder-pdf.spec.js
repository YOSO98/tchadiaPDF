// Test de bout en bout de l'outil "Caviarder PDF" : verifie la garantie
// centrale de l'outil, pas seulement qu'un fichier est produit. Un PDF de
// test est genere a la volee avec un texte "secret" a un endroit precis et
// un texte "public" ailleurs sur une deuxieme page. Une zone est dessinee
// sur le secret, puis le texte extrait du PDF de sortie (via pdf.js) doit :
//   - ne plus contenir le secret nulle part (page caviardee entierement
//     rasterisee : plus aucun texte extractible sur cette page precise) ;
//   - toujours contenir le texte de la page non caviardee, inchangee.
const { test, expect } = require("@playwright/test");

test("caviarde une zone et supprime reellement le texte sous-jacent", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/caviarder-pdf.html");

  // Ecarte le bandeau de consentement : fixe en bas d'ecran, il peut
  // intercepter les clics destines a l'apercu s'il se trouve dans sa zone.
  const refuseBtn = page.locator(".consent-banner-actions button.btn-secondary");
  if (await refuseBtn.count()) await refuseBtn.click();

  // Genere un PDF de test a la volee (pdf-lib deja charge par la page) :
  // page 1 avec un texte "secret" a une position connue, page 2 avec un
  // texte public qui ne doit jamais etre touche.
  const testPdfBytes = await page.evaluate(async () => {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page1 = doc.addPage([400, 300]);
    page1.drawText("Texte public visible page 1", { x: 20, y: 250, size: 14, font });
    page1.drawText("SECRET-CONFIDENTIEL-12345", { x: 20, y: 20, size: 16, font });
    const page2 = doc.addPage([400, 300]);
    page2.drawText("Texte public page 2, jamais touche", { x: 20, y: 150, size: 14, font });
    return Array.from(await doc.save());
  });

  // Ecrit ce PDF dans un fichier temporaire pour pouvoir l'injecter via setInputFiles.
  const path = require("path");
  const fs = require("fs");
  const tmpPath = path.join(require("os").tmpdir(), "caviarder-test-source.pdf");
  fs.writeFileSync(tmpPath, Buffer.from(testPdfBytes));

  await page.locator("#fileInput").setInputFiles(tmpPath);
  await expect(page.locator("#cavPreviewHolder")).toBeVisible({ timeout: 15000 });
  await page.locator("#previewCanvas").scrollIntoViewIfNeeded();

  // Dessine une zone sur la moitie basse de l'apercu (le secret est place
  // pres du bas de la page en coordonnees PDF, donc pres du bas visuel).
  const box = await page.locator("#previewCanvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.95, { steps: 8 });
  await page.mouse.up();

  const caviarderBtn = page.locator("#caviarderBtn");
  await expect(caviarderBtn).toBeEnabled();
  await caviarderBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#result a.btn-primary").click(),
  ]);
  const outBytes = fs.readFileSync(await download.path());

  const verification = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const content = await p.getTextContent();
      texts.push(content.items.map((it) => it.str).join(" "));
    }
    return texts;
  }, Array.from(outBytes));

  expect(verification[0], "le texte de la page caviardee (y compris le secret) ne doit plus etre extractible").not.toContain("SECRET");
  expect(verification[1], "le texte de la page non caviardee doit rester intact").toContain("jamais touche");

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
