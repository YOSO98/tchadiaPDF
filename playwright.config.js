// Configuration Playwright pour tchadiaPdf.
// Le site est 100% statique : ces tests servent de filet de securite en CI,
// pas d'une couverture exhaustive. Ils s'executent contre un simple serveur
// de fichiers statiques (http-server) lance automatiquement avant les tests.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30000,

  use: {
    baseURL: "http://127.0.0.1:8943",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // -e html : sert une-page.html a la fois sur /une-page.html et sur /une-page
    // (sans extension), pour se rapprocher du comportement natif de Cloudflare
    // Pages en production (qui sert les pages HTML sans extension et redirige
    // les URLs en .html vers leur equivalent propre). http-server ne reproduit
    // pas la redirection 308 elle-meme, seulement la resolution d'URL propre :
    // suffisant pour verifier que les liens internes (desormais sans .html)
    // resolvent correctement en local.
    command: "npx http-server -p 8943 -a 127.0.0.1 -e html --silent .",
    url: "http://127.0.0.1:8943/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
