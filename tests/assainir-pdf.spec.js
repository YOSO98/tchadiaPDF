// Tests de bout en bout de l'outil "Assainir PDF" : un PDF piege, genere ici
// avec pdf-lib (metadonnees, XMP, JavaScript, piece jointe, annotations,
// formulaire, calque, signets, OpenAction, PieceInfo, CropBox reduite, texte
// invisible), est analyse puis assaini. Le PDF PRODUIT est reouvert en Node
// avec l'API bas niveau de pdf-lib et inspecte octet par octet.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFString, StandardFonts,
  decodePDFRawStream, PDFRawStream
} = require("pdf-lib");

const NOM_PIECE_JOINTE = "secret-attache-ZQX.txt";
const CODE_JS_DOC = "app.alert('PIEGE-JS-DOCUMENT-ZQX')";
const CODE_JS_OPEN = "app.alert('PIEGE-OPENACTION-ZQX')";
const COMMENTAIRE = "Commentaire confidentiel ZQX";
const AUTEUR = "Auteur Secret ZQX";
const TEXTE_CALQUE = "SECRET-CALQUE-ZQX";
const TEXTE_VISIBLE = "Texte visible conserve";
const DONNEE_PRIVEE = "DONNEE-PRIVEE-ZQX";

async function genererPdfPiege() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);

  doc.setTitle("Titre secret ZQX");
  doc.setAuthor(AUTEUR);
  doc.setSubject("Sujet secret");
  doc.setKeywords(["secret", "zqx"]);
  doc.setCreator("Logiciel Createur ZQX");
  doc.setProducer("Producteur Secret ZQX");
  doc.setCreationDate(new Date("2020-01-02T03:04:05Z"));
  doc.setModificationDate(new Date("2021-06-07T08:09:10Z"));

  const page1 = doc.addPage([595, 842]);
  const page2 = doc.addPage([595, 842]);
  page1.drawText(TEXTE_VISIBLE, { x: 50, y: 780, size: 14, font });
  page2.drawText("Deuxieme page", { x: 50, y: 780, size: 14, font });
  page2.setCropBox(50, 50, 400, 600);

  // Police nommee /F1 dans les ressources des deux pages pour nos flux bruts.
  page1.node.setFontDictionary(PDFName.of("F1"), font.ref);
  page2.node.setFontDictionary(PDFName.of("F1"), font.ref);

  // Texte invisible (mode de rendu 3) sur la page 1.
  page1.node.addContentStream(ctx.register(ctx.stream("BT 3 Tr /F1 12 Tf 50 50 Td (TEXTE-INVISIBLE-ZQX) Tj ET")));

  // Calque masque par defaut, avec du contenu marque dans la page 1.
  const ocgRef = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Calque secret ZQX") }));
  const ocgVisibleRef = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Calque visible") }));
  doc.catalog.set(PDFName.of("OCProperties"), ctx.obj({
    OCGs: [ocgRef, ocgVisibleRef],
    D: { OFF: [ocgRef], Order: [ocgRef, ocgVisibleRef] }
  }));
  const res1 = page1.node.Resources();
  res1.set(PDFName.of("Properties"), ctx.obj({ oc1: ocgRef, oc2: ocgVisibleRef }));
  page1.node.addContentStream(ctx.register(ctx.stream(
    "/OC /oc1 BDC BT /F1 12 Tf 50 700 Td (" + TEXTE_CALQUE + ") Tj ET EMC\n" +
    "/OC /oc2 BDC BT /F1 12 Tf 50 680 Td (Texte du calque visible) Tj ET EMC"
  )));

  // Annotation /Text (note), sa /Popup, et un /Link.
  const popupRef = ctx.nextRef();
  const textAnnotRef = ctx.register(ctx.obj({
    Type: "Annot", Subtype: "Text", Rect: [100, 700, 120, 720],
    Contents: PDFString.of(COMMENTAIRE), T: PDFString.of(AUTEUR), Popup: popupRef, P: page1.ref
  }));
  ctx.assign(popupRef, ctx.obj({ Type: "Annot", Subtype: "Popup", Rect: [130, 600, 300, 700], Parent: textAnnotRef, Open: false }));
  const linkRef = ctx.register(ctx.obj({
    Type: "Annot", Subtype: "Link", Rect: [50, 770, 250, 795], Border: [0, 0, 0],
    A: { S: "URI", URI: PDFString.of("https://tchadiapdf.com/") }
  }));
  page1.node.set(PDFName.of("Annots"), ctx.obj([textAnnotRef, popupRef, linkRef]));

  // Piece jointe.
  await doc.attach(Buffer.from("Contenu joint ultra secret ZQX"), NOM_PIECE_JOINTE, {
    mimeType: "text/plain", description: "Piece jointe de test"
  });

  // JavaScript de document (/Names /JavaScript) et action a l'ouverture.
  const jsDocRef = ctx.register(ctx.obj({ S: "JavaScript", JS: PDFString.of(CODE_JS_DOC) }));
  let names = doc.catalog.get(PDFName.of("Names")) ? doc.catalog.lookup(PDFName.of("Names"), PDFDict) : null;
  if (!names) { names = ctx.obj({}); doc.catalog.set(PDFName.of("Names"), names); }
  names.set(PDFName.of("JavaScript"), ctx.obj({ Names: [PDFString.of("Init"), jsDocRef] }));
  const openRef = ctx.register(ctx.obj({ S: "JavaScript", JS: PDFString.of(CODE_JS_OPEN) }));
  doc.catalog.set(PDFName.of("OpenAction"), openRef);
  page2.node.set(PDFName.of("AA"), ctx.obj({ O: openRef }));

  // Champ de formulaire rempli.
  const form = doc.getForm();
  const champ = form.createTextField("nom.complet");
  champ.setText("Jean Dupont");
  champ.addToPage(page2, { x: 50, y: 600, width: 200, height: 24, font });

  // Signets.
  const outlinesRef = ctx.nextRef();
  const itemRef = ctx.register(ctx.obj({
    Title: PDFString.of("Chapitre un"), Parent: outlinesRef, Dest: [page1.ref, "Fit"]
  }));
  ctx.assign(outlinesRef, ctx.obj({ Type: "Outlines", First: itemRef, Last: itemRef, Count: 1 }));
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);

  // PieceInfo (catalogue et page) et XMP.
  doc.catalog.set(PDFName.of("PieceInfo"), ctx.obj({ TchadiaTest: { LastModified: PDFString.of("D:20260101"), Private: PDFString.of(DONNEE_PRIVEE) } }));
  page1.node.set(PDFName.of("PieceInfo"), ctx.obj({ TchadiaTest: { Private: PDFString.of(DONNEE_PRIVEE) } }));
  const xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>AUTEUR-XMP-ZQX</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(ctx.stream(xmp, { Type: "Metadata", Subtype: "XML" })));

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

