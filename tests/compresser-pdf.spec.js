// Tests de bout en bout de l'outil "Compresser PDF". Chaque scenario verifie
// le PDF PRODUIT (octets recuperes depuis le lien de telechargement), analyse
// dans Node avec pdf-lib et sharp : dimensions de l'image reechantillonnee,
// taille du fichier, texte intact, images a masque laissees intactes.
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const os = require("os");
const sharp = require("sharp");
const { PDFDocument, PDFName, PDFRawStream, rgb, StandardFonts } = require("pdf-lib");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");
const CM = 72 / 2.54;

function watchErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return {
    assertClean() {
      expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
      expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
    },
  };
}

/** Lance la compression d'un ou plusieurs fichiers et renvoie les octets du resultat. */
async function compress(page, files, options) {
  options = options || {};
  await page.goto("/compresser-pdf.html");
  await page.locator("#fileInput").setInputFiles(files);
  await expect(page.locator("#fileList .file-item")).toHaveCount(files.length, { timeout: 15000 });
  if (options.profile) await page.locator(`#profileSeg button[data-profile="${options.profile}"]`).click();
  if (options.removeJunk) await page.locator("#removeJunk").check();

  const compressBtn = page.locator("#compressBtn");
  await expect(compressBtn).toBeEnabled();
  await compressBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 25000 });

  const bytes = await page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
  return Buffer.from(bytes);
}

/** Enumere les XObjects image d'un PDF (dictionnaire + contenu brut). */
async function listImages(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const images = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.lookup(PDFName.of("Subtype"));
    if (!subtype || subtype.toString() !== "/Image") continue;
    const filter = obj.dict.lookup(PDFName.of("Filter"));
    images.push({
      filter: filter ? filter.toString() : "",
      width: obj.dict.lookup(PDFName.of("Width")).asNumber(),
      height: obj.dict.lookup(PDFName.of("Height")).asNumber(),
      hasSMask: !!obj.dict.get(PDFName.of("SMask")),
      contents: Buffer.from(obj.contents),
    });
  }
  return { doc, images };
}

/** Genere un PDF A4 contenant une photo JPEG 3000x2000 affichee sur 10 cm de large. */
async function buildPhotoPdf(outPath) {
  const jpeg = await sharp({
    create: { width: 3000, height: 2000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } },
  }).jpeg({ quality: 92 }).toBuffer();

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const img = await doc.embedJpg(jpeg);
  const w = 10 * CM;
  const h = w * (2000 / 3000);
  page.drawImage(img, { x: 50, y: 500, width: w, height: h });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Photo de test tchadiaPdf", { x: 50, y: 470, size: 14, font, color: rgb(0.12, 0.16, 0.23) });
  fs.writeFileSync(outPath, await doc.save());
  return jpeg.length;
}

/** Genere un PDF contenant un PNG RGBA (donc FlateDecode + SMask dans le PDF). */
async function buildTransparentPngPdf(outPath) {
  const png = await sharp({
    create: { width: 400, height: 300, channels: 4, noise: { type: "gaussian", mean: 128, sigma: 40 } },
  }).png().toBuffer();

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 50, y: 400, width: 5 * CM, height: 5 * CM * 0.75 });
  fs.writeFileSync(outPath, await doc.save());
}

/** Genere un PDF avec une photo PNG RGB opaque (FlateDecode 8 bits, sans masque) sur 10 cm, plus des metadonnees XMP. */
async function buildLosslessPhotoPdf(outPath) {
  const png = await sharp({
    create: { width: 1200, height: 800, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } },
  }).png().toBuffer();

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const img = await doc.embedPng(png);
  const w = 10 * CM;
  page.drawImage(img, { x: 50, y: 500, width: w, height: w * (800 / 1200) });
  const xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">" + "A".repeat(4000) + "</rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>";
  const xmpStream = doc.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmpStream));
  fs.writeFileSync(outPath, await doc.save({ useObjectStreams: false }));
}

