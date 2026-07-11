// Test de bout en bout de l'outil "OCR PDF" : un PDF de test est importe et
// l'OCR est lance, un resultat telechargeable doit apparaitre, sans erreur
// console. Le moteur Tesseract telecharge ses donnees de langue depuis un
// CDN au premier lancement : delai genereux pour absorber ce temps reseau.
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");

test("lance l'OCR sur un PDF et propose un telechargement", async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/ocr-pdf.html");

  const fileInput = page.locator("#fileInput");
  await fileInput.setInputFiles(FIXTURE_1);

  const ocrBtn = page.locator("#ocrBtn");
  await expect(ocrBtn).toBeEnabled({ timeout: 15000 });
  await ocrBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 100000 });

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
