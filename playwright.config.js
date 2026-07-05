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
    command: "npx http-server -p 8943 -a 127.0.0.1 --silent .",
    url: "http://127.0.0.1:8943/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
