// Test de bout en bout de l'outil "Formulaires PDF" : un PDF de test avec
// un champ de formulaire (tests/fixtures/formulaire.pdf, genere via
// pdf-lib) est importe, le champ est rempli, l'enregistrement produit un
// resultat telechargeable, sans erreur console.
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE_FORMULAIRE = path.join(__dirname, "fixtures", "formulaire.pdf");

test("remplit un champ de formulaire et propose un telechargement", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/formulaires-pdf.html");

  const fileInput = page.locator("#fileInput");
  await fileInput.setInputFiles(FIXTURE_FORMULAIRE);

  await expect(page.locator("#champ-formulaire-0")).toBeVisible({ timeout: 15000 });
  await page.locator("#champ-formulaire-0").fill("Jean Dupont");

  const fillBtn = page.locator("#fillBtn");
  await expect(fillBtn).toBeEnabled();
  await fillBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 15000 });

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
