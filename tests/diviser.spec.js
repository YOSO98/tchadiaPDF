// Test de bout en bout de l'outil "Diviser PDF" : un PDF de test est
// importe, toutes les pages sont selectionnees, l'extraction produit un
// resultat telechargeable, sans erreur console.
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");

test("extrait les pages selectionnees et propose un telechargement", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/diviser.html");

  const fileInput = page.locator("#fileInput");
  await fileInput.setInputFiles(FIXTURE_1);

  await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 15000 });
  await page.locator("#selectAll").click();

  const splitBtn = page.locator("#splitBtn");
  await expect(splitBtn).toBeEnabled();
  await splitBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 15000 });

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