test.describe("Compresser PDF", () => {
  let tmpDir;
  test.beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tchadia-compresser-"));
  });
  test.afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("profil Web : photo 3000x2000 sur 10 cm reechantillonnee a 96 ppp, fichier reduit d'au moins 70 %", async ({ page }) => {
    const errors = watchErrors(page);
    const src = path.join(tmpDir, "photo.pdf");
    await buildPhotoPdf(src);
    const originalSize = fs.statSync(src).size;

    const out = await compress(page, [src], { profile: "web" });
    console.log(`[mesure] profil Web : ${originalSize} o vers ${out.length} o (gain ${Math.round((1 - out.length / originalSize) * 100)} %)`);

    expect(out.length, "le fichier produit doit etre reduit d'au moins 70 %").toBeLessThan(originalSize * 0.3);
    expect(out.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const { images } = await listImages(out);
    expect(images.length).toBe(1);
    expect(images[0].filter).toBe("/DCTDecode");
    const meta = await sharp(images[0].contents).metadata();
    // 10 cm = 3,94 pouces ; a 96 ppp cela donne 378 px, tolerance jusqu'a ~420 px
    expect(meta.width).toBeLessThanOrEqual(420);
    expect(meta.width).toBeGreaterThanOrEqual(300);
    expect(images[0].width).toBe(meta.width);
    expect(images[0].height).toBe(meta.height);

    await expect(page.locator("#imagesReport")).toContainText("1 ré-échantillonnée(s)");
    await expect(page.locator("#sizeReduction")).toContainText("Réduction de");
    errors.assertClean();
  });

  test("profil Archivage : la photo n'est pas reechantillonnee sous 300 ppp", async ({ page }) => {
    const errors = watchErrors(page);
    const src = path.join(tmpDir, "photo-archive.pdf");
    await buildPhotoPdf(src);

    const out = await compress(page, [src], { profile: "archive" });
    console.log(`[mesure] profil Archivage : ${fs.statSync(src).size} o vers ${out.length} o`);
    const { images } = await listImages(out);
    expect(images.length).toBe(1);
    const meta = await sharp(images[0].contents).metadata();
    // 3,94 pouces a 300 ppp = 1181 px attendus (ou original si deja plus petit)
    expect(meta.width).toBeGreaterThanOrEqual(1100);
    expect(meta.width).toBeLessThanOrEqual(1300);
    errors.assertClean();
  });

  test("PDF texte seul : jamais plus gros, texte intact", async ({ page }) => {
    const errors = watchErrors(page);
    const originalSize = fs.statSync(FIXTURE_1).size;

    const out = await compress(page, [FIXTURE_1], { profile: "web", removeJunk: true });
    console.log(`[mesure] texte seul : ${originalSize} o vers ${out.length} o`);
    expect(out.length).toBeLessThanOrEqual(originalSize);
    expect(out.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Texte de reference extrait avec pdf.js (charge par une page du site qui l'embarque)
    const extractText = async (bytesArray) => {
      await page.goto("/diviser.html");
      await page.waitForFunction(() => !!window.pdfjsLib);
      return page.evaluate(async (arr) => {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
        let text = "";
        for (let p = 1; p <= pdf.numPages; p++) {
          const content = await (await pdf.getPage(p)).getTextContent();
          text += content.items.map((it) => it.str).join(" ") + "\n";
        }
        return { numPages: pdf.numPages, text };
      }, bytesArray);
    };
    const before = await extractText(Array.from(fs.readFileSync(FIXTURE_1)));
    const after = await extractText(Array.from(out));
    expect(after.numPages).toBe(before.numPages);
    expect(after.text.replace(/\s+/g, " ").trim()).toBe(before.text.replace(/\s+/g, " ").trim());
    expect(before.text.trim().length).toBeGreaterThan(0);
    errors.assertClean();
  });

  test("PNG avec transparence : l'image reste en FlateDecode avec son SMask", async ({ page }) => {
    const errors = watchErrors(page);
    const src = path.join(tmpDir, "transparent.pdf");
    await buildTransparentPngPdf(src);
    const originalSize = fs.statSync(src).size;

    const out = await compress(page, [src], { profile: "web" });
    expect(out.length).toBeLessThanOrEqual(originalSize);

    const { images } = await listImages(out);
    const base = images.find((im) => im.hasSMask);
    expect(base, "l'image de base avec SMask doit toujours exister").toBeTruthy();
    expect(base.filter).toBe("/FlateDecode");
    expect(base.width).toBe(400);
    expect(base.height).toBe(300);
    await expect(page.locator("#imagesReport")).toContainText("non traitée(s)");
    errors.assertClean();
  });

  test("profil Web : photo Flate sans perte convertie en JPEG et reechantillonnee, XMP supprime sur demande", async ({ page }) => {
    const errors = watchErrors(page);
    const src = path.join(tmpDir, "photo-flate.pdf");
    await buildLosslessPhotoPdf(src);
    const originalSize = fs.statSync(src).size;

    const out = await compress(page, [src], { profile: "web", removeJunk: true });
    console.log(`[mesure] Flate sans perte vers JPEG : ${originalSize} o vers ${out.length} o (gain ${Math.round((1 - out.length / originalSize) * 100)} %)`);
    expect(out.length).toBeLessThan(originalSize * 0.5);

    const { doc, images } = await listImages(out);
    expect(images.length).toBe(1);
    expect(images[0].filter).toBe("/DCTDecode");
    const meta = await sharp(images[0].contents).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeLessThanOrEqual(420);
    expect(doc.catalog.get(PDFName.of("Metadata")), "le flux XMP doit avoir ete retire").toBeUndefined();
    expect(out.toString("latin1")).not.toContain("xpacket");
    await expect(page.locator("#imagesReport")).toContainText("1 convertie(s) en JPEG");
    errors.assertClean();
  });

  test("lot de deux fichiers : archive ZIP et resume par ligne", async ({ page }) => {
    const errors = watchErrors(page);
    const src = path.join(tmpDir, "photo-lot.pdf");
    await buildPhotoPdf(src);

    const out = await compress(page, [src, FIXTURE_1], { profile: "print" });
    // Signature ZIP "PK\x03\x04"
    expect(out.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
    const statuses = await page.locator("#fileList .f-status").allTextContents();
    expect(statuses.length).toBe(2);
    expect(statuses[0]).toMatch(/^Terminé : .* gain \d+ %$/);
    expect(statuses[1]).toMatch(/^(Déjà optimisé|Terminé)/);
    errors.assertClean();
  });

  test("navigation clavier : les profils et options sont accessibles", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/compresser-pdf.html");
    await page.locator("#fileInput").setInputFiles(FIXTURE_1);
    await expect(page.locator("#qualityOptions")).toBeVisible();

    await page.locator('#profileSeg button[data-profile="custom"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#customOptions")).toBeVisible();
    await expect(page.locator('#profileSeg button[data-profile="custom"]')).toHaveAttribute("aria-pressed", "true");

    await page.locator("#dpiInput").fill("1000");
    await page.locator("#dpiInput").dispatchEvent("change");
    await expect(page.locator("#dpiInput")).toHaveValue("600");

    await page.locator('#profileSeg button[data-profile="web"]').click();
    await expect(page.locator("#customOptions")).toBeHidden();
    await expect(page.locator("#linearize")).toBeChecked();
    await page.locator('#profileSeg button[data-profile="print"]').click();
    await expect(page.locator("#linearize")).not.toBeChecked();
    errors.assertClean();
  });
});
