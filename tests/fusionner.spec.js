// Test de bout en bout de l'outil "Fusionner PDF" : deux petits PDF de
// test (tests/fixtures/test1.pdf et test2.pdf, generes a l'avance avec
// pdf-lib) sont importes, fusionnes, et un resultat telechargeable doit
// apparaitre, sans erreur console.
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");
const FIXTURE_2 = path.join(__dirname, "fixtures", "test2.pdf");

test("fusionne deux PDF et propose un telechargement", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/fusionner.html");

  const fileInput = page.locator("#fileInput");
  await fileInput.setInputFiles([FIXTURE_1, FIXTURE_2]);

  // Les deux fichiers doivent apparaitre dans la liste avant fusion.
  await expect(page.locator("#fileList .file-item")).toHaveCount(2);

  const mergeBtn = page.locator("#mergeBtn");
  await expect(mergeBtn).toBeEnabled();
  await mergeBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 15000 });

  const downloadLink = result.locator("a.btn-primary");
  await expect(downloadLink).toHaveAttribute("download", /.+\.pdf$/);
  const href = await downloadLink.getAttribute("href");
  expect(href).toMatch(/^blob:/);

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
