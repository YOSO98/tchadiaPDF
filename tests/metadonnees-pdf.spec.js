// Tests de bout en bout de l'outil "Metadonnees PDF" : le PDF PRODUIT est
// recupere (blob du lien de telechargement) puis analyse dans Node avec
// pdf-lib, pour verifier le dictionnaire Info ET le paquet XMP (/Metadata).
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream } = require("pdf-lib");

const FIXTURE_1 = path.join(__dirname, "fixtures", "test1.pdf");

/** Lit le paquet XMP du PDF (chaine UTF-8) ou null s'il n'y a pas de /Metadata. */
function readXmp(doc) {
  const ref = doc.catalog.get(PDFName.of("Metadata"));
  if (!ref) return null;
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) return null;
  const dict = stream.dict;
  expect(String(dict.get(PDFName.of("Type")))).toBe("/Metadata");
  expect(String(dict.get(PDFName.of("Subtype")))).toBe("/XML");
  return Buffer.from(decodePDFRawStream(stream).decode()).toString("utf8");
}

/** Verification minimale de XML bien forme : balises equilibrees et aucun caractere de controle. */
function assertWellFormedXml(xml) {
  const body = xml.replace(/<\?[^?]*\?>/g, "");
  const stack = [];
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)([^<>]*?)(\/?)>/g;
  let m;
  let count = 0;
  while ((m = tagRe.exec(body)) !== null) {
    count++;
    if (m[1] === "/") {
      expect(stack.pop(), "balise fermante inattendue " + m[2]).toBe(m[2]);
    } else if (m[4] !== "/") {
      stack.push(m[2]);
    }
  }
  expect(count).toBeGreaterThan(0);
  expect(stack, "balises non fermees").toEqual([]);
  expect(/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(body)).toBe(false);
}

/** Recupere les octets du PDF produit depuis le lien de telechargement. */
async function downloadResultBytes(page) {
  const arr = await page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
  return Buffer.from(arr);
}

function trackErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

function expectNoErrors({ consoleErrors, pageErrors }) {
  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
}

/** Genere un PDF dont le XMP (titre, auteur) diverge du dictionnaire Info. */
async function buildDivergentPdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([300, 300]);
  doc.setTitle("Titre Info");
  doc.setAuthor("Auteur Info");
  doc.setProducer("Producteur Test");
  const xmp =
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Titre XMP different</rdf:li></rdf:Alt></dc:title>' +
    "<dc:creator><rdf:Seq><rdf:li>Auteur Info</rdf:li></rdf:Seq></dc:creator>" +
    "</rdf:Description>" +
    '<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Producer="Producteur Test"/>' +
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/>' +
    '<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="Ndjamena"/>' +
    "</rdf:RDF></x:xmpmeta>\n" +
    '<?xpacket end="w"?>';
  const stream = doc.context.stream(Buffer.from(xmp, "utf8"), { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
  const bytes = await doc.save({ useObjectStreams: false });
  const out = path.join(os.tmpdir(), "tchadia-xmp-divergent-" + process.pid + ".pdf");
  fs.writeFileSync(out, bytes);
  return out;
}

test("ecrit Info et XMP synchronises (titre, auteur, mots-cles) et un XML bien forme", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/metadonnees-pdf.html");
  await page.locator("#fileInput").setInputFiles(FIXTURE_1);
  await expect(page.locator("#metaForm")).toHaveClass(/visible/, { timeout: 15000 });
  await expect(page.locator("#xmpStatus")).toContainText("Aucun paquet XMP");

  await page.locator("#metaTitle").fill("Rapport annuel 2026");
  await page.locator("#metaAuthor").fill("Éric Durand");
  await page.locator("#metaKeywords").fill("rapport, finances, 2026");
  await page.locator("#metaSubject").fill("Bilan & perspectives");
  await page.locator("#metaCreationDate").fill("2026-01-15T09:30");
  await page.locator("#metaLang").fill("fr-FR");
  await page.locator("#metaPageMode").selectOption("UseOutlines");
  await page.locator("#metaPageLayout").selectOption("OneColumn");

  await page.locator("#saveBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });

  const bytes = await downloadResultBytes(page);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.getTitle()).toBe("Rapport annuel 2026");
  expect(doc.getAuthor()).toBe("Éric Durand");
  expect(doc.getKeywords()).toBe("rapport, finances, 2026");
  expect(doc.getSubject()).toBe("Bilan & perspectives");

  // Dates : format PDF avec fuseau, decodable par pdf-lib, et ModDate recente.
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  const creationRaw = info.get(PDFName.of("CreationDate"));
  expect(creationRaw).toBeInstanceOf(PDFString);
  expect(creationRaw.asString()).toMatch(/^D:20260115093000[+-]\d\d'\d\d'$/);
  expect(Date.now() - doc.getModificationDate().getTime()).toBeLessThan(5 * 60 * 1000);

  // Catalogue : langue, mode d'ouverture, mise en page.
  expect(String(doc.catalog.get(PDFName.of("PageMode")))).toBe("/UseOutlines");
  expect(String(doc.catalog.get(PDFName.of("PageLayout")))).toBe("/OneColumn");
  expect(doc.catalog.lookup(PDFName.of("Lang")).decodeText()).toBe("fr-FR");

  // XMP : present, bien forme, synchronise avec Info.
  const xmp = readXmp(doc);
  expect(xmp).not.toBeNull();
  expect(xmp.startsWith('<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>')).toBe(true);
  expect(xmp.trimEnd().endsWith('<?xpacket end="w"?>')).toBe(true);
  assertWellFormedXml(xmp);
  expect(xmp).toMatch(/<dc:title>\s*<rdf:Alt>\s*<rdf:li xml:lang="x-default">Rapport annuel 2026<\/rdf:li>/);
  expect(xmp).toMatch(/<dc:creator>\s*<rdf:Seq>\s*<rdf:li>Éric Durand<\/rdf:li>/);
  expect(xmp).toContain("<pdf:Keywords>rapport, finances, 2026</pdf:Keywords>");
  expect(xmp).toMatch(/<dc:subject>\s*<rdf:Bag>\s*<rdf:li>rapport<\/rdf:li>\s*<rdf:li>finances<\/rdf:li>\s*<rdf:li>2026<\/rdf:li>/);
  expect(xmp).toContain("Bilan &amp; perspectives");
  expect(xmp).toMatch(/<xmp:CreateDate>2026-01-15T09:30:00[+-]\d\d:\d\d<\/xmp:CreateDate>/);
  const modMatch = xmp.match(/<xmp:ModifyDate>([^<]+)<\/xmp:ModifyDate>/);
  expect(modMatch).not.toBeNull();
  expect(Math.abs(new Date(modMatch[1]).getTime() - doc.getModificationDate().getTime())).toBeLessThan(1000);
  expect(xmp).toContain("<pdf:Producer>" + doc.getProducer() + "</pdf:Producer>");

  expectNoErrors(errors);
});