function latin1(bytes) {
  return Buffer.from(bytes).toString("latin1");
}

async function telechargerResultat(page) {
  const octets = await page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
  return Buffer.from(octets);
}

/** Toutes les annotations du document, sous forme de dictionnaires. */
function annotationsDe(doc) {
  const out = [];
  doc.getPages().forEach((p) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const d = doc.context.lookup(annots.get(i));
      if (d instanceof PDFDict) out.push(d);
    }
  });
  return out;
}

function flatPageContent(doc) {
  let s = "";
  doc.getPages().forEach((p) => {
    const c = p.node.Contents();
    const flux = [];
    if (c instanceof PDFArray) { for (let i = 0; i < c.size(); i++) flux.push(doc.context.lookup(c.get(i))); }
    else if (c instanceof PDFStream) flux.push(c);
    flux.forEach((f) => {
      if (f instanceof PDFRawStream) s += latin1(decodePDFRawStream(f).decode()) + "\n";
    });
  });
  return s;
}

let fixturePath;

test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tchadia-assainir-"));
  fixturePath = path.join(dir, "piege.pdf");
  const octets = await genererPdfPiege();
  fs.writeFileSync(fixturePath, octets);
  // Garde-fou : la fixture contient bien les pieges que l'on va chercher.
  const brut = latin1(octets);
  for (const m of [NOM_PIECE_JOINTE, CODE_JS_DOC, CODE_JS_OPEN, COMMENTAIRE, TEXTE_CALQUE, DONNEE_PRIVEE, "AUTEUR-XMP-ZQX", "/OCProperties", "/Outlines", "/AcroForm"]) {
    expect(brut, "la fixture doit contenir " + m).toContain(m);
  }
});

