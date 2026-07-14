#!/usr/bin/env node
/**
 * Regenere toutes les icones du site (favicon, apple-touch-icon, icones PWA)
 * a partir de assets/icons/favicon-source.png, le logo source haute
 * resolution a conserver pour toute regeneration future.
 *
 * A relancer (npm run generer-icones) des que le logo source change. Les
 * fichiers d'icones ne sont pas concernes par le cache-busting par hash de
 * scripts/version-assets.js (qui ne couvre que css/*.css et js/*.js) : si
 * un visiteur a deja les anciennes icones en cache, seul un changement de
 * CACHE_NAME du service worker (voir sw.js) declenchera leur rechargement.
 *
 * Depend de deux devDependencies : sharp (redimensionnement) et png-to-ico
 * (assemblage du .ico multi-tailles a partir de PNG), toutes deux MIT/
 * Apache-2.0.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;

const ROOT = path.resolve(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "assets", "icons");
const SOURCE = path.join(ICONS_DIR, "favicon-source.png");
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function generatePlain(size, filename) {
  await sharp(SOURCE).resize(size, size).png().toFile(path.join(ICONS_DIR, filename));
  console.log("  " + filename + " (" + size + "x" + size + ")");
}

/**
 * Icone "maskable" (spec PWA) : le systeme d'exploitation peut recadrer
 * l'icone dans des formes variees (cercle, arrondi, squircle...). Le contenu
 * doit donc tenir dans une zone de securite centrale ; ici, le logo est
 * redimensionne a 80% du canevas final et centre avec une marge de 10% de
 * chaque cote, sur fond blanc (couleur de fond du logo source lui-meme).
 */
async function generateMaskable(size, filename) {
  const contentSize = Math.round(size * 0.8);
  const marginTopLeft = Math.round((size - contentSize) / 2);
  const marginBottomRight = size - contentSize - marginTopLeft;

  const resized = await sharp(SOURCE).resize(contentSize, contentSize).png().toBuffer();
  await sharp(resized)
    .extend({
      top: marginTopLeft,
      left: marginTopLeft,
      bottom: marginBottomRight,
      right: marginBottomRight,
      background: WHITE,
    })
    .png()
    .toFile(path.join(ICONS_DIR, filename));
  console.log("  " + filename + " (" + size + "x" + size + ", marge de securite 10%)");
}

/** favicon.ico multi-tailles (16/32/48), copie aussi a la racine du site :
 * c'est l'emplacement par defaut consulte par les navigateurs et les robots
 * meme en l'absence de balise <link rel="icon">. */
async function generateIco() {
  const sizes = [16, 32, 48];
  const buffers = await Promise.all(sizes.map((s) => sharp(SOURCE).resize(s, s).png().toBuffer()));
  const ico = await pngToIco(buffers);
  fs.writeFileSync(path.join(ICONS_DIR, "favicon.ico"), ico);
  fs.writeFileSync(path.join(ROOT, "favicon.ico"), ico);
  console.log("  favicon.ico (16/32/48, copie a la racine du site)");
}

(async () => {
  if (!fs.existsSync(SOURCE)) {
    console.error("Source introuvable : " + path.relative(ROOT, SOURCE));
    process.exit(1);
  }
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  console.log("Generation des icones a partir de " + path.relative(ROOT, SOURCE) + " :");
  await generatePlain(16, "favicon-16x16.png");
  await generatePlain(32, "favicon-32x32.png");
  await generatePlain(180, "apple-touch-icon.png");
  await generatePlain(192, "icon-192.png");
  await generatePlain(512, "icon-512.png");
  await generateMaskable(512, "icon-512-maskable.png");
  await generateIco();
  console.log("Termine.");
})();
