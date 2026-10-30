#!/usr/bin/env node
// Migration ponctuelle : remplace chaque bibliotheque chargee depuis un CDN
// (cdnjs, jsdelivr) par sa copie auto-hebergee dans /vendor/. Les attributs
// integrity/crossorigin deviennent inutiles sur la meme origine et sont retires.
// Idempotent : relancer le script ne change rien une fois la migration faite.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const MAP = [
  ["https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js", "/vendor/pdf-lib-1.17.1.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "/vendor/pdf-3.11.174.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", "/vendor/pdf.worker-3.11.174.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "/vendor/jszip-3.10.1.min.js"],
  ["https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js", "/vendor/html2canvas-1.4.1.min.js"],
  ["https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "/vendor/xlsx-0.18.5.full.min.js"],
  ["https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js", "/vendor/heic2any-0.0.4.min.js"],
  ["https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js", "/vendor/UTIF-3.1.0.js"],
  ["https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js", "/vendor/tesseract-5.1.1/tesseract.min.js"],
  ["https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js", "/vendor/pptxgen-3.12.0.bundle.js"],
  ["https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js", "/vendor/marked-11.1.1.min.js"],
  ["https://cdn.jsdelivr.net/npm/mammoth@1.7.2/mammoth.browser.min.js", "/vendor/mammoth-1.7.2.browser.min.js"],
  ["https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js", "/vendor/epub-0.3.93.min.js"],
  ["https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js", "/vendor/docx-8.5.0.umd.js"],
  ["https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js", "/vendor/qpdf-0.3.0/qpdf.js"],
  ["https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm", "/vendor/qpdf-0.3.0/qpdf.wasm"],
  ["https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js", "/vendor/fontkit-1.1.1.umd.min.js"],
  ["https://cdn.jsdelivr.net/gh/shantigilbert/liberation-fonts-ttf@master/", "/vendor/fonts/liberation/"],
];

function listFiles(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "vendor" || entry.name === "test-results") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(p, exts, out);
    else if (exts.includes(path.extname(entry.name))) out.push(p);
  }
  return out;
}

let changedFiles = 0;
let replacements = 0;
for (const file of listFiles(ROOT, [".html", ".js"])) {
  if (file === __filename) continue;
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  for (const [from, to] of MAP) {
    after = after.split(from).join(to);
  }
  // Retire integrity="..." et crossorigin="..." sur les balises qui pointent
  // desormais vers /vendor/ (meme origine : la SRI n'apporte plus rien et
  // casserait au moindre changement de fichier).
  after = after.replace(/<script([^>]*?)src="\/vendor\/[^"]+"([^>]*)>/g, (tag) =>
    tag.replace(/\s+integrity="[^"]*"/g, "").replace(/\s+crossorigin(="[^"]*")?/g, "")
  );
  if (after !== before) {
    const n = (before.match(/https:\/\/cdn(js)?\.(jsdelivr\.net|cloudflare\.com)/g) || []).length;
    replacements += n;
    changedFiles += 1;
    fs.writeFileSync(file, after);
  }
}
console.log(`${changedFiles} fichier(s) modifie(s), ${replacements} reference(s) CDN remplacee(s).`);
