// Tests de bout en bout de l'outil "Proteger PDF" : on verifie le PDF
// PRODUIT (dictionnaire /Encrypt, revision, bits de droits /P), pas
// seulement l'interface.
const { test, expect } = require("@playwright/test");
const path = require("path");
const { PDFDocument, PDFName, PDFNumber } = require("pdf-lib");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");

// Bits du champ /P (norme PDF, tableau 22), numerotes a partir de 1.
const BIT_PRINT = 1 << 2;       // bit 3 : impression
const BIT_MODIFY = 1 << 3;      // bit 4 : autres modifications
const BIT_EXTRACT = 1 << 4;     // bit 5 : copie de texte et d'images
const BIT_ANNOTATE = 1 << 5;    // bit 6 : commentaires et formulaires
const BIT_FORM = 1 << 8;        // bit 9 : remplissage de formulaires
const BIT_ACCESS = 1 << 9;      // bit 10 : lecteurs d'ecran
const BIT_PRINT_HIGH = 1 << 11; // bit 12 : impression haute resolution

function surveille(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

function verifieAucuneErreur({ consoleErrors, pageErrors }) {
  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
}

/** Recupere les octets du PDF propose au telechargement. */
async function recupereResultat(page) {
  const octets = await page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
  return new Uint8Array(octets);
}

/** Lit le dictionnaire /Encrypt du PDF produit via pdf-lib. */
async function litEncrypt(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const encRef = doc.context.trailerInfo.Encrypt;
  expect(encRef, "le trailer doit porter /Encrypt").toBeTruthy();
  const enc = doc.context.lookup(encRef);
  const num = (key) => {
    const v = enc.get(PDFName.of(key));
    expect(v, "/" + key + " attendu dans /Encrypt").toBeInstanceOf(PDFNumber);
    return v.asNumber();
  };
  return { doc, enc, V: num("V"), R: num("R"), P: num("P") | 0, Length: num("Length") };
}

async function chargeFixture(page) {
  await page.goto("/proteger-pdf.html");
  await page.locator("#fileInput").setInputFiles(FIXTURE_1);
  await expect(page.locator("#pw1")).toBeVisible({ timeout: 15000 });
}

test("chiffre en AES-256 avec droits restreints : /V 5 /R 6, impression et copie interdites", async ({ page }) => {
  const erreurs = surveille(page);
  await chargeFixture(page);

  await page.locator("#pw1").fill("motdepasse123");
  await page.locator("#pw2").fill("motdepasse123");
  await page.locator("#pwOwner").fill("proprietaire456");
  await page.locator("#permPrint").selectOption("none");
  await page.locator("#permModify").selectOption("none");
  await page.locator("#permExtract").uncheck();

  // Resume lisible avant le telechargement
  const resume = page.locator("#permSummary");
  await expect(resume).toContainText("Ouverture : mot de passe requis");
  await expect(resume).toContainText("Impression : interdite");
  await expect(resume).toContainText("Copie de texte et d'images : interdite");
  await expect(resume).toContainText("Modification : interdite");
  await expect(resume).toContainText("Lecteurs d'écran : autorisés");

  const protectBtn = page.locator("#protectBtn");
  await expect(protectBtn).toBeEnabled();
  await protectBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });
  await expect(page.locator("#resultSummary")).toContainText("Chiffrement : AES-256");

  const bytes = await recupereResultat(page);
  expect(bytes.length).toBeGreaterThan(100);
  const { V, R, P, Length } = await litEncrypt(bytes);
  expect(V).toBe(5);
  expect(R).toBe(6);
  expect(Length).toBe(256);
  expect(P & BIT_PRINT, "bit 3 impression a 0").toBe(0);
  expect(P & BIT_PRINT_HIGH, "bit 12 impression haute resolution a 0").toBe(0);
  expect(P & BIT_EXTRACT, "bit 5 copie a 0").toBe(0);
  expect(P & BIT_MODIFY, "bit 4 modification a 0").toBe(0);
  expect(P & BIT_ANNOTATE, "bit 6 annotation a 0").toBe(0);
  expect(P & BIT_FORM, "bit 9 formulaires a 0").toBe(0);
  expect(P & BIT_ACCESS, "bit 10 accessibilite conserve a 1").toBe(BIT_ACCESS);

  // Le PDF chiffre ne doit plus s'ouvrir sans mot de passe
  await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);

  verifieAucuneErreur(erreurs);
});

