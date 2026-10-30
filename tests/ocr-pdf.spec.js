// Tests de bout en bout de l'outil "OCR PDF".
//
// Le moteur Tesseract.js et les donnees de langue (fra, eng) sont servis
// depuis /vendor/ : aucun acces reseau externe n'est necessaire ici, et le
// test verifie d'ailleurs qu'aucune requete ne part vers cdn.jsdelivr.net.
// Les scenarios analysent le PDF PRODUIT (pdf.js dans la page pour le texte,
// pdf-lib dans Node pour la structure), pas seulement l'apparition du lien.
const { test, expect } = require("@playwright/test");
const path = require("path");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");
const MOT_ATTENDU = "CONFIDENTIEL";
const ANGLE_TEST = 3; // degres d'inclinaison appliques a l'image de test

/** Branche la collecte des erreurs console / JS et des requetes reseau. */
function surveiller(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const requetes = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("request", (req) => {
    if (/^https?:\/\//.test(req.url())) requetes.push(req.url());
  });
  return { consoleErrors, pageErrors, requetes };
}

function verifierProprete(s) {
  expect(s.consoleErrors, "aucune erreur console attendue : " + s.consoleErrors.join(" | ")).toEqual([]);
  expect(s.pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
  expect(
    s.requetes.filter((u) => !u.startsWith("http://127.0.0.1")),
    "aucune requete externe attendue (langues locales uniquement)"
  ).toEqual([]);
}

/** Recupere les octets du PDF propose au telechargement. */
async function octetsResultat(page) {
  return page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
}

/** Texte de toutes les pages d'un PDF, extrait avec pdf.js dans la page. */
async function texteDuPdf(page, octets) {
  return page.evaluate(async (arr) => {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      out += tc.items.map((it) => it.str).join(" ") + "\n";
    }
    return out;
  }, octets);
}

/**
 * Fabrique un PDF d'une page contenant uniquement une image (aucun texte),
 * sur laquelle plusieurs lignes de texte sont inclinees de ANGLE_TEST degres :
 * le cas typique d'un scan de travers.
 */
async function fabriquerPdfIncline() {
  const lignes = [
    ["DOCUMENT " + MOT_ATTENDU, 64, true],
    ["Rapport annuel de la direction generale", 40, false],
    ["Exercice clos le trente et un decembre", 40, false],
    ["Synthese des resultats et perspectives", 40, false],
    ["Diffusion restreinte aux membres du conseil", 40, false],
    ["Toute reproduction est strictement interdite", 40, false],
  ];
  let y = 220;
  let texteSvg = "";
  for (const [t, taille, gras] of lignes) {
    texteSvg +=
      `<text x="120" y="${y}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" ` +
      `font-size="${taille}" font-weight="${gras ? "bold" : "normal"}" fill="black">${t}</text>`;
    y += taille * 1.9;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1654" height="1000">` +
    `<rect width="100%" height="100%" fill="white"/>${texteSvg}</svg>`;
  const droit = await sharp(Buffer.from(svg)).png().toBuffer();
  const incline = await sharp(droit).rotate(ANGLE_TEST, { background: "white" }).png().toBuffer();
  const meta = await sharp(incline).metadata();

  // Page A4 portrait : l'image occupe la largeur, centree verticalement.
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([595, 842]);
  const img = await doc.embedPng(incline);
  const largeur = 555;
  const hauteur = (largeur * meta.height) / meta.width;
  pdfPage.drawImage(img, { x: 20, y: (842 - hauteur) / 2, width: largeur, height: hauteur });
  return Buffer.from(await doc.save());
}

test("lance l'OCR sur un PDF et propose un telechargement valide", async ({ page }) => {
  test.setTimeout(120000);
  const s = surveiller(page);

  await page.goto("/ocr-pdf.html");
  await page.locator("#fileInput").setInputFiles(FIXTURE_1);

  // OCR force : la fixture contient deja du texte, on veut quand meme exercer le moteur.
  await page.locator("#forceCheck").check();
  const ocrBtn = page.locator("#ocrBtn");
  await expect(ocrBtn).toBeEnabled({ timeout: 15000 });
  await ocrBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 100000 });
  await expect(page.locator("#ocrSummary")).toHaveAttribute("data-pages-ocr", "1");

  const octets = await octetsResultat(page);
  const doc = await PDFDocument.load(Buffer.from(octets));
  expect(doc.getPageCount()).toBe(1);

  verifierProprete(s);
});

