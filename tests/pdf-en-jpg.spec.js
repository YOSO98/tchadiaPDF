// Tests de bout en bout de l'outil "PDF en JPG, PNG, TIFF ou WebP" : chaque
// test recupere le FICHIER PRODUIT (blob du lien de telechargement) et
// l'analyse dans Node (sharp, jszip) : dimensions, format, nombre d'images.
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const os = require("os");
const sharp = require("sharp");
const JSZip = require("jszip");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf"); // 1 page, 300 x 200 pt
const PAGE_W_PT = 300;
const PAGE_H_PT = 200;

// PDF de 3 pages (tailles differentes) genere a la volee pour les tests
// de plage et de TIFF multi-page.
let MULTI_PDF;
test.beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sizes = [[300, 200], [200, 300], [400, 250]];
  sizes.forEach(([w, h], i) => {
    const page = doc.addPage([w, h]);
    page.drawRectangle({ x: 10, y: 10, width: w - 20, height: h - 20, color: rgb(0.2, 0.4, 0.9) });
    page.drawText("Page " + (i + 1), { x: 30, y: h / 2, size: 36, font, color: rgb(1, 1, 1) });
  });
  MULTI_PDF = path.join(os.tmpdir(), "tchadiapdf-multi-" + process.pid + ".pdf");
  fs.writeFileSync(MULTI_PDF, await doc.save());
});
test.afterAll(() => {
  try { fs.unlinkSync(MULTI_PDF); } catch (e) { /* deja supprime */ }
});

function watchErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return () => {
    expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
    expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
  };
}

async function loadTool(page, fixture) {
  await page.goto("/pdf-en-jpg.html");
  await page.locator("#fileInput").setInputFiles(fixture);
  await expect(page.locator("#imgOptions")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#convertBtn")).toBeEnabled();
}

async function choose(page, segId, attr, value) {
  await page.locator("#" + segId + " button[data-" + attr + '="' + value + '"]').click();
}

/** Lance la conversion et renvoie { buffer, filename } du fichier produit. */
async function convertAndFetch(page) {
  // Une conversion precedente peut avoir laisse un resultat affiche : on
  // memorise son lien pour attendre que le nouveau blob le remplace, sinon
  // la lecture peut porter sur l'ancien fichier (course observee en CI).
  const previousHref = await page.locator("#result a.btn-primary").getAttribute("href");
  await page.locator("#convertBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 30000 });
  await expect
    .poll(() => page.locator("#result a.btn-primary").getAttribute("href"), { timeout: 30000 })
    .not.toBe(previousHref);
  const out = await page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return { bytes: Array.from(new Uint8Array(buf)), filename: a.download };
  });
  return { buffer: Buffer.from(out.bytes), filename: out.filename };
}

test("PNG a 150 ppp : dimensions attendues, lues par sharp", async ({ page }) => {
  const check = watchErrors(page);
  await loadTool(page, FIXTURE_1);
  await choose(page, "formatSeg", "f", "png");
  await choose(page, "resSeg", "ppp", "150");

  // L'apercu de la premiere page s'affiche avec les dimensions et une estimation.
  await expect(page.locator("#previewWrap")).toHaveClass(/visible/);
  await expect(page.locator("#previewCaption")).toContainText("625 × 417 px", { timeout: 15000 });
  await expect(page.locator("#previewCaption")).toContainText("Taille estimée");
  await expect(page.locator("#previewImg")).toHaveJSProperty("naturalWidth", 625, { timeout: 15000 });

  const { buffer, filename } = await convertAndFetch(page);
  expect(filename).toBe("test1-page-001.png"); // 1 page : image directe, pas de ZIP

  const meta = await sharp(buffer).metadata();
  expect(meta.format).toBe("png");
  expect(Math.abs(meta.width - Math.round(PAGE_W_PT * 150 / 72))).toBeLessThanOrEqual(2);
  expect(Math.abs(meta.height - Math.round(PAGE_H_PT * 150 / 72))).toBeLessThanOrEqual(2);
  check();
});