function surveiller(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

async function chargerEtAnalyser(page) {
  await page.goto("/assainir-pdf.html");
  await page.locator("#fileInput").setInputFiles(fixturePath);
  await expect(page.locator("#analyseBox")).toHaveClass(/visible/, { timeout: 15000 });
  await expect(page.locator("#sanitizeBtn")).toBeEnabled();
}

function compte(page, id) {
  return page.locator('#cat-' + id).locator("xpath=ancestor::li[1]").locator(".cat-compte");
}

test("l'analyse du PDF piege liste chaque categorie d'informations masquees", async ({ page }) => {
  const { consoleErrors, pageErrors } = surveiller(page);
  await chargerEtAnalyser(page);

  await expect(compte(page, "javascript")).toHaveText(/[3-9] éléments/);
  await expect(compte(page, "pieces")).toHaveText(/1 élément/);
  await expect(compte(page, "annotations")).toHaveText(/2 éléments/);
  await expect(compte(page, "metadonnees")).toHaveText(/[6-9] éléments/);
  await expect(compte(page, "xmp")).toHaveText(/1 élément/);
  await expect(compte(page, "calques")).toHaveText(/2 éléments/);
  await expect(compte(page, "actions")).toHaveText(/2 éléments/);
  await expect(compte(page, "formulaire")).toHaveText(/1 élément/);
  await expect(compte(page, "signets")).toHaveText(/1 élément/);
  await expect(compte(page, "liens")).toHaveText(/1 élément/);
  await expect(compte(page, "pieceinfo")).toHaveText(/2 éléments/);

  // Details utiles a l'utilisateur.
  const texte = await page.locator("#categories").innerText();
  expect(texte).toContain(NOM_PIECE_JOINTE);
  expect(texte).toContain("Auteur : " + AUTEUR);
  expect(texte).toContain("Note : 1");
  expect(texte).toContain("Calque secret ZQX (masqué par défaut)");
  expect(texte).toContain("nom.complet");
  expect(texte).toContain("Chapitre un");
  expect(texte).toContain("https://tchadiapdf.com/");
  // Categories informatives : recadrage page 2, texte invisible page 1.
  expect(texte).toMatch(/Contenu hors zone recadrée[\s\S]*1 page, à vérifier/);
  expect(texte).toMatch(/Texte masqué[\s\S]*1 page, à vérifier/);

  // Etat par defaut des cases : tout coche sauf signets et liens.
  for (const id of ["metadonnees", "xmp", "javascript", "pieces", "annotations", "formulaire", "calques", "actions", "pieceinfo"]) {
    await expect(page.locator("#cat-" + id), id).toBeChecked();
  }
  await expect(page.locator("#cat-signets")).not.toBeChecked();
  await expect(page.locator("#cat-liens")).not.toBeChecked();

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});

test("l'assainissement par defaut retire reellement les objets du PDF produit", async ({ page }) => {
  const { consoleErrors, pageErrors } = surveiller(page);
  await chargerEtAnalyser(page);
  await page.locator("#sanitizeBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });

  const rapport = await page.locator("#rapport").innerText();
  expect(rapport).toContain("Rapport d'assainissement");
  expect(rapport).toContain("aucun marqueur résiduel");
  expect(rapport).toMatch(/Retiré : \d+ scripts JavaScript supprimés/);
  expect(rapport).toContain("Retiré : 1 pièce jointe supprimée");
  expect(rapport).toContain("Conservé : Signets conservés (1)");
  expect(rapport).toContain("Conservé : Liens conservés (1)");
  expect(rapport).toContain("Signalé : 1 page recadrée signalée");

  const octets = await telechargerResultat(page);
  expect(octets.length).toBeGreaterThan(500);

  // 1. Inspection des octets bruts : rien de ce qui a ete retire ne subsiste.
  const brut = latin1(octets);
  for (const absent of [NOM_PIECE_JOINTE, CODE_JS_DOC, CODE_JS_OPEN, COMMENTAIRE, AUTEUR, TEXTE_CALQUE, DONNEE_PRIVEE, "AUTEUR-XMP-ZQX",
    "/JavaScript", "/JS", "/EmbeddedFiles", "/EmbeddedFile", "/OpenAction", "/OCProperties", "/OCG", "/Metadata", "/PieceInfo", "/AcroForm", "/Widget", "/Popup", "/Thumb", "/Subtype /Text", "/Subtype/Text"]) {
    expect(brut, "le PDF produit ne doit plus contenir " + absent).not.toContain(absent);
  }
  expect(brut).toContain("/Producer (tchadiaPdf)");

  // 2. Analyse structurelle avec pdf-lib bas niveau.
  const doc = await PDFDocument.load(octets, { updateMetadata: false });
  const cat = doc.catalog;
  const ctx = doc.context;
  expect(doc.getPageCount()).toBe(2);
  expect(cat.get(PDFName.of("OpenAction"))).toBeUndefined();
  expect(cat.get(PDFName.of("OCProperties"))).toBeUndefined();
  expect(cat.get(PDFName.of("Metadata"))).toBeUndefined();
  expect(cat.get(PDFName.of("AcroForm"))).toBeUndefined();
  expect(cat.get(PDFName.of("PieceInfo"))).toBeUndefined();
  expect(cat.get(PDFName.of("AA"))).toBeUndefined();
  const names = cat.get(PDFName.of("Names")) ? ctx.lookup(cat.get(PDFName.of("Names"))) : null;
  if (names) {
    expect(names.get(PDFName.of("JavaScript"))).toBeUndefined();
    expect(names.get(PDFName.of("EmbeddedFiles"))).toBeUndefined();
  }
  // Signets et liens conserves (non coches par defaut), et le signet pointe vers la page 1 du nouveau document.
  const outlines = ctx.lookup(cat.get(PDFName.of("Outlines")));
  expect(outlines).toBeInstanceOf(PDFDict);
  const item = ctx.lookup(outlines.get(PDFName.of("First")));
  const dest = ctx.lookup(item.get(PDFName.of("Dest")));
  expect(dest.get(0).toString()).toBe(doc.getPage(0).ref.toString());

  const annots = annotationsDe(doc);
  const sousTypes = annots.map((a) => a.get(PDFName.of("Subtype")).decodeText());
  expect(sousTypes).toEqual(["Link"]);
  doc.getPages().forEach((p) => {
    expect(p.node.get(PDFName.of("AA"))).toBeUndefined();
    expect(p.node.get(PDFName.of("PieceInfo"))).toBeUndefined();
  });

  // Metadonnees Info videes, producteur tchadiaPdf.
  expect(doc.getAuthor() || "").toBe("");
  expect(doc.getTitle() || "").toBe("");
  expect(doc.getProducer()).toBe("tchadiaPdf");
  expect(doc.getCreationDate()).toBeUndefined();

  // Contenu : le texte visible et le texte du calque visible restent, le calque masque a disparu,
  // le champ de formulaire a ete fige (son apparence est dans la page).
  const contenu = flatPageContent(doc);
  expect(contenu).toContain("(Texte du calque visible)");
  expect(contenu).not.toContain("BDC");
  expect(contenu).not.toContain(TEXTE_CALQUE);
  // Les formes XObject des champs figes sont referencees par le contenu de la page 2.
  const resPage2 = doc.getPage(1).node.Resources();
  const xobjs = ctx.lookup(resPage2.get(PDFName.of("XObject")));
  expect(xobjs).toBeInstanceOf(PDFDict);
  expect(xobjs.keys().length).toBeGreaterThan(0);
  // Le texte visible de la page 1 est toujours dessine (texte Helvetica encode par pdf-lib : on verifie l'operateur Tj et la police).
  expect(contenu).toMatch(/Tj/);

  // Aucun objet orphelin suspect : chaque objet indirect est un objet connu.
  const typesPresents = new Set();
  ctx.enumerateIndirectObjects().forEach(([, obj]) => {
    const d = obj instanceof PDFStream ? obj.dict : obj;
    if (d instanceof PDFDict) {
      const t = d.get(PDFName.of("Type"));
      if (t) typesPresents.add(t.decodeText());
    }
  });
  expect([...typesPresents]).not.toContain("OCG");
  expect([...typesPresents]).not.toContain("Metadata");
  expect([...typesPresents]).not.toContain("EmbeddedFile");
  expect([...typesPresents]).not.toContain("Filespec");

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});

test("decocher les signets les conserve, cocher les liens et les signets les retire", async ({ page }) => {
  const { consoleErrors, pageErrors } = surveiller(page);
  await chargerEtAnalyser(page);

  // Signets conserves (case non cochee), metadonnees conservees (on decoche) ; liens retires.
  await page.locator("#cat-metadonnees").uncheck();
  await page.locator("#cat-liens").check();
  await page.locator("#sanitizeBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  let octets = await telechargerResultat(page);
  let doc = await PDFDocument.load(octets, { updateMetadata: false });
  expect(doc.catalog.get(PDFName.of("Outlines"))).toBeDefined();
  expect(doc.getAuthor()).toBe(AUTEUR);
  expect(doc.getTitle()).toBe("Titre secret ZQX");
  expect(annotationsDe(doc)).toEqual([]);
  let brut = latin1(octets);
  expect(brut).toContain("/Outlines");
  expect(brut).not.toContain("/Link");
  expect(brut).not.toContain("tchadiapdf.com");
  expect(brut).not.toContain("/JavaScript");

  // Second passage sur le meme fichier (le document est recharge intact) : tout cocher.
  await page.locator("#cat-signets").check();
  await page.locator("#cat-metadonnees").check();
  await page.locator("#sanitizeBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  await expect(page.locator("#rapport")).toContainText("1 signet supprimé");
  octets = await telechargerResultat(page);
  doc = await PDFDocument.load(octets, { updateMetadata: false });
  expect(doc.catalog.get(PDFName.of("Outlines"))).toBeUndefined();
  brut = latin1(octets);
  expect(brut).not.toContain("/Outlines");
  expect(brut).not.toContain("Chapitre un");
  expect(brut).not.toContain("/Names");
  expect(doc.getAuthor() || "").toBe("");

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});

test("les fixtures reelles du depot sont assainies sans erreur et gardent leurs pages", async ({ page }) => {
  const { consoleErrors, pageErrors } = surveiller(page);
  await page.goto("/assainir-pdf.html");
  for (const nom of ["formulaire.pdf", "test1.pdf", "marqueur-confidentiel.pdf"]) {
    const chemin = path.join(__dirname, "fixtures", nom);
    const attendu = (await PDFDocument.load(fs.readFileSync(chemin), { updateMetadata: false, ignoreEncryption: true })).getPageCount();
    await page.locator("#fileInput").setInputFiles(chemin);
    await expect(page.locator("#analyseBox")).toHaveClass(/visible/, { timeout: 15000 });
    await page.locator("#sanitizeBtn").click();
    await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
    await expect(page.locator("#rapport")).toContainText("aucun marqueur résiduel");
    const octets = await telechargerResultat(page);
    const doc = await PDFDocument.load(octets, { updateMetadata: false });
    expect(doc.getPageCount(), nom).toBe(attendu);
    expect(doc.getProducer(), nom).toBe("tchadiaPdf");
    expect(doc.catalog.get(PDFName.of("AcroForm")), nom).toBeUndefined();
  }
  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});

test("navigation clavier : la dropzone est focalisable et le bouton reste desactive sans fichier", async ({ page }) => {
  const { consoleErrors, pageErrors } = surveiller(page);
  await page.goto("/assainir-pdf.html");
  await expect(page.locator("#sanitizeBtn")).toBeDisabled();
  await page.locator("#dropzone").focus();
  await expect(page.locator("#dropzone")).toBeFocused();
  expect(await page.locator("#dropzone").getAttribute("role")).toBe("button");
  expect(await page.locator("#dropzone").getAttribute("tabindex")).toBe("0");
  // Un fichier qui n'est pas un PDF est refuse avec un message clair.
  await page.locator("#fileInput").setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("bonjour") });
  await expect(page.locator("#msg")).toHaveClass(/visible/);
  await expect(page.locator("#msg")).toContainText("Veuillez choisir un fichier PDF");
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
