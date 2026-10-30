// Signature numérique PAdES (signer-pdf) : le PDF produit est rouvert et
// vérifié, pas seulement l'interface.
//
// Vérifications sur le fichier téléchargé :
//  - /ByteRange [0 a b c] couvre tout le fichier sauf exactement la valeur
//    hexadécimale de /Contents ;
//  - /Contents contient une signature CMS SignedData (ContentInfo), dont
//    l'attribut message-digest est égal au SHA-256 (calculé ici, côté Node)
//    des octets couverts, et que pkijs vérifie cryptographiquement ;
//  - une altération d'un seul octet couvert fait échouer la vérification ;
//  - pdf-lib rouvre le fichier : même nombre de pages, champ /FT /Sig,
//    /SubFilter /ETSI.CAdES.detached, /Filter /Adobe.PPKLite.
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PDFDocument, PDFName, PDFDict, PDFArray } = require("pdf-lib");

const FIXTURE_PDF = path.join(__dirname, "fixtures", "test1.pdf");
const CERTS = path.join(__dirname, "fixtures", "certificats");
const MDP = "test1234";

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_CERT_V2 = "1.2.840.113549.1.9.16.2.47";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";

/** Découpe le PDF signé selon son /ByteRange. */
function analyserByteRange(pdf) {
  const texte = pdf.toString("latin1");
  const occurrences = texte.match(/\/ByteRange\s*\[/g) || [];
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(texte);
  expect(m, "/ByteRange numérique présent").not.toBeNull();
  const [a, b, c, d] = m.slice(1).map(Number);
  const trou = texte.slice(b, c);
  return { occurrences: occurrences.length, a, b, c, d, trou };
}

function octetsCouverts(pdf, br) {
  return Buffer.concat([pdf.subarray(br.a, br.a + br.b), pdf.subarray(br.c, br.c + br.d)]);
}

/** Vérifie le CMS dans la page (pkijs vendorisé, déjà chargé par l'outil). */
async function verifierCmsDansLaPage(page, cmsDer, contenu) {
  return page.evaluate(async ({ cmsB64, contenuB64, oids }) => {
    const { pkijs, asn1js } = window.TchadiaPadesLibs;
    const versAB = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
    const asn = asn1js.fromBER(versAB(cmsB64));
    const ci = new pkijs.ContentInfo({ schema: asn.result });
    const sd = new pkijs.SignedData({ schema: ci.content });
    const si = sd.signerInfos[0];
    const attrs = si.signedAttrs.attributes;
    const md = attrs.find((x) => x.type === oids.md);
    let verifie = false;
    try {
      verifie = await sd.verify({ signer: 0, data: versAB(contenuB64), checkChain: false });
    } catch (e) {
      verifie = false;
    }
    return {
      contentType: ci.contentType,
      eContentPresent: !!sd.encapContentInfo.eContent,
      nbCertificats: sd.certificates.length,
      digestAlgo: si.digestAlgorithm.algorithmId,
      messageDigest: md ? hex(md.values[0].valueBlock.valueHexView) : null,
      aSigningCertV2: attrs.some((x) => x.type === oids.scv2),
      aSigningTime: attrs.some((x) => x.type === oids.st),
      verifie,
    };
  }, {
    cmsB64: Buffer.from(cmsDer).toString("base64"),
    contenuB64: Buffer.from(contenu).toString("base64"),
    oids: { md: OID_MESSAGE_DIGEST, scv2: OID_SIGNING_CERT_V2, st: OID_SIGNING_TIME },
  });
}

async function chargerPdf(page) {
  await page.goto("/signer-pdf.html");
  await page.locator("#fileInput").setInputFiles(FIXTURE_PDF);
  await expect(page.locator("#padesSection")).toBeVisible({ timeout: 15000 });
}

async function dessinerSignature(page) {
  const sigCanvas = page.locator("#sigCanvas");
  await sigCanvas.scrollIntoViewIfNeeded();
  const box = await sigCanvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
  await page.mouse.move(box.x + 140, box.y + 20, { steps: 5 });
  await page.mouse.up();
}

async function ouvrirCertificat(page, fichier, mdp) {
  await page.locator("#padesActive").check();
  await page.locator("#p12Input").setInputFiles(path.join(CERTS, fichier));
  await page.locator("#p12Password").fill(mdp);
  await page.locator("#p12LoadBtn").click();
}

async function signerEtTelecharger(page) {
  await expect(page.locator("#signBtn")).toBeEnabled({ timeout: 5000 });
  await page.locator("#signBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#result a.btn-primary").click(),
  ]);
  const pdf = fs.readFileSync(await download.path());
  // Facultatif : PADES_SORTIE=dossier conserve les PDF signés pour une
  // validation externe (pyHanko, Adobe Acrobat), voir fixtures/certificats/LISEZMOI.md.
  if (process.env.PADES_SORTIE) {
    fs.writeFileSync(path.join(process.env.PADES_SORTIE, test.info().title.slice(0, 20).replace(/\W+/g, "-") + ".pdf"), pdf);
  }
  return pdf;
}