test("PNG a 300 ppp dans un ZIP : une image par page avec les bonnes dimensions", async ({ page }) => {
  const check = watchErrors(page);
  await loadTool(page, MULTI_PDF);
  await choose(page, "formatSeg", "f", "png");
  await choose(page, "resSeg", "ppp", "300");

  const { buffer, filename } = await convertAndFetch(page);
  expect(filename).toMatch(/\.zip$/);
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual([
    "tchadiapdf-multi-" + process.pid + "-page-001.png",
    "tchadiapdf-multi-" + process.pid + "-page-002.png",
    "tchadiapdf-multi-" + process.pid + "-page-003.png",
  ]);
  const expected = [[300, 200], [200, 300], [400, 250]];
  for (let i = 0; i < names.length; i++) {
    const meta = await sharp(await zip.files[names[i]].async("nodebuffer")).metadata();
    expect(meta.format).toBe("png");
    expect(Math.abs(meta.width - Math.round(expected[i][0] * 300 / 72))).toBeLessThanOrEqual(2);
    expect(Math.abs(meta.height - Math.round(expected[i][1] * 300 / 72))).toBeLessThanOrEqual(2);
  }
  check();
});

test("JPG : la qualite basse produit un fichier plus petit que la qualite haute", async ({ page }) => {
  const check = watchErrors(page);
  await loadTool(page, FIXTURE_1);
  await choose(page, "formatSeg", "f", "jpg");
  await choose(page, "resSeg", "ppp", "300");

  await page.locator("#qualityRange").fill("20");
  await expect(page.locator("#qualityValue")).toHaveText("20");
  const low = await convertAndFetch(page);
  expect(low.filename).toBe("test1-page-001.jpg");

  await page.locator("#qualityRange").fill("100");
  await expect(page.locator("#qualityValue")).toHaveText("100");
  const high = await convertAndFetch(page);

  expect((await sharp(low.buffer).metadata()).format).toBe("jpeg");
  expect((await sharp(high.buffer).metadata()).format).toBe("jpeg");
  expect(low.buffer.length).toBeLessThan(high.buffer.length);
  check();
});

test("Plage « 1 » sur un PDF de 3 pages : une seule image, directe", async ({ page }) => {
  const check = watchErrors(page);
  await loadTool(page, MULTI_PDF);
  await choose(page, "formatSeg", "f", "jpg");
  await choose(page, "pagesSeg", "p", "range");
  await page.locator("#pageRange").fill("1");

  const { buffer, filename } = await convertAndFetch(page);
  expect(filename).toBe("tchadiapdf-multi-" + process.pid + "-page-001.jpg");
  const meta = await sharp(buffer).metadata();
  expect(meta.format).toBe("jpeg");
  expect(Math.abs(meta.width - Math.round(300 * 150 / 72))).toBeLessThanOrEqual(2);
  check();
});

test("Plage « 3, 1-2 » : trois images numerotees, et plage invalide signalee", async ({ page }) => {
  const check = watchErrors(page);
  await loadTool(page, MULTI_PDF);
  await choose(page, "formatSeg", "f", "webp");
  await choose(page, "resSeg", "ppp", "72");
  await choose(page, "pagesSeg", "p", "range");

  await page.locator("#pageRange").fill("2-9");
  await page.locator("#convertBtn").click();
  await expect(page.locator("#msg")).toContainText("La page 9 n'existe pas");

  await page.locator("#pageRange").fill("3, 1-2");
  const { buffer, filename } = await convertAndFetch(page);
  expect(filename).toMatch(/-images-webp\.zip$/);
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).sort();
  expect(names.map((n) => n.slice(-13))).toEqual(["page-001.webp", "page-002.webp", "page-003.webp"]);
  const meta = await sharp(await zip.files[names[0]].async("nodebuffer")).metadata();
  expect(meta.format).toBe("webp");
  expect(meta.width).toBe(300); // 72 ppp : 1 pt = 1 px
  check();
});

