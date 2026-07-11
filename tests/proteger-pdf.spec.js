// Test de bout en bout de l'outil "Proteger PDF" : un PDF de test est
// importe, un mot de passe est saisi, le chiffrement produit un resultat
// telechargeable, sans erreur console.
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");

test("chiffre un PDF avec mot de passe et propose un telechargement", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/proteger-pdf.html");

  const fileInput = page.locator("#fileInput");
  await fileInput.setInputFiles(FIXTURE_1);

  await expect(page.locator("#pw1")).toBeVisible({ timeout: 15000 });
  await page.locator("#pw1").fill("motdepasse123");
  await page.locator("#pw2").fill("motdepasse123");

  const protectBtn = page.locator("#protectBtn");
  await expect(protectBtn).toBeEnabled();
  await protectBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
