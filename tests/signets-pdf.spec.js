// Tests de bout en bout de l'outil "Signets PDF" : chaque scenario verifie le
// PDF reellement produit (arbre /Outlines relu avec pdf.js dans la page et
// avec pdf-lib bas niveau dans Node), pas seulement l'affichage.
//
// Le PDF de test est genere a la volee avec pdf-lib : 4 pages, deux titres de
// chapitre en 24 pt (pages 1 et 3), un sous-titre "Résumé" en 16 pt (page 2)
// et un corps de texte en 11 pt sur toutes les pages.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PDFDocument, StandardFonts, PDFName, PDFDict, PDFHexString, PDFNumber } = require("pdf-lib");

const BODY_LINES = [
  "Ceci est le corps du texte, en onze points, qui occupe la majorite",
  "de la page et sert de reference pour la taille mediane du document.",
  "Une troisieme ligne de corps pour que la mediane soit bien celle du corps.",
  "Et une quatrieme ligne, toujours en onze points, pour faire bonne mesure.",
];

async function buildSourcePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const headings = [
    { text: "Chapitre 1", size: 24 },
    { text: "Résumé", size: 16 },
    { text: "Chapitre 2", size: 24 },
    null,
  ];
  for (const heading of headings) {
    const page = doc.addPage([595, 842]);
    let y = 780;
    if (heading) {
      page.drawText(heading.text, { x: 60, y, size: heading.size, font });
      y -= 50;
    }
    for (const line of BODY_LINES) {
      page.drawText(line, { x: 60, y, size: 11, font });
      y -= 18;
    }
    page.drawText("Page " + (headings.indexOf(heading) + 1), { x: 280, y: 40, size: 11, font });
  }
  return doc.save();
}

function tmpFile(name, bytes) {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
}

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

async function openTool(page) {
  await page.goto("/signets-pdf.html");
  const refuseBtn = page.locator(".consent-banner-actions button.btn-secondary");
  if (await refuseBtn.count()) await refuseBtn.click();
}

/** Lit l'etat de l'arbre affiche : [{ title, page, level }]. */
async function readTree(page) {
  return page.$$eval("#outlineTree .outline-item", (rows) =>
    rows.map((li) => ({
      title: li.querySelector(".o-title").value,
      page: parseInt(li.querySelector(".o-page").value, 10),
      level: parseInt(li.getAttribute("aria-level"), 10),
    }))
  );
}

/** Recupere les octets du PDF produit depuis le lien de telechargement. */
async function resultBytes(page) {
  return page.evaluate(async () => {
    const a = document.querySelector("#result a.btn-primary");
    const buf = await (await fetch(a.href)).arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });
}

/** Relit l'arbre de signets du PDF produit avec pdf.js (dans la page), pages
 * resolues via getDestination / getPageIndex. */
async function outlineViaPdfjs(page, bytes) {
  return page.evaluate(async (arr) => {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const outline = await pdf.getOutline();
    async function walk(nodes) {
      const out = [];
      for (const n of nodes || []) {
        let dest = n.dest;
        if (typeof dest === "string") dest = await pdf.getDestination(dest);
        const pageIndex = await pdf.getPageIndex(dest[0]);
        out.push({ title: n.title, page: pageIndex + 1, items: await walk(n.items) });
      }
      return out;
    }
    return { outline: await walk(outline), pageMode: await pdf.getPageMode(), numPages: pdf.numPages };
  }, bytes);
}