test("TIFF multi-page : en-tete valide, 3 pages lisibles par sharp, resolution inscrite", async ({ page }) => {
  const check = watchErrors(page);
  await loadTool(page, MULTI_PDF);
  await choose(page, "formatSeg", "f", "tiff");
  await choose(page, "resSeg", "ppp", "150");

  const { buffer, filename } = await convertAndFetch(page);
  expect(filename).toBe("tchadiapdf-multi-" + process.pid + ".tif");

  const magic = buffer.subarray(0, 4);
  const isLE = magic.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])); // II*\0
  const isBE = magic.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])); // MM\0*
  expect(isLE || isBE).toBeTruthy();

  const meta = await sharp(buffer).metadata();
  expect(meta.format).toBe("tiff");
  expect(meta.pages).toBe(3);
  expect(meta.channels).toBe(3);
  expect(Math.abs(meta.width - Math.round(300 * 150 / 72))).toBeLessThanOrEqual(2);
  expect(Math.abs(meta.height - Math.round(200 * 150 / 72))).toBeLessThanOrEqual(2);
  expect(Math.round(meta.density)).toBe(150);

  // Chaque page se decode et a les bonnes dimensions ; la page 2 est en portrait.
  const p2 = await sharp(buffer, { page: 1 }).metadata();
  expect(Math.abs(p2.width - Math.round(200 * 150 / 72))).toBeLessThanOrEqual(2);
  expect(Math.abs(p2.height - Math.round(300 * 150 / 72))).toBeLessThanOrEqual(2);
  const raw = await sharp(buffer, { page: 2 }).raw().toBuffer({ resolveWithObject: true });
  expect(raw.info.width).toBe(Math.round(400 * 150 / 72));
  // Le rectangle bleu occupe le centre : le pixel central n'est pas blanc.
  const center = (Math.floor(raw.info.height / 2) * raw.info.width + Math.floor(raw.info.width / 2)) * raw.info.channels;
  expect(raw.data[center]).toBeLessThan(120);
  expect(raw.data[center + 2]).toBeGreaterThan(180);
  check();
});

test("TIFF en niveaux de gris : un seul canal", async ({ page }) => {
  const check = watchErrors(page);
  await loadTool(page, FIXTURE_1);
  await choose(page, "formatSeg", "f", "tiff");
  await page.locator("#graySwitch").check();

  const { buffer } = await convertAndFetch(page);
  const meta = await sharp(buffer).metadata();
  expect(meta.format).toBe("tiff");
  expect(meta.pages).toBe(1);
  expect(meta.channels).toBe(1);
  check();
});

test("PNG en niveaux de gris : les pixels ont R = V = B", async ({ page }) => {
  const check = watchErrors(page);
  await loadTool(page, MULTI_PDF);
  await choose(page, "formatSeg", "f", "png");
  await choose(page, "resSeg", "ppp", "72");
  await choose(page, "pagesSeg", "p", "range");
  await page.locator("#pageRange").fill("1");
  await page.locator("#graySwitch").check();

  const { buffer } = await convertAndFetch(page);
  const raw = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const c = raw.info.channels;
  let colored = 0;
  for (let i = 0; i < raw.data.length; i += c) {
    if (raw.data[i] !== raw.data[i + 1] || raw.data[i + 1] !== raw.data[i + 2]) colored++;
  }
  expect(colored).toBe(0);
  check();
});

test("Avertissement memoire a 600 ppp sur une grande page, et mode lot", async ({ page }) => {
  const check = watchErrors(page);
  // Page A3 (842 x 1191 pt) : a 600 ppp, environ 70 Mpx.
  const doc = await PDFDocument.create();
  doc.addPage([842, 1191]);
  const a3 = path.join(os.tmpdir(), "tchadiapdf-a3-" + process.pid + ".pdf");
  fs.writeFileSync(a3, await doc.save());
  try {
    await loadTool(page, a3);
    await choose(page, "resSeg", "ppp", "600");
    await expect(page.locator("#msg")).toContainText("Mpx");
    await choose(page, "resSeg", "ppp", "300");
    await expect(page.locator("#msg")).not.toHaveClass(/visible/);

    // Mode lot : deux PDF, format JPG, ZIP avec un prefixe par fichier.
    await page.locator("#fileInput").setInputFiles([FIXTURE_1, MULTI_PDF]);
    await expect(page.locator("#fileList .file-item")).toHaveCount(2);
    await choose(page, "formatSeg", "f", "jpg");
    await choose(page, "resSeg", "ppp", "72");
    await page.locator("#startBatchBtn").click();
    await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 30000 });
    const out = await page.evaluate(async () => {
      const a = document.querySelector("#result a.btn-primary");
      const buf = await (await fetch(a.href)).arrayBuffer();
      return { bytes: Array.from(new Uint8Array(buf)), filename: a.download };
    });
    expect(out.filename).toBe("tchadiapdf-images-lot.zip");
    const zip = await JSZip.loadAsync(Buffer.from(out.bytes));
    const names = Object.keys(zip.files).sort();
    expect(names).toHaveLength(4);
    expect(names[0]).toBe("tchadiapdf-multi-" + process.pid + "-page-001.jpg");
    expect(names[3]).toBe("test1-page-001.jpg");
  } finally {
    try { fs.unlinkSync(a3); } catch (e) { /* deja supprime */ }
  }
  check();
});
