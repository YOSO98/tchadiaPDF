// Test de bout en bout de l'outil "Caviarder PDF" : verifie la garantie
// centrale de l'outil, pas seulement qu'un fichier est produit. Un PDF de
// test est genere a la volee avec un texte "secret" a un endroit precis et
// un texte "public" ailleurs sur une deuxieme page. Une zone est dessinee
// sur le secret, puis le texte extrait du PDF de sortie (via pdf.js) doit :
//   - ne plus contenir le secret nulle part (page caviardee entierement
//     rasterisee : plus aucun texte extractible sur cette page precise) ;
//   - toujours contenir le texte de la page non caviardee, inchangee.
const { test, expect } = require("@playwright/test");

test("caviarde une zone et supprime reellement le texte sous-jacent", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/caviarder-pdf.html");

  // Ecarte le bandeau de consentement : fixe en bas d'ecran, il peut
  // intercepter les clics destines a l'apercu s'il se trouve dans sa zone.
  const refuseBtn = page.locator(".consent-banner-actions button.btn-secondary");
  if (await refuseBtn.count()) await refuseBtn.click();

  // Genere un PDF de test a la volee (pdf-lib deja charge par la page) :
  // page 1 avec un texte "secret" a une position connue, page 2 avec un
  // texte public qui ne doit jamais etre touche.
  const testPdfBytes = await page.evaluate(async () => {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page1 = doc.addPage([400, 300]);
    page1.drawText("Texte public visible page 1", { x: 20, y: 250, size: 14, font });
    page1.drawText("SECRET-CONFIDENTIEL-12345", { x: 20, y: 20, size: 16, font });
    const page2 = doc.addPage([400, 300]);
    page2.drawText("Texte public page 2, jamais touche", { x: 20, y: 150, size: 14, font });
    return Array.from(await doc.save());
  });

  // Ecrit ce PDF dans un fichier temporaire pour pouvoir l'injecter via setInputFiles.
  const path = require("path");
  const fs = require("fs");
  const tmpPath = path.join(require("os").tmpdir(), "caviarder-test-source.pdf");
  fs.writeFileSync(tmpPath, Buffer.from(testPdfBytes));

  await page.locator("#fileInput").setInputFiles(tmpPath);
  await expect(page.locator("#cavPreviewHolder")).toBeVisible({ timeout: 15000 });
  await page.locator("#previewCanvas").scrollIntoViewIfNeeded();

  // Dessine une zone sur la moitie basse de l'apercu (le secret est place
  // pres du bas de la page en coordonnees PDF, donc pres du bas visuel).
  const box = await page.locator("#previewCanvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.95, { steps: 8 });
  await page.mouse.up();

  const caviarderBtn = page.locator("#caviarderBtn");
  await expect(caviarderBtn).toBeEnabled();
  await caviarderBtn.click();

  const result = page.locator("#result");
  await expect(result).toHaveClass(/visible/, { timeout: 20000 });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#result a.btn-primary").click(),
  ]);
  const outBytes = fs.readFileSync(await download.path());

  const verification = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const content = await p.getTextContent();
      texts.push(content.items.map((it) => it.str).join(" "));
    }
    return texts;
  }, Array.from(outBytes));

  expect(verification[0], "le texte de la page caviardee (y compris le secret) ne doit plus etre extractible").not.toContain("SECRET");
  expect(verification[1], "le texte de la page non caviardee doit rester intact").toContain("jamais touche");

  expect(consoleErrors, "aucune erreur console attendue : " + consoleErrors.join(" | ")).toEqual([]);
  expect(pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
});

// ---------- Rechercher et caviarder (motifs) ----------
// PDF de test genere a la volee : page 1 avec des donnees sensibles reelles
// (e-mail, telephone, IBAN valide, NIR valide) et un faux IBAN dont la cle
// RIB est invalide (le mod 97 seul le laisserait passer : BBAN nul) ; page 2
// avec le mot « Conditions » qui ne doit jamais etre touche.
// Le NIR utilise une cle correcte (91 pour 1 85 05 78 006 084) : la
// validation de la cle est reelle, pas decorative.
const DONNEES = {
  email: "jean.dupont@exemple.fr",
  tel: "06 12 34 56 78",
  iban: "FR76 3000 6000 0112 3456 7890 189",
  nir: "1 85 05 78 006 084 91",
  fauxIban: "FR76 0000 0000 0000 0000 0000 000",
};