test("sans mot de passe d'ouverture : ouverture libre annoncee, /Encrypt present, droits restreints", async ({ page }) => {
  const erreurs = surveille(page);
  await chargeFixture(page);

  // Mode "Restreindre la modification et l'impression" : seul le mot de
  // passe proprietaire est renseigne.
  await page.locator("#pwOwner").fill("proprietaire456");
  await page.locator("#permPrint").selectOption("low");
  await page.locator("#permModify").selectOption("form");

  const resume = page.locator("#permSummary");
  await expect(resume).toContainText("Ouverture : libre, sans mot de passe");
  await expect(resume).toContainText("Impression : basse résolution seulement");
  await expect(resume).toContainText("Modification : remplissage de formulaires et signature seulement");

  const protectBtn = page.locator("#protectBtn");
  await expect(protectBtn).toBeEnabled();
  await protectBtn.click();

  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  await expect(page.locator("#resultSummary")).toContainText("Ouverture : libre, sans mot de passe");

  const bytes = await recupereResultat(page);
  const { V, R, P } = await litEncrypt(bytes);
  expect(V).toBe(5);
  expect(R).toBe(6);
  expect(P & BIT_PRINT, "impression basse resolution : bit 3 a 1").toBe(BIT_PRINT);
  expect(P & BIT_PRINT_HIGH, "impression basse resolution : bit 12 a 0").toBe(0);
  expect(P & BIT_EXTRACT, "copie autorisee : bit 5 a 1").toBe(BIT_EXTRACT);
  expect(P & BIT_FORM, "formulaires autorises : bit 9 a 1").toBe(BIT_FORM);
  expect(P & BIT_ANNOTATE, "commentaires interdits : bit 6 a 0").toBe(0);
  expect(P & BIT_MODIFY, "autres modifications interdites : bit 4 a 0").toBe(0);

  // Ouverture libre : pdf-lib doit pouvoir lire le document sans mot de
  // passe (le mot de passe utilisateur vide est accepte par la norme).
  // pdf-lib ne dechiffre pas : on verifie seulement que la structure est
  // lisible et que le nombre de pages est conserve.
  const docRef = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const original = await PDFDocument.load(require("fs").readFileSync(FIXTURE_1));
  expect(docRef.getPageCount()).toBe(original.getPageCount());

  verifieAucuneErreur(erreurs);
});

test("mots de passe d'ouverture differents : message affiche, aucun fichier produit", async ({ page }) => {
  const erreurs = surveille(page);
  await chargeFixture(page);

  await page.locator("#pw1").fill("motdepasse123");
  await page.locator("#pw2").fill("autrechose");

  await expect(page.locator("#msg")).toHaveClass(/visible/);
  await expect(page.locator("#msg")).toContainText("ne correspondent pas");
  await expect(page.locator("#protectBtn")).toBeDisabled();

  // Tentative de lancement malgre tout (clic force) : rien ne doit etre produit
  await page.locator("#protectBtn").click({ force: true });
  await page.waitForTimeout(500);
  await expect(page.locator("#result")).not.toHaveClass(/visible/);
  const href = await page.locator("#result a.btn-primary").getAttribute("href");
  expect(href).toBe("#");

  verifieAucuneErreur(erreurs);
});

test("droits restreints sans mot de passe proprietaire distinct : refuse avec explication", async ({ page }) => {
  const erreurs = surveille(page);
  await chargeFixture(page);

  await page.locator("#pw1").fill("motdepasse123");
  await page.locator("#pw2").fill("motdepasse123");
  await expect(page.locator("#protectBtn")).toBeEnabled();

  await page.locator("#permPrint").selectOption("none");
  await expect(page.locator("#protectBtn")).toBeDisabled();
  await expect(page.locator("#msg")).toContainText("mot de passe propriétaire");

  // Meme mot de passe que l'ouverture : refuse aussi
  await page.locator("#pwOwner").fill("motdepasse123");
  await expect(page.locator("#protectBtn")).toBeDisabled();
  await expect(page.locator("#msg")).toContainText("doit être différent");

  await page.locator("#pwOwner").fill("proprietaire456");
  await expect(page.locator("#protectBtn")).toBeEnabled();
  await expect(page.locator("#msg")).not.toHaveClass(/visible/);

  verifieAucuneErreur(erreurs);
});

test.describe("moteur qpdf indisponible", () => {
  // Le service worker (sw.js) servirait sinon le moteur depuis son cache,
  // hors de portee de page.route.
  test.use({ serviceWorkers: "block" });

test("repli RC4 128 bits quand qpdf est indisponible : memes mots de passe et memes droits", async ({ page }) => {
  const erreurs = surveille(page);
  // Coupe le chargement du moteur qpdf pour forcer le repli.
  await page.route("**/vendor/qpdf-0.3.0/**", (route) => route.abort());
  await chargeFixture(page);

  await page.locator("#pw1").fill("motdepasse123");
  await page.locator("#pw2").fill("motdepasse123");
  await page.locator("#pwOwner").fill("proprietaire456");
  await page.locator("#permPrint").selectOption("none");
  await page.locator("#permExtract").uncheck();

  await page.locator("#protectBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  await expect(page.locator("#msg")).toContainText("RC4 128 bits");
  await expect(page.locator("#resultSummary")).toContainText("Chiffrement : RC4 128 bits");

  const bytes = await recupereResultat(page);
  const { V, R, P, Length } = await litEncrypt(bytes);
  expect(V).toBe(2);
  expect(R).toBe(3);
  expect(Length).toBe(128);
  expect(P & BIT_PRINT).toBe(0);
  expect(P & BIT_PRINT_HIGH).toBe(0);
  expect(P & BIT_EXTRACT).toBe(0);
  expect(P & BIT_MODIFY, "modification toujours autorisee").toBe(BIT_MODIFY);
  await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);

  // Le chargement bloque du moteur passe par console.error : seules ces
  // lignes-la sont tolerees ici.
  const autres = erreurs.consoleErrors.filter((t) => !/qpdf|Failed to load resource|net::ERR_FAILED/i.test(t));
  expect(autres, "aucune autre erreur console : " + autres.join(" | ")).toEqual([]);
  expect(erreurs.pageErrors).toEqual([]);
});
});
