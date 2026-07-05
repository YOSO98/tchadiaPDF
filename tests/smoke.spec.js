// Test de fumee : la page d'accueil charge sans erreur, affiche des outils,
// et les liens de navigation ne sont pas casses.
const { test, expect } = require("@playwright/test");

test.describe("Page d'accueil", () => {
  test("charge sans erreur console et affiche des cartes d'outils", async ({ page }) => {
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const response = await page.goto("/index.html");
    expect(response.ok()).toBeTruthy();

    await page.waitForLoadState("networkidle");

    const cards = page.locator(".tool-card");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
    expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
  });

  test("aucun lien casse evident dans l'en-tete et le pied de page", async ({ page, request }) => {
    await page.goto("/index.html");
    await page.waitForLoadState("networkidle");

    const hrefs = await page.$$eval("header a[href], footer a[href]", (els) =>
      els.map((el) => el.getAttribute("href"))
    );

    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of hrefs) {
      if (!href || href.startsWith("http") || href.startsWith("mailto:")) continue;
      const cleanPath = href.split("#")[0];
      if (!cleanPath) continue; // lien de type "#outils" pointant sur la page courante
      const res = await request.get("/" + cleanPath.replace(/^\/+/, ""));
      expect(res.ok(), `le lien "${href}" (${cleanPath}) doit repondre 200`).toBeTruthy();
    }
  });

  test("la page d'accueil affiche au moins un outil vedette", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".tool-card").first()).toBeVisible();
    await expect(page.locator("h1")).toContainText(/PDF/i);
  });
});
