// Test de bout en bout de l'outil "Compresser PDF" : un PDF de test est
// importe, le lot est lance, un resultat telechargeable doit apparaitre,
// sans erreur console.
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");

test("compresse un PDF et propose un telechargement", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/compresser-pdf.html");

  const fileInput = page.locator("#fileInput");
  await fileInput.setInputFiles(FIXTURE_1);

  await expect(page.locator("#fileList .file-item")).toHaveCount(1, { timeout: 15000 });

  const compressBtn = page.locator("#compressBtn");
  await expect(compressBtn).toBeEnabled();
  await compressBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