async function generateFromHeadings(page, sourcePath) {
  await page.locator("#fileInput").setInputFiles(sourcePath);
  await expect(page.locator("#signetsPanel")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#generateBtn")).toBeEnabled();
  await page.locator("#generateBtn").click();
  await expect(page.locator("#outlineTree .outline-item")).toHaveCount(3, { timeout: 20000 });
}

test("la generation automatique propose 3 signets avec pages et niveaux corrects", async ({ page }) => {
  const check = watchErrors(page);
  const sourcePath = tmpFile("signets-source.pdf", await buildSourcePdf());
  await openTool(page);
  await generateFromHeadings(page, sourcePath);

  expect(await readTree(page)).toEqual([
    { title: "Chapitre 1", page: 1, level: 1 },
    { title: "Résumé", page: 2, level: 2 },
    { title: "Chapitre 2", page: 3, level: 1 },
  ]);
  await expect(page.locator("#msg")).toContainText("3 signets proposés");
  check();
});

test("l'enregistrement ecrit un arbre /Outlines relisible par pdf.js, accents conserves", async ({ page }) => {
  const check = watchErrors(page);
  const sourcePath = tmpFile("signets-source-2.pdf", await buildSourcePdf());
  await openTool(page);
  await generateFromHeadings(page, sourcePath);

  await page.locator("#pageModeChk").check();
  await page.locator("#saveBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });

  const bytes = await resultBytes(page);

  // Verification 1 : pdf.js relit l'arbre attendu avec les bonnes pages.
  const seen = await outlineViaPdfjs(page, bytes);
  expect(seen.numPages).toBe(4);
  expect(seen.pageMode).toBe("UseOutlines");
  expect(seen.outline).toEqual([
    { title: "Chapitre 1", page: 1, items: [{ title: "Résumé", page: 2, items: [] }] },
    { title: "Chapitre 2", page: 3, items: [] },
  ]);

  // Verification 2 : structure bas niveau avec pdf-lib dans Node.
  const doc = await PDFDocument.load(Buffer.from(bytes), { updateMetadata: false });
  const outlines = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  expect(outlines.lookup(PDFName.of("Type")).toString()).toBe("/Outlines");
  expect(outlines.lookup(PDFName.of("Count"), PDFNumber).asNumber()).toBe(3);
  const first = outlines.lookup(PDFName.of("First"), PDFDict);
  const last = outlines.lookup(PDFName.of("Last"), PDFDict);
  expect(first.lookup(PDFName.of("Title"), PDFHexString).decodeText()).toBe("Chapitre 1");
  expect(last.lookup(PDFName.of("Title"), PDFHexString).decodeText()).toBe("Chapitre 2");
  expect(first.lookup(PDFName.of("Next"), PDFDict)).toBe(last);
  expect(last.lookup(PDFName.of("Prev"), PDFDict)).toBe(first);
  expect(first.get(PDFName.of("Parent")).toString()).toBe(doc.catalog.get(PDFName.of("Outlines")).toString());
  const child = first.lookup(PDFName.of("First"), PDFDict);
  expect(child.lookup(PDFName.of("Title"), PDFHexString).decodeText()).toBe("Résumé");
  expect(child.get(PDFName.of("Parent")).toString()).toBe(outlines.get(PDFName.of("First")).toString());
  expect(first.lookup(PDFName.of("Count"), PDFNumber).asNumber()).toBe(1);
  const dest = child.lookup(PDFName.of("Dest"));
  expect(dest.get(0).toString()).toBe(doc.getPages()[1].ref.toString());
  expect(dest.get(1).toString()).toBe("/XYZ");
  expect(doc.catalog.lookup(PDFName.of("PageMode")).toString()).toBe("/UseOutlines");
  check();
});

test("recharger le PDF produit affiche l'arbre, supprimer un signet puis enregistrer donne 2 entrees", async ({ page }) => {
  const check = watchErrors(page);
  const sourcePath = tmpFile("signets-source-3.pdf", await buildSourcePdf());
  await openTool(page);
  await generateFromHeadings(page, sourcePath);
  await page.locator("#saveBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  const produced = await resultBytes(page);
  const producedPath = tmpFile("signets-produit.pdf", produced);

  // Rechargement : l'arbre existant est relu (titres, pages, niveaux).
  await page.locator("#fileInput").setInputFiles(producedPath);
  await expect(page.locator("#outlineTree .outline-item")).toHaveCount(3, { timeout: 15000 });
  expect(await readTree(page)).toEqual([
    { title: "Chapitre 1", page: 1, level: 1 },
    { title: "Résumé", page: 2, level: 2 },
    { title: "Chapitre 2", page: 3, level: 1 },
  ]);

  // Suppression du sous-titre, puis enregistrement.
  await page.locator('#outlineTree .outline-item[data-index="1"] [data-action="del"]').click();
  await expect(page.locator("#outlineTree .outline-item")).toHaveCount(2);
  await page.locator("#saveBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });

  const bytes = await resultBytes(page);
  const seen = await outlineViaPdfjs(page, bytes);
  expect(seen.outline).toEqual([
    { title: "Chapitre 1", page: 1, items: [] },
    { title: "Chapitre 2", page: 3, items: [] },
  ]);
  expect(seen.pageMode).not.toBe("UseOutlines");

  const doc = await PDFDocument.load(Buffer.from(bytes), { updateMetadata: false });
  const outlines = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  expect(outlines.lookup(PDFName.of("Count"), PDFNumber).asNumber()).toBe(2);
  check();
});

test("edition au clavier, ajout manuel et aller-retour texte", async ({ page }) => {
  const check = watchErrors(page);
  const sourcePath = tmpFile("signets-source-4.pdf", await buildSourcePdf());
  await openTool(page);
  await generateFromHeadings(page, sourcePath);

  // Clavier : Alt+Gauche desindente "Résumé", Alt+Bas le descend sous "Chapitre 2".
  const row2 = page.locator('#outlineTree .outline-item[data-index="1"]');
  await row2.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  expect((await readTree(page))[1]).toEqual({ title: "Résumé", page: 2, level: 1 });
  await page.keyboard.press("Alt+ArrowDown");
  expect((await readTree(page)).map((r) => r.title)).toEqual(["Chapitre 1", "Chapitre 2", "Résumé"]);
  await page.keyboard.press("Alt+ArrowRight");
  expect((await readTree(page))[2]).toEqual({ title: "Résumé", page: 2, level: 2 });

  // Ajout manuel apres la ligne selectionnee (la derniere).
  await page.locator("#addTitle").fill("Conclusion générale");
  await page.locator("#addPage").fill("4");
  await page.locator("#addLevel").selectOption("1");
  await page.locator("#addBtn").click();
  expect(await readTree(page)).toEqual([
    { title: "Chapitre 1", page: 1, level: 1 },
    { title: "Chapitre 2", page: 3, level: 1 },
    { title: "Résumé", page: 2, level: 2 },
    { title: "Conclusion générale", page: 4, level: 1 },
  ]);

  // Export texte : tabulations pour le niveau, titre, tabulation, page.
  await page.locator("#ioDetails summary").click();
  await page.locator("#exportTextBtn").click();
  expect(await page.locator("#tocText").inputValue()).toBe(
    "Chapitre 1\t1\nChapitre 2\t3\n\tRésumé\t2\nConclusion générale\t4"
  );

  // Import texte : remplace entierement l'arbre.
  await page.locator("#tocText").fill("Introduction\t1\n\tContexte\t2\n\t\tDétail\t2\nAnnexes\t4");
  await page.locator("#importTextBtn").click();
  expect(await readTree(page)).toEqual([
    { title: "Introduction", page: 1, level: 1 },
    { title: "Contexte", page: 2, level: 2 },
    { title: "Détail", page: 2, level: 3 },
    { title: "Annexes", page: 4, level: 1 },
  ]);

  await page.locator("#saveBtn").click();
  await expect(page.locator("#result")).toHaveClass(/visible/, { timeout: 20000 });
  const seen = await outlineViaPdfjs(page, await resultBytes(page));
  expect(seen.outline).toEqual([
    { title: "Introduction", page: 1, items: [{ title: "Contexte", page: 2, items: [{ title: "Détail", page: 2, items: [] }] }] },
    { title: "Annexes", page: 4, items: [] },
  ]);
  check();
});
