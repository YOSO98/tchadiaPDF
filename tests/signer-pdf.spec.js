// Test de bout en bout de l'outil "Signer PDF" : un PDF de test est
// importe, une signature est dessinee sur le canevas, la generation
// produit un resultat telechargeable, sans erreur console.
const { test, expect } = require("@playwright/test");
const path = require("path");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");

test("dessine une signature et propose un telechargement", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/signer-pdf.html");

  const fileInput = page.locator("#fileInput");
  await fileInput.setInputFiles(FIXTURE_1);

  const sigCanvas = page.locator("#sigCanvas");
  await expect(sigCanvas).toBeVisible({ timeout: 15000 });

  // Trace un trait simple sur le canevas de signature (glisser). Le scroll
  // explicite est necessaire : page.mouse utilise des coordonnees viewport
  // brutes qui ne suivent pas automatiquement l'element hors ecran.
  await sigCanvas.scrollIntoViewIfNeeded();
  const box = await sigCanvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
  await page.mouse.move(box.x + 140, box.y + 20, { steps: 5 });
  await page.mouse.up();

  const signBtn = page.locator("#signBtn");
  await expect(signBtn).toBeEnabled({ timeout: 5000 });
  await signBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 15000 });

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});
