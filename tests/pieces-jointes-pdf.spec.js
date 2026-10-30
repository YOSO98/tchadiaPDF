// Tests de bout en bout de l'outil "Pieces jointes PDF". Chaque test verifie
// le PDF (ou le fichier) PRODUIT, pas seulement l'affichage :
//   1. ajout de "preuve.txt" (contenu connu) et d'un petit PNG a test1.pdf :
//      le PDF produit, relu avec pdf-lib dans Node, contient dans
//      /Names /EmbeddedFiles exactement deux entrees, dont "preuve.txt" avec
//      un flux decode egal au contenu d'origine (et la description saisie) ;
//   2. rechargement de ce PDF dans l'outil : les deux pieces jointes sont
//      listees avec les bonnes tailles ; l'extraction de "preuve.txt" rend
//      les octets d'origine ; l'archive ZIP "Tout extraire" les contient ;
//   3. suppression de "preuve.txt" : le nom est absent des octets bruts du
//      nouveau PDF (enregistre sans flux d'objets), le PNG reste intact.
// Les tests s'enchainent (mode serie) car 2 et 3 relisent le PDF produit en 1.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, decodePDFRawStream } = require("pdf-lib");
const JSZip = require("../vendor/jszip-3.10.1.min.js");

test.describe.configure({ mode: "serial" });

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");
const PREUVE_CONTENT = Buffer.from("Contenu de preuve tchadiaPdf, ligne 1\nligne 2 : 1234567890 ABCDEF\n", "utf8");
// PNG 1x1 pixel valide (signature PNG reconnue par sniffFileType).
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const DESCRIPTION = "Justificatif numero 1";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tchadia-pieces-jointes-"));
const preuvePath = path.join(tmpDir, "preuve.txt");
const pngPath = path.join(tmpDir, "pixel.png");
const producedPath = path.join(tmpDir, "avec-pieces-jointes.pdf");
fs.writeFileSync(preuvePath, PREUVE_CONTENT);
fs.writeFileSync(pngPath, PNG_BYTES);

function collectErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return {
    assertNone() {
      expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
      expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
    },
  };
}

async function fetchResultBytes(page) {
  const arr = await page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
  return Buffer.from(arr);
}

function textOf(obj) {
  return obj && typeof obj.decodeText === "function" ? obj.decodeText() : "";
}

/** Lit, avec pdf-lib dans Node, les entrees de /Names /EmbeddedFiles (arbre a plat ou avec /Kids). */
async function listEmbeddedFiles(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const ctx = doc.context;
  const out = [];
  const namesDict = doc.catalog.lookup(PDFName.of("Names"));
  if (!(namesDict instanceof PDFDict)) return { doc, entries: out };
  const walk = (nodeObj) => {
    const node = ctx.lookup(nodeObj);
    if (!(node instanceof PDFDict)) return;
    const names = node.lookup(PDFName.of("Names"));
    if (names instanceof PDFArray) {
      for (let i = 0; i + 1 < names.size(); i += 2) {
        const key = textOf(names.lookup(i));
        const spec = names.lookup(i + 1);
        if (!(spec instanceof PDFDict)) continue;
        const name = textOf(spec.lookup(PDFName.of("UF"))) || textOf(spec.lookup(PDFName.of("F")));
        const desc = textOf(spec.lookup(PDFName.of("Desc")));
        const ef = spec.lookup(PDFName.of("EF"));
        let content = null;
        let mime = "";
        if (ef instanceof PDFDict) {
          const stream = ef.lookup(PDFName.of("F")) || ef.lookup(PDFName.of("UF"));
          if (stream instanceof PDFStream) {
            content = Buffer.from(decodePDFRawStream(stream).decode());
            const subtype = stream.dict.lookup(PDFName.of("Subtype"));
            mime = subtype instanceof PDFName ? subtype.decodeText() : "";
          }
        }
        out.push({ key, name, desc, mime, content });
      }
    }
    const kids = node.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) walk(kids.get(i));
  };
  const efTree = namesDict.get(PDFName.of("EmbeddedFiles"));
  if (efTree) walk(efTree);
  return { doc, entries: out };
}

