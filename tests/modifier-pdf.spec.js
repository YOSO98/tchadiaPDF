// Test leger de non-regression pour l'editeur PDF : la page charge, un PDF
// se charge dans l'editeur (vignettes affichees), aucune erreur console.
// La logique d'edition detaillee (texte, formes, annotations) est deja
// validee manuellement et n'est pas retestee ici.
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");

test("charge un PDF dans l'editeur sans erreur console", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/modifier-pdf.html");

  const fileInput = page.locator("#fileInput");
  await fileInput.setInputFiles(FIXTURE_1);

  await expect(page.locator("#editorSection")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#thumbRail .thumb-item").first()).toBeVisible({ timeout: 15000 });

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