test("signale la divergence Info / XMP et conserve les autres espaces de noms", async ({ page }) => {
  const errors = trackErrors(page);
  const fixture = await buildDivergentPdf();
  await page.goto("/metadonnees-pdf.html");
  await page.locator("#fileInput").setInputFiles(fixture);
  await expect(page.locator("#metaForm")).toHaveClass(/visible/, { timeout: 15000 });

  await expect(page.locator("#xmpStatus")).toContainText("Déclaré PDF/A-2b");
  await expect(page.locator("#xmpStatus")).toContainText("1 divergence");
  const diff = page.locator("#xmpDiffList li");
  await expect(diff).toHaveCount(1);
  await expect(diff.first()).toContainText("Le titre XMP (« Titre XMP different ») diffère du titre Info (« Titre Info »)");
  await expect(page.locator("#metaTitle")).toHaveValue("Titre Info");
  await expect(page.locator("#useXmpBtn")).toBeVisible();

  // Enregistrement sans modification : Info et XMP alignes, pdfaid et photoshop conserves.
  await page.locator("#saveBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  const doc = await PDFDocument.load(await downloadResultBytes(page), { updateMetadata: false });
  expect(doc.getTitle()).toBe("Titre Info");
  const xmp = readXmp(doc);
  assertWellFormedXml(xmp);
  expect(xmp).toContain(">Titre Info</rdf:li>");
  expect(xmp).not.toContain("Titre XMP different");
  expect(xmp).toContain('pdfaid:part="2"');
  expect(xmp).toContain('photoshop:City="Ndjamena"');
  expect(xmp).toContain("<pdf:Producer>Producteur Test</pdf:Producer>");

  expectNoErrors(errors);
});

test("efface toutes les metadonnees : plus de /Metadata ni de Title/Author", async ({ page }) => {
  const errors = trackErrors(page);
  const fixture = await buildDivergentPdf();
  await page.goto("/metadonnees-pdf.html");
  await page.locator("#fileInput").setInputFiles(fixture);
  await expect(page.locator("#metaForm")).toHaveClass(/visible/, { timeout: 15000 });

  await page.locator("#clearAll").check();
  await expect(page.locator("#metaTitle")).toBeDisabled();
  // Le bloc « Outils associés » lie aussi Assainir PDF : on cible le lien du formulaire.
  await expect(page.locator("#metaForm a[href='/assainir-pdf']")).toBeVisible();
  await page.locator("#saveBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });

  const bytes = await downloadResultBytes(page);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
  expect(doc.context.trailerInfo.Info).toBeUndefined();
  expect(doc.getTitle()).toBeUndefined();
  expect(doc.getAuthor()).toBeUndefined();
  expect(doc.getProducer()).toBeUndefined();
  expect(doc.getPageCount()).toBe(1);
  expect(Buffer.from(bytes).toString("latin1")).not.toContain("Titre XMP different");

  expectNoErrors(errors);
});

test("clavier : la dropzone est focusable et le formulaire se parcourt a la tabulation", async ({ page }) => {
  await page.goto("/metadonnees-pdf.html");
  await page.locator("#dropzone").focus();
  await expect(page.locator("#dropzone")).toBeFocused();
  await page.locator("#fileInput").setInputFiles(FIXTURE_1);
  await expect(page.locator("#metaForm")).toHaveClass(/visible/, { timeout: 15000 });
  await page.locator("#metaTitle").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#metaAuthor")).toBeFocused();
});