async function chargerPdfMotifs(page) {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/caviarder-pdf.html");
  const refuseBtn = page.locator(".consent-banner-actions button.btn-secondary");
  if (await refuseBtn.count()) await refuseBtn.click();

  const bytes = await page.evaluate(async (d) => {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([500, 300]);
    p1.drawText("Contact : " + d.email + ", tél. " + d.tel + ",", { x: 20, y: 250, size: 11, font });
    p1.drawText("IBAN " + d.iban + ", NIR " + d.nir, { x: 20, y: 220, size: 11, font });
    p1.drawText("Faux IBAN " + d.fauxIban + " (invalide)", { x: 20, y: 190, size: 11, font });
    const p2 = doc.addPage([500, 300]);
    p2.drawText("Conditions générales de vente", { x: 20, y: 150, size: 14, font });
    return Array.from(await doc.save());
  }, DONNEES);

  const path = require("path");
  const fs = require("fs");
  const tmpPath = path.join(require("os").tmpdir(), "caviarder-test-motifs-" + process.pid + ".pdf");
  fs.writeFileSync(tmpPath, Buffer.from(bytes));
  await page.locator("#fileInput").setInputFiles(tmpPath);
  await expect(page.locator("#cavPreviewHolder")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#cavSearch")).toBeVisible();
  return { consoleErrors, pageErrors };
}

async function verifierZeroErreur(ctx) {
  expect(ctx.consoleErrors, "aucune erreur console attendue : " + ctx.consoleErrors.join(" | ")).toEqual([]);
  expect(ctx.pageErrors, "aucune erreur JS non interceptee attendue").toEqual([]);
}

test("motifs e-mail, telephone, IBAN et NIR : exactement 4 occurrences, faux IBAN exclu", async ({ page }) => {
  const ctx = await chargerPdfMotifs(page);

  for (const v of ["email", "phone", "iban", "nir"]) await page.locator(`.cav-pattern[value="${v}"]`).check();
  await page.locator("#searchBtn").click();
  await expect(page.locator("#occPanel")).toBeVisible({ timeout: 15000 });

  const items = page.locator("#occList li");
  await expect(items).toHaveCount(4);
  await expect(page.locator("#searchSummary")).toHaveText("4 occurrences trouvées.");

  // Verifie le detail des occurrences (type, page, masquage) et la geometrie
  // des rectangles : tous sur la page 1, dans le tiers haut (les lignes sont
  // dessinees entre y = 190 et 250 sur une page de 300 pt), largeur plausible.
  const occ = await page.evaluate(() => pendingOccurrences.map((o) => ({ kind: o.kind, page: o.page, text: o.text, display: o.display, rect: o.rect })));
  expect(occ.map((o) => o.kind).sort()).toEqual(["email", "iban", "nir", "phone"]);
  expect(occ.find((o) => o.kind === "email").text).toBe(DONNEES.email);
  expect(occ.find((o) => o.kind === "email").display).toBe("j***@exemple.fr");
  expect(occ.find((o) => o.kind === "phone").text).toBe(DONNEES.tel);
  expect(occ.find((o) => o.kind === "iban").text).toBe(DONNEES.iban);
  expect(occ.find((o) => o.kind === "nir").text).toBe(DONNEES.nir);
  for (const o of occ) {
    expect(o.page).toBe(1);
    expect(o.rect.fracY).toBeGreaterThan(0.1);
    expect(o.rect.fracY + o.rect.fracH).toBeLessThan(0.45);
    expect(o.rect.fracW).toBeGreaterThan(0.1);
    expect(o.rect.fracW).toBeLessThan(0.5);
    expect(o.rect.fracH).toBeGreaterThan(0.02);
    expect(o.rect.fracH).toBeLessThan(0.1);
  }
  // L'e-mail commence apres « Contact : » (x ≈ 20 + 48 pt) et le NIR est a droite de l'IBAN.
  const email = occ.find((o) => o.kind === "email").rect;
  expect(email.fracX).toBeGreaterThan(0.1);
  expect(email.fracX).toBeLessThan(0.16);
  const iban = occ.find((o) => o.kind === "iban").rect;
  const nir = occ.find((o) => o.kind === "nir").rect;
  expect(nir.fracX).toBeGreaterThan(iban.fracX + iban.fracW);

  // Le faux IBAN n'est nulle part.
  const textes = await page.locator("#occList").allInnerTexts();
  expect(textes.join(" ")).not.toContain("0000");

  await verifierZeroErreur(ctx);
});

test("ajout des occurrences aux zones : les 4 valeurs disparaissent du PDF produit, « Conditions » reste", async ({ page }) => {
  const ctx = await chargerPdfMotifs(page);

  for (const v of ["email", "phone", "iban", "nir"]) await page.locator(`.cav-pattern[value="${v}"]`).check();
  await page.locator("#searchBtn").click();
  await expect(page.locator("#occList li")).toHaveCount(4, { timeout: 15000 });

  // Decoche puis recoche via « Tout selectionner » : l'etat des cases pilote bien les zones.
  await page.locator("#occSelectAll").uncheck();
  await expect(page.locator("#addOccBtn")).toBeDisabled();
  await page.locator("#occSelectAll").check();
  await expect(page.locator("#addOccBtn")).toBeEnabled();

  await page.locator("#addOccBtn").click();
  await expect(page.locator("#occPanel")).toBeHidden();
  await expect(page.locator("#msg")).toContainText("4 zones ajoutées sur 1 page");
  const zones = await page.evaluate(() => Array.from(redactions.entries()).map(([p, l]) => [p, l.length]));
  expect(zones).toEqual([[1, 4]]);

  const caviarderBtn = page.locator("#caviarderBtn");
  await expect(caviarderBtn).toBeEnabled();
  await caviarderBtn.click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });

  const verification = await page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    const size = buf.byteLength; // pdf.js transfere (detache) le tampon : taille lue avant
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const content = await p.getTextContent();
      texts.push(content.items.map((it) => it.str).join(" "));
    }
    return { numPages: pdf.numPages, texts, size };
  });
  expect(verification.numPages).toBe(2);
  expect(verification.size).toBeGreaterThan(1000);
  const tout = verification.texts.join(" ");
  for (const v of [DONNEES.email, DONNEES.tel, DONNEES.iban, DONNEES.nir, "jean.dupont", "3456 7890"]) {
    expect(tout, "la valeur ne doit plus etre extractible : " + v).not.toContain(v);
  }
  expect(verification.texts[1]).toContain("Conditions");

  await verifierZeroErreur(ctx);
});