/** Contrôles communs à tout PDF signé PAdES par l'outil. */
async function verifierPdfSigne(page, pdf, { nbCertificats }) {
  // 1. /ByteRange : couvre tout le fichier sauf la valeur de /Contents.
  const br = analyserByteRange(pdf);
  expect(br.occurrences, "une seule signature").toBe(1);
  expect(br.a).toBe(0);
  expect(br.b).toBeGreaterThan(0);
  expect(br.c).toBeGreaterThan(br.b);
  expect(br.c + br.d, "le ByteRange va jusqu'à la fin du fichier").toBe(pdf.length);
  expect(br.trou.startsWith("<") && br.trou.endsWith(">"), "le trou est exactement la chaîne hexadécimale de /Contents").toBe(true);
  expect(/^<[0-9a-fA-F]+>$/.test(br.trou)).toBe(true);
  expect(pdf.toString("latin1", br.b - 12, br.b)).toContain("/Contents");

  // 2. Le CMS : ContentInfo SignedData, détaché, empreinte = SHA-256 des octets couverts.
  const cmsHex = br.trou.slice(1, -1).replace(/(00)+$/, "");
  const cmsDer = Buffer.from(cmsHex.length % 2 ? cmsHex + "0" : cmsHex, "hex");
  expect(cmsDer[0], "DER SEQUENCE").toBe(0x30);
  const contenu = octetsCouverts(pdf, br);
  const empreinte = crypto.createHash("sha256").update(contenu).digest("hex");

  const r = await verifierCmsDansLaPage(page, cmsDer, contenu);
  expect(r.contentType).toBe(OID_SIGNED_DATA);
  expect(r.eContentPresent, "signature détachée (pas de contenu encapsulé)").toBe(false);
  expect(r.digestAlgo).toBe("2.16.840.1.101.3.4.2.1"); // SHA-256
  expect(r.messageDigest).toBe(empreinte);
  expect(r.aSigningCertV2, "attribut signing-certificate-v2 (exigé par PAdES)").toBe(true);
  expect(r.aSigningTime, "pas d'attribut signing-time (interdit par PAdES B-B)").toBe(false);
  expect(r.nbCertificats).toBe(nbCertificats);
  expect(r.verifie, "signature cryptographiquement valide").toBe(true);

  // 3. Une altération d'un seul octet couvert doit invalider la signature.
  const altere = Buffer.from(contenu);
  altere[Math.floor(br.b / 2)] ^= 0x01;
  const rAltere = await verifierCmsDansLaPage(page, cmsDer, altere);
  expect(rAltere.verifie, "signature invalide après altération").toBe(false);

  // 4. Réouverture avec pdf-lib : structure PDF de la signature.
  const doc = await PDFDocument.load(pdf);
  const original = await PDFDocument.load(fs.readFileSync(FIXTURE_PDF));
  expect(doc.getPageCount()).toBe(original.getPageCount());
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
  expect(acroForm.lookup(PDFName.of("SigFlags")).asNumber() & 3).toBe(3);
  const champs = acroForm.lookup(PDFName.of("Fields"), PDFArray).asArray().map((ref) => doc.context.lookup(ref, PDFDict));
  const champSig = champs.find((f) => String(f.get(PDFName.of("FT"))) === "/Sig");
  expect(champSig, "champ de signature /FT /Sig").toBeTruthy();
  const v = champSig.lookup(PDFName.of("V"));
  // Le dictionnaire de signature est sérialisé « brut » par @signpdf : on le lit dans le texte.
  const dictSig = pdf.toString("latin1", Math.max(0, br.b - 400), br.c + 600);
  expect(dictSig).toMatch(/\/Type\s*\/Sig/);
  expect(dictSig).toMatch(/\/Filter\s*\/Adobe\.PPKLite/);
  expect(dictSig).toMatch(/\/SubFilter\s*\/ETSI\.CAdES\.detached/);
  return { champSig, v, doc };
}