test("ajoute preuve.txt et un PNG : le PDF produit contient les deux flux intacts", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/pieces-jointes-pdf.html");

  await page.locator("#fileInput").setInputFiles(FIXTURE_1);
  await expect(page.locator("#pjPanel")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#pjEmpty")).toBeVisible();
  await expect(page.locator("#saveBtn")).toBeDisabled();

  await page.locator("#addInput").setInputFiles([preuvePath, pngPath]);
  const addedItems = page.locator("#pjAddList .pj-item");
  await expect(addedItems).toHaveCount(2);
  await expect(addedItems.nth(0)).toContainText("preuve.txt");
  await expect(addedItems.nth(0)).toContainText("text/plain");
  await expect(addedItems.nth(1)).toContainText("pixel.png");
  await expect(addedItems.nth(1)).toContainText("image/png");
  await page.locator("#pjAddList .pj-desc-input").first().fill(DESCRIPTION);

  const saveBtn = page.locator("#saveBtn");
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });

  const produced = await fetchResultBytes(page);
  fs.writeFileSync(producedPath, produced);

  const original = await PDFDocument.load(fs.readFileSync(FIXTURE_1), { updateMetadata: false });
  const { doc, entries } = await listEmbeddedFiles(produced);
  expect(doc.getPageCount()).toBe(original.getPageCount());
  expect(entries.length).toBe(2);
  expect(entries.map((e) => e.name).sort()).toEqual(["pixel.png", "preuve.txt"]);
  expect(entries.map((e) => e.key).sort()).toEqual(["pixel.png", "preuve.txt"]);

  const preuve = entries.find((e) => e.name === "preuve.txt");
  expect(Buffer.compare(preuve.content, PREUVE_CONTENT)).toBe(0);
  expect(preuve.desc).toBe(DESCRIPTION);
  expect(preuve.mime).toBe("text/plain");

  const png = entries.find((e) => e.name === "pixel.png");
  expect(Buffer.compare(png.content, PNG_BYTES)).toBe(0);
  expect(png.mime).toBe("image/png");

  errors.assertNone();
});

test("recharge le PDF produit : liste les deux pieces jointes et extrait preuve.txt a l'identique", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/pieces-jointes-pdf.html");

  await page.locator("#fileInput").setInputFiles(producedPath);
  const items = page.locator("#pjList .pj-item");
  await expect(items).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator("#pjTitle")).toHaveText("Pièces jointes (2)");

  const preuveItem = items.filter({ hasText: "preuve.txt" });
  await expect(preuveItem).toContainText(PREUVE_CONTENT.length + " o");
  await expect(preuveItem).toContainText("text/plain");
  await expect(preuveItem).toContainText(DESCRIPTION);
  const pngItem = items.filter({ hasText: "pixel.png" });
  await expect(pngItem).toContainText(PNG_BYTES.length + " o");
  await expect(pngItem).toContainText("image/png");

  // Extraction unitaire : le fichier telecharge est identique a l'original.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Extraire preuve.txt" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("preuve.txt");
  const extracted = fs.readFileSync(await download.path());
  expect(Buffer.compare(extracted, PREUVE_CONTENT)).toBe(0);

  // Extraction groupee : l'archive ZIP contient les deux fichiers intacts.
  const [zipDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#extractAllBtn").click(),
  ]);
  expect(zipDownload.suggestedFilename()).toMatch(/\.zip$/);
  const zip = await JSZip.loadAsync(fs.readFileSync(await zipDownload.path()));
  expect(Object.keys(zip.files).sort()).toEqual(["pixel.png", "preuve.txt"]);
  expect(Buffer.compare(Buffer.from(await zip.file("preuve.txt").async("uint8array")), PREUVE_CONTENT)).toBe(0);
  expect(Buffer.compare(Buffer.from(await zip.file("pixel.png").async("uint8array")), PNG_BYTES)).toBe(0);

  // Sans modification en attente, rien a enregistrer.
  await expect(page.locator("#saveBtn")).toBeDisabled();

  errors.assertNone();
});

test("supprime preuve.txt : le nom disparait des octets bruts du nouveau PDF, le PNG reste", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/pieces-jointes-pdf.html");

  await page.locator("#fileInput").setInputFiles(producedPath);
  await expect(page.locator("#pjList .pj-item")).toHaveCount(2, { timeout: 15000 });

  await page.getByRole("button", { name: "Supprimer preuve.txt" }).click();
  await expect(page.locator("#pjList .pj-item").filter({ hasText: "preuve.txt" })).toHaveClass(/pj-deleted/);
  await expect(page.getByRole("button", { name: "Annuler la suppression de preuve.txt" })).toBeVisible();

  const saveBtn = page.locator("#saveBtn");
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  // La suppression chirurgicale a suffi : pas de message de reconstruction.
  await expect(page.locator("#msg")).not.toHaveClass(/visible/);

  const produced = await fetchResultBytes(page);

  // Octets bruts : ni le nom en clair, ni sa forme hexadecimale UTF-16BE
  // (telle que pdf-lib ecrit les chaines de noms), ni le contenu du fichier.
  const raw = produced.toString("latin1");
  expect(raw).not.toContain("preuve.txt");
  const hexUtf16 = Buffer.from("preuve.txt", "utf16le").swap16().toString("hex");
  expect(raw.toLowerCase()).not.toContain(hexUtf16);
  expect(raw).not.toContain("Contenu de preuve");
  // Le PNG, lui, est toujours nomme dans le fichier.
  expect(raw).toContain("pixel.png");

  const before = await PDFDocument.load(fs.readFileSync(producedPath), { updateMetadata: false });
  const { doc, entries } = await listEmbeddedFiles(produced);
  expect(doc.getPageCount()).toBe(before.getPageCount());
  expect(entries.length).toBe(1);
  expect(entries[0].name).toBe("pixel.png");
  expect(Buffer.compare(entries[0].content, PNG_BYTES)).toBe(0);

  errors.assertNone();
});