test("texte libre « Dupont », mot entier insensible a la casse : 1 occurrence", async ({ page }) => {
  const ctx = await chargerPdfMotifs(page);

  await page.locator("#searchText").fill("Dupont");
  await expect(page.locator("#searchWholeWord")).toBeChecked();
  await expect(page.locator("#searchCaseSensitive")).not.toBeChecked();
  await page.locator("#searchText").press("Enter");
  await expect(page.locator("#occList li")).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator("#occList .cav-occ-text")).toHaveText("d***nt");
  await expect(page.locator("#occList .cav-occ-kind")).toHaveText("Texte · p. 1");

  // Avec la casse respectee, « Dupont » (majuscule) n'apparait pas dans le document.
  await page.locator("#searchCaseSensitive").check();
  await page.locator("#searchBtn").click();
  await expect(page.locator("#searchSummary")).toContainText("Aucune occurrence", { timeout: 15000 });
  await expect(page.locator("#occPanel")).toBeHidden();

  // Sans l'option « mot entier », « pont » est trouve dans « dupont » ; avec, non.
  await page.locator("#searchCaseSensitive").uncheck();
  await page.locator("#searchText").fill("pont");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#searchSummary")).toContainText("Aucune occurrence", { timeout: 15000 });
  await page.locator("#searchWholeWord").uncheck();
  await page.locator("#searchBtn").click();
  await expect(page.locator("#occList li")).toHaveCount(1, { timeout: 15000 });

  await verifierZeroErreur(ctx);
});