test.describe("signer-pdf : signature numérique PAdES", () => {
  test("certificat RSA avec chaîne + signature dessinée : PDF signé valide", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    // Aucune requête ne doit envoyer de données (ni POST, ni corps de requête).
    const envois = [];
    page.on("request", (req) => {
      if (req.method() !== "GET" || req.postData()) envois.push(req.method() + " " + req.url());
    });
    const vendor = [];
    page.on("request", (req) => { if (req.url().includes("pades-libs")) vendor.push(req.url()); });

    await chargerPdf(page);
    await dessinerSignature(page);
    await ouvrirCertificat(page, "rsa-chaine.p12", MDP);
    await page.locator("#padesReason").fill("J'approuve ce document");
    await page.locator("#padesLocation").fill("N'Djamena");
    await expect(page.locator("#p12Info")).toContainText("Signataire de test", { timeout: 15000 });
    await expect(page.locator("#p12Info")).toContainText("Autorite de test tchadiaPdf");
    await expect(page.locator("#p12Password")).toHaveValue("");

    const pdf = await signerEtTelecharger(page);
    const { champSig } = await verifierPdfSigne(page, pdf, { nbCertificats: 2 });

    // Signature visible : le widget occupe l'emplacement de la signature dessinée.
    const rect = champSig.lookup(PDFName.of("Rect"), PDFArray).asArray().map((n) => n.asNumber());
    expect(rect[2] - rect[0]).toBeGreaterThan(10);
    expect(rect[3] - rect[1]).toBeGreaterThan(5);
    const texte = pdf.toString("latin1");
    expect(texte).toContain("(J'approuve ce document)");
    expect(texte).toContain("(Signataire de test)");

    // Bibliothèques servies depuis notre domaine, jamais depuis un CDN.
    expect(vendor.length).toBeGreaterThan(0);
    for (const url of vendor) expect(url.startsWith("http://127.0.0.1:8943/vendor/")).toBe(true);
    expect(envois, "aucune donnée envoyée sur le réseau").toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("certificat ECDSA P-256 auto-signé, sans dessin : signature invisible valide", async ({ page }) => {
    await chargerPdf(page);
    await ouvrirCertificat(page, "ec.p12", MDP);
    await expect(page.locator("#p12Info")).toContainText("auto-signé", { timeout: 15000 });
    await expect(page.locator("#p12Info")).toContainText("ECDSA P-256");

    const pdf = await signerEtTelecharger(page);
    const { champSig } = await verifierPdfSigne(page, pdf, { nbCertificats: 1 });
    const rect = champSig.lookup(PDFName.of("Rect"), PDFArray).asArray().map((n) => n.asNumber());
    expect(rect).toEqual([0, 0, 0, 0]);
  });

  test("mauvais mot de passe et ancien chiffrement : messages clairs, rien n'est signé", async ({ page }) => {
    await chargerPdf(page);
    await ouvrirCertificat(page, "rsa-chaine.p12", "mauvais");
    await expect(page.locator("#msg")).toContainText("Mot de passe du certificat incorrect", { timeout: 15000 });
    await expect(page.locator("#signBtn")).toBeDisabled();

    await page.locator("#p12Input").setInputFiles(path.join(CERTS, "legacy.p12"));
    await page.locator("#p12Password").fill(MDP);
    await page.locator("#p12LoadBtn").click();
    await expect(page.locator("#msg")).toContainText("AES-256", { timeout: 15000 });
    await expect(page.locator("#signBtn")).toBeDisabled();

    await page.locator("#p12Input").setInputFiles(FIXTURE_PDF);
    await page.locator("#p12Password").fill(MDP);
    await page.locator("#p12LoadBtn").click();
    await expect(page.locator("#msg")).toContainText("PKCS#12", { timeout: 15000 });
    await expect(page.locator("#signBtn")).toBeDisabled();
  });
});
