// Preuve automatisee que tchadiaPdf ne fait fuiter aucune donnee de fichier
// vers le reseau. C'est l'argument central du projet ("100% prive, aucun
// fichier envoye sur un serveur") : ce test l'etablit par la mesure, pas
// seulement par l'affirmation.
//
// Pour chaque outil teste, le scenario est le suivant :
//   1. On intercepte TOUTES les requetes reseau de la page des l'ouverture,
//      avant meme de televerser un fichier.
//   2. On televerse un PDF de test (tests/fixtures/marqueur-confidentiel.pdf)
//      qui contient un marqueur unique et facilement identifiable
//      ("MARQUEUR_CONFIDENTIEL_UNIQUE_XYZ123"), insere en clair dans les
//      octets du fichier (voir la note dans ce fichier de fixture : le
//      marqueur y est place comme commentaire PDF non compresse, pour
//      rester recherchable tel quel meme si le contenu textuel des pages
//      est lui-meme compresse par pdf-lib).
//   3. On lance le traitement jusqu'au bout (telechargement du resultat).
//   4. On verifie sur l'ENSEMBLE des requetes interceptees pendant tout le
//      scenario que :
//        (a) aucune requete ne vise un domaine qui ne soit pas deja
//            legitimement utilise par le site (CDN de librairie JS, police
//            Google Fonts). Cette liste est construite dynamiquement a
//            partir des balises <script src> / <link href> de TOUTES les
//            pages HTML du site (et non codee en dur), unie aux requetes
//            reellement observees pendant le chargement normal de la page
//            testee (avant tout televersement). Le perimetre "site entier"
//            (plutot que la seule page testee) est necessaire car certains
//            outils chargent une librairie CDN a la demande via une balise
//            <script> injectee en JavaScript au moment du traitement (ex :
//            fontkit pour l'edition PDF avec polices personnalisees) : ce
//            CDN est deja utilise ailleurs sur le site de facon statique,
//            ce n'est donc pas un domaine nouveau ou suspect. Cela couvre
//            aussi fonts.gstatic.com, sous-ressource chargee par la feuille
//            de style Google Fonts sans balise directe.
//        (b) aucune requete (URL, parametres, corps postData) ne contient
//            le marqueur unique : preuve concrete que le contenu du
//            fichier n'a jamais transite par le reseau.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const MARKER = "MARQUEUR_CONFIDENTIEL_UNIQUE_XYZ123";
const FIXTURE_MARKED = path.join(__dirname, "fixtures", "marqueur-confidentiel.pdf");
const FIXTURE_PLAIN = path.join(__dirname, "fixtures", "test2.pdf");

/** Extrait les noms d'hote references par <script src="..."> et <link href="..."> d'un fichier HTML. */
function extractTagHostnames(htmlFilePath) {
  const html = fs.readFileSync(htmlFilePath, "utf-8");
  const hosts = new Set();
  const re = /(?:src|href)="(https?:\/\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      hosts.add(new URL(m[1]).hostname);
    } catch {
      // URL malformee : ignoree, ne peut pas servir de domaine attendu.
    }
  }
  return hosts;
}

/**
 * Construit l'ensemble des domaines CDN deja utilises quelque part sur le
 * site, en grep-ant les balises <script src> / <link href> de toutes les
 * pages HTML a la racine du depot. Calcule une seule fois.
 */
function collectSiteWideCdnHosts() {
  const repoRoot = path.join(__dirname, "..");
  const hosts = new Set();
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".html")) {
      for (const h of extractTagHostnames(path.join(repoRoot, entry.name))) hosts.add(h);
    }
  }
  return hosts;
}

const SITE_WIDE_CDN_HOSTS = collectSiteWideCdnHosts();