test("conserve telle quelle une page deja cherchable (sans OCR force)", async ({ page }) => {
  test.setTimeout(60000);
  const s = surveiller(page);

  // PDF natif (texte vectoriel, aucune image) : l'OCR serait inutile.
  const PHRASE = "Ce document contient deja une couche de texte parfaitement cherchable et selectionnable.";
  const doc = await PDFDocument.create();
  const p = doc.addPage([595, 842]);
  const helv = await doc.embedFont("Helvetica");
  p.drawText(PHRASE, { x: 40, y: 760, size: 11, font: helv });
  const pdfTexte = Buffer.from(await doc.save());

  await page.goto("/ocr-pdf.html");
  await page.locator("#fileInput").setInputFiles({ name: "natif.pdf", mimeType: "application/pdf", buffer: pdfTexte });
  const ocrBtn = page.locator("#ocrBtn");
  await expect(ocrBtn).toBeEnabled({ timeout: 15000 });

  await ocrBtn.click();
  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 30000 });
  const summary = page.locator("#ocrSummary");
  await expect(summary).toHaveAttribute("data-pages-ocr", "0");
  await expect(summary).toHaveAttribute("data-pages-conservees", "1");
  await expect(page.locator("#msg")).toContainText("Forcer l'OCR");

  const octets = await octetsResultat(page);
  const texte = await texteDuPdf(page, octets);
  expect(texte.replace(/\s+/g, " ").trim()).toBe(PHRASE);

  // Aucun moteur OCR n'a ete charge : pas de requete vers le worker Tesseract.
  expect(s.requetes.some((u) => u.includes("/vendor/tesseract-5.1.1/worker"))).toBeFalsy();
  verifierProprete(s);
});

test("redresse une page inclinee de 3 degres et produit un calque texte correct", async ({ page }) => {
  test.setTimeout(150000);
  const s = surveiller(page);
  const pdfIncline = await fabriquerPdfIncline();

  await page.goto("/ocr-pdf.html");
  await page.locator("#fileInput").setInputFiles({
    name: "scan-incline.pdf",
    mimeType: "application/pdf",
    buffer: pdfIncline,
  });

  await expect(page.locator("#deskewCheck")).toBeChecked();
  // Sortie PDF + texte brut.
  await page.locator('#outputSeg button[data-mode="pdf-txt"]').click();

  const ocrBtn = page.locator("#ocrBtn");
  await expect(ocrBtn).toBeEnabled({ timeout: 15000 });
  await ocrBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 120000 });

  // L'angle mesure doit etre proche des 3 degres appliques (pas de 0,25 degre).
  const summary = page.locator("#ocrSummary");
  await expect(summary).toHaveAttribute("data-pages-ocr", "1");
  const angles = (await summary.getAttribute("data-angles")).split(";").filter(Boolean).map(Number);
  expect(angles.length).toBe(1);
  expect(Math.abs(angles[0])).toBeGreaterThanOrEqual(2.5);
  expect(Math.abs(angles[0])).toBeLessThanOrEqual(3.5);
  await expect(summary).toContainText("redressée");

  // Le PDF produit contient le mot attendu dans son calque texte.
  const octets = await octetsResultat(page);
  const texte = await texteDuPdf(page, octets);
  expect(texte).toContain(MOT_ATTENDU);
  const doc = await PDFDocument.load(Buffer.from(octets));
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getWidth()).toBeCloseTo(595, 0);

  // Le texte brut telechargeable contient aussi le mot.
  const txtLink = page.locator("#txtLink");
  await expect(txtLink).toBeVisible();
  const txt = await page.evaluate(async () => {
    const a = document.querySelector("#txtLink");
    return (await fetch(a.href)).text();
  });
  expect(txt).toContain(MOT_ATTENDU);
  expect(txt).toContain("[Page 1]");

  verifierProprete(s);
});

test("avertit avant tout telechargement quand une langue non locale est choisie", async ({ page }) => {
  const s = surveiller(page);

  await page.goto("/ocr-pdf.html");
  await page.locator("#fileInput").setInputFiles(FIXTURE_1);
  await expect(page.locator("#ocrBtn")).toBeEnabled({ timeout: 15000 });

  // Par defaut : francais + anglais, aucun avertissement de reseau public.
  const chips = page.locator("#langChips .lang-chip");
  await expect(chips).toHaveCount(2);
  await expect(page.locator("#msg")).not.toContainText("cdn.jsdelivr.net");

  // Recherche par nom (insensible aux accents) puis selection de l'arabe.
  await page.locator("#langSearch").fill("arab");
  await expect(page.locator("#langList .lang-item:not(.hidden)")).toHaveCount(1);
  await page.locator('#langList input[value="ara"]').check();
  await expect(chips).toHaveCount(3);

  const msg = page.locator("#msg");
  await expect(msg).toBeVisible();
  await expect(msg).toContainText("Arabe");
  await expect(msg).toContainText("réseau public");
  await expect(msg).toContainText("jamais votre document");

  // Rien n'a ete telecharge : l'avertissement precede toute requete externe.
  await page.waitForTimeout(500);
  expect(s.requetes.filter((u) => u.includes("jsdelivr"))).toEqual([]);

  // Retirer la langue via son jeton fait disparaitre l'avertissement.
  await page.locator('#langChips .lang-chip button[aria-label="Retirer Arabe"]').click();
  await expect(chips).toHaveCount(2);
  await expect(msg).not.toBeVisible();

  // Au moins 100 langues proposees, avec leur nom en francais.
  await page.locator("#langSearch").fill("");
  expect(await page.locator("#langList .lang-item").count()).toBeGreaterThanOrEqual(100);
  await expect(page.locator('#langList .lang-item[data-code="jpn"]')).toContainText("Japonais");

  verifierProprete(s);
});