// Quatre outils representatifs, deja stables et couverts par ailleurs
// (fusion, compression, edition, conversion), choisis pour ne pas dependre
// de fichiers en cours de modification par d'autres travaux en parallele.
const TOOLS = [
  {
    file: "fusionner.html",
    upload: async (page) => {
      await page.locator("#fileInput").setInputFiles([FIXTURE_MARKED, FIXTURE_PLAIN]);
      await expect(page.locator("#fileList .file-item")).toHaveCount(2);
      const btn = page.locator("#mergeBtn");
      await expect(btn).toBeEnabled();
      await btn.click();
    },
  },
  {
    file: "compresser-pdf.html",
    upload: async (page) => {
      await page.locator("#fileInput").setInputFiles([FIXTURE_MARKED]);
      const btn = page.locator("#compressBtn");
      await expect(btn).toBeEnabled();
      await btn.click();
    },
  },
  {
    file: "modifier-pdf.html",
    upload: async (page) => {
      await page.locator("#fileInput").setInputFiles([FIXTURE_MARKED]);
      await expect(page.locator("#editorSection")).toBeVisible({ timeout: 15000 });
      const btn = page.locator("#saveBtn");
      await expect(btn).toBeEnabled();
      await btn.click();
    },
  },
  {
    file: "pdf-en-word.html",
    upload: async (page) => {
      await page.locator("#fileInput").setInputFiles([FIXTURE_MARKED]);
      const btn = page.locator("#convertBtn");
      await expect(btn).toBeEnabled();
      await btn.click();
    },
  },
];

for (const tool of TOOLS) {
  test(`${tool.file} : aucune fuite reseau du contenu du fichier televerse`, async ({ page }) => {
    const requests = [];
    page.on("request", (req) => {
      // Seules les requetes reseau reelles (http/https) nous interessent ici.
      // Les URL blob: (utilisees pour le lien de telechargement du resultat,
      // genere localement via URL.createObjectURL) et data: ne quittent
      // jamais la machine : ce ne sont pas des requetes reseau, meme si
      // Chromium emet un evenement "request" de type synthetique pour elles.
      if (!/^https?:\/\//.test(req.url())) return;
      requests.push({ url: req.url(), postData: req.postData(), method: req.method() });
    });

    await page.goto("/" + tool.file);
    await page.waitForLoadState("networkidle");

    // Domaines legitimes attendus : les CDN deja utilises quelque part sur
    // le site (balises statiques), unis a ceux deja contactes pendant le
    // chargement normal de cette page precise (avant tout televersement).
    const baselineHosts = requests.map((r) => new URL(r.url).hostname);
    const allowedHosts = new Set([...SITE_WIDE_CDN_HOSTS, ...baselineHosts, "127.0.0.1"]);

    await tool.upload(page);

    const result = page.locator("#result");
    await expect(result).toHaveClass(/visible/, { timeout: 20000 });
    const downloadLink = result.locator("a.btn-primary");
    await expect(downloadLink).toHaveAttribute("href", /^blob:/);

    expect(requests.length, "des requetes reseau (chargement des CDN) doivent avoir ete interceptees").toBeGreaterThan(0);

    for (const r of requests) {
      // Verification (a) : aucun domaine inattendu.
      const hostname = new URL(r.url).hostname;
      expect(
        allowedHosts.has(hostname),
        `[${tool.file}] Requete vers un domaine non attendu : ${r.method} ${r.url}\n` +
          `Domaines attendus : ${[...allowedHosts].join(", ")}`
      ).toBeTruthy();

      // Verification (b) : le marqueur confidentiel n'apparait jamais dans
      // l'URL ni dans le corps d'aucune requete.
      expect(
        r.url.includes(MARKER),
        `[${tool.file}] Le marqueur confidentiel a fuite dans l'URL d'une requete : ${r.method} ${r.url}`
      ).toBeFalsy();
      if (r.postData) {
        expect(
          r.postData.includes(MARKER),
          `[${tool.file}] Le marqueur confidentiel a fuite dans le corps d'une requete : ${r.method} ${r.url}`
        ).toBeFalsy();
      }
    }
  });
}
