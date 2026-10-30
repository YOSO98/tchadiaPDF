/* tchadiaPdf : Compresser PDF, traitement lourd dans un Web Worker dédié.
   Ce worker est réutilisé séquentiellement pour chaque fichier d'un lot :
   chaque appel à postMessage() est indépendant, aucun état n'est conservé
   entre deux fichiers, donc le traitement par lots peut réutiliser la même
   instance sans risque.

   Pipeline par fichier (le passage final qpdf se fait dans le thread
   principal, voir js/compresser-pdf.js) :
     1. analyse des flux de contenu de chaque page (opérateurs cm, q, Q, Do,
        formulaires XObject imbriqués) pour connaître la plus grande taille
        d'affichage, en points, de chaque image : c'est elle qui donne la
        résolution effective (pixels / pouces affichés) ;
     2. pour chaque XObject image :
        a) JPEG (DCTDecode) : ré-échantillonnage si la résolution effective
           dépasse la cible, puis réencodage à la qualité demandée ;
        b) Flate sans perte 8 bits RGB ou gris, sans masque : conversion en
           JPEG (optionnelle), avec le même ré-échantillonnage ;
        c) tout le reste (masque de transparence, couleur clé, indexé, CMJN
           sans perte, 1 bit, 16 bits, JPX, CCITT…) est laissé intact et
           compté comme « non traité » ;
     3. suppression optionnelle des données inutiles (XMP, vignettes,
        PieceInfo), puis sérialisation avec pdf-lib. */

importScripts("/vendor/pdf-lib-1.17.1.min.js");

// Au-delà de cette surface (pixels), on ne tente ni décodage ni réencodage
// sur canevas : trop de mémoire pour un gain incertain, l'image est laissée telle quelle.
const MAX_PIXELS = 50 * 1000 * 1000;
// Côté maximal accepté par un OffscreenCanvas sans risque, en pixels.
const MAX_CANVAS_SIDE = 8192;
// En dessous de cette taille, une image n'a rien à gagner à être retraitée.
const MIN_SIDE = 32;
const MIN_LOSSLESS_BYTES = 16 * 1024;
// On ne ré-échantillonne que si la résolution effective dépasse la cible
// d'au moins 10 % : en dessous, le gain ne vaut pas la perte de génération.
const RESAMPLE_TOLERANCE = 1.1;

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isRegular(b) {
  return !WHITESPACE.has(b) && !DELIMITERS.has(b);
}

function nameOf(obj) {
  return obj && typeof obj.toString === "function" ? obj.toString() : "";
}

/** Multiplication de matrices PDF [a b c d e f] : résultat = m1 × m2. */
function mulMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

/** Lit un tableau de nombres pdf-lib (ex. /Matrix) en tableau JS, ou null. */
function numberArray(obj, expectedLength) {
  const { PDFArray, PDFNumber } = PDFLib;
  if (!(obj instanceof PDFArray) || obj.size() !== expectedLength) return null;
  const out = [];
  for (let i = 0; i < expectedLength; i++) {
    const n = obj.lookup(i);
    if (!(n instanceof PDFNumber)) return null;
    out.push(n.asNumber());
  }
  return out;
}

/** Décode un flux de contenu (page ou formulaire) en octets bruts. */
function decodeStreamBytes(stream) {
  const { PDFRawStream, decodePDFRawStream } = PDFLib;
  if (stream instanceof PDFRawStream) {
    const filter = stream.dict.lookup(PDFLib.PDFName.of("Filter"));
    if (!filter) return stream.contents;
    return decodePDFRawStream(stream).decode();
  }
  if (typeof stream.getUnencodedContents === "function") return stream.getUnencodedContents();
  if (typeof stream.getContents === "function") return stream.getContents();
  throw new Error("flux de contenu illisible");
}

/** Concatène les flux de contenu d'une page (un flux ou un tableau de flux). */
function pageContentBytes(doc, pageNode) {
  const { PDFArray, PDFStream } = PDFLib;
  const contents = pageNode.Contents();
  if (!contents) return new Uint8Array(0);
  const streams = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = contents.lookup(i);
      if (s instanceof PDFStream) streams.push(s);
    }
  } else if (contents instanceof PDFStream) {
    streams.push(contents);
  }
  const parts = streams.map(decodeStreamBytes);
  let total = 0;
  parts.forEach((p) => { total += p.length + 1; });
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
    out[offset++] = 0x0a; // séparateur : un opérateur peut être coupé entre deux flux
  });
  return out;
}

/**
 * Lexeur minimal de flux de contenu PDF. Produit les opérandes utiles
 * (nombres et noms) et les opérateurs ; chaînes, tableaux et dictionnaires
 * sont consommés sans être interprétés. Les images en ligne (BI … ID … EI)
 * sont sautées en bloc.
 */
function tokenize(bytes, onToken) {
  const n = bytes.length;
  let i = 0;

  function skipInlineImage() {
    // On est juste après l'opérateur BI : on avance jusqu'à ID, puis on
    // cherche un EI isolé par des blancs et suivi de texte ASCII plausible.
    while (i < n) {
      if (bytes[i] === 0x49 && bytes[i + 1] === 0x44 && (i + 2 >= n || WHITESPACE.has(bytes[i + 2])) &&
          (i === 0 || !isRegular(bytes[i - 1]))) {
        i += 3;
        break;
      }
      i++;
    }
    while (i < n) {
      if (WHITESPACE.has(bytes[i]) && bytes[i + 1] === 0x45 && bytes[i + 2] === 0x49 &&
          (i + 3 >= n || WHITESPACE.has(bytes[i + 3]) || DELIMITERS.has(bytes[i + 3]))) {
        let plausible = true;
        for (let k = i + 3; k < Math.min(n, i + 24); k++) {
          const b = bytes[k];
          if (b > 0x7e || (b < 0x20 && !WHITESPACE.has(b))) { plausible = false; break; }
        }
        if (plausible) { i += 3; return; }
      }
      i++;
    }
  }

  while (i < n) {
    const b = bytes[i];
    if (WHITESPACE.has(b)) { i++; continue; }
    if (b === 0x25) { // % commentaire
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    if (b === 0x28) { // ( chaîne littérale
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const c = bytes[i];
        if (c === 0x5c) { i += 2; continue; }
        if (c === 0x28) depth++;
        else if (c === 0x29) depth--;
        i++;
      }
      onToken("other", null);
      continue;
    }
    if (b === 0x3c) { // < : dictionnaire ou chaîne hexadécimale
      if (bytes[i + 1] === 0x3c) { i += 2; onToken("other", null); continue; }
      i++;
      while (i < n && bytes[i] !== 0x3e) i++;
      i++;
      onToken("other", null);
      continue;
    }
    if (b === 0x3e) { i += bytes[i + 1] === 0x3e ? 2 : 1; onToken("other", null); continue; }
    if (b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d) { i++; onToken("other", null); continue; }
    if (b === 0x29) { i++; continue; }
    if (b === 0x2f) { // /Nom
      i++;
      let start = i;
      while (i < n && isRegular(bytes[i])) i++;
      let raw = "";
      for (let k = start; k < i; k++) raw += String.fromCharCode(bytes[k]);
      // Séquences #xx : on les décode pour retrouver le nom tel qu'il figure dans /Resources
      raw = raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      onToken("name", raw);
      continue;
    }
    // Nombre ou opérateur
    const start = i;
    while (i < n && isRegular(bytes[i])) i++;
    let word = "";
    for (let k = start; k < i; k++) word += String.fromCharCode(bytes[k]);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      onToken("number", parseFloat(word));
    } else if (word === "BI") {
      skipInlineImage();
      onToken("operator", "BI");
    } else if (word.length > 0) {
      onToken("operator", word);
    }
  }
}

/**
 * Parcourt un flux de contenu et enregistre, pour chaque image rencontrée
 * via Do, la taille d'affichage en points sous la matrice courante.
 * @param {object} ctx { doc, usage: Map<string, {w, h}>, visiting: Set }
 */
function walkContent(ctx, bytes, resources, baseCtm, depth) {
  const { PDFName, PDFDict, PDFStream } = PDFLib;
  const xobjects = resources ? resources.lookup(PDFName.of("XObject")) : undefined;
  const stack = [];
  let ctm = baseCtm.slice();
  let operands = [];

  tokenize(bytes, (type, value) => {
    if (type === "number" || type === "name") { operands.push({ type, value }); return; }
    if (type !== "operator") { operands = []; return; }

    if (value === "q") {
      stack.push(ctm.slice());
      if (stack.length > 256) stack.shift();
    } else if (value === "Q") {
      if (stack.length) ctm = stack.pop();
    } else if (value === "cm") {
      const nums = operands.filter((o) => o.type === "number").slice(-6).map((o) => o.value);
      if (nums.length === 6) ctm = mulMatrix(nums, ctm);
    } else if (value === "Do") {
      const last = operands[operands.length - 1];
      if (last && last.type === "name" && xobjects instanceof PDFDict) {
        const ref = xobjects.get(PDFName.of(last.value));
        const stream = ref ? ctx.doc.context.lookup(ref) : undefined;
        if (stream instanceof PDFStream) {
          const key = ref.toString();
          const subtype = nameOf(stream.dict.lookup(PDFName.of("Subtype")));
          if (subtype === "/Image") {
            const w = Math.hypot(ctm[0], ctm[1]);
            const h = Math.hypot(ctm[2], ctm[3]);
            const prev = ctx.usage.get(key);
            if (!prev) ctx.usage.set(key, { w, h });
            else { prev.w = Math.max(prev.w, w); prev.h = Math.max(prev.h, h); }
          } else if (subtype === "/Form" && depth < 12 && !ctx.visiting.has(key)) {
            ctx.visiting.add(key);
            try {
              const matrix = numberArray(stream.dict.lookup(PDFName.of("Matrix")), 6) || [1, 0, 0, 1, 0, 0];
              const formRes = stream.dict.lookup(PDFName.of("Resources"));
              walkContent(ctx, decodeStreamBytes(stream), formRes instanceof PDFDict ? formRes : resources, mulMatrix(matrix, ctm), depth + 1);
            } catch (formErr) {
              ctx.unknownResources.push(stream.dict.lookup(PDFName.of("Resources")));
            } finally {
              ctx.visiting.delete(key);
            }
          }
        }
      }
    }
    operands = [];
  });
}

/** Marque comme « usage inconnu » toutes les images atteignables depuis un dictionnaire /Resources. */
function markUnknown(doc, resources, unknown, seen) {
  const { PDFName, PDFDict, PDFStream } = PDFLib;
  if (!(resources instanceof PDFDict)) return;
  const xobjects = resources.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return;
  for (const [, ref] of xobjects.entries()) {
    const key = ref.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFStream)) continue;
    const subtype = nameOf(stream.dict.lookup(PDFName.of("Subtype")));
    if (subtype === "/Image") unknown.add(key);
    else if (subtype === "/Form") markUnknown(doc, stream.dict.lookup(PDFName.of("Resources")), unknown, seen);
  }
}

/**
 * Analyse toutes les pages et renvoie la taille d'affichage maximale de
 * chaque image (clé : référence « n g R »), ainsi que l'ensemble des images
 * dont l'usage n'a pas pu être déterminé et la plus grande page du document.
 */
function analyzeUsage(doc) {
  const usage = new Map();
  const unknown = new Set();
  let maxPageW = 0;
  let maxPageH = 0;
  const pages = doc.getPages();

  for (const page of pages) {
    let size;
    try { size = page.getSize(); } catch (e) { size = { width: 595, height: 842 }; }
    maxPageW = Math.max(maxPageW, size.width);
    maxPageH = Math.max(maxPageH, size.height);

    const ctx = { doc, usage, visiting: new Set(), unknownResources: [] };
    let resources;
    try {
      resources = page.node.Resources();
      walkContent(ctx, pageContentBytes(doc, page.node), resources, [1, 0, 0, 1, 0, 0], 0);
    } catch (pageErr) {
      // Flux illisible : toute image de cette page est traitée avec l'hypothèse
      // de la plus grande utilisation (pleine page).
      ctx.unknownResources.push(resources);
    }
    ctx.unknownResources.forEach((res) => markUnknown(doc, res, unknown, new Set()));
  }

  if (maxPageW === 0) { maxPageW = 595; maxPageH = 842; }
  return { usage, unknown, maxPageW, maxPageH };
}

/** Résout l'espace colorimétrique d'une image en nombre de composantes RGB/gris pris en charge, ou 0. */
function losslessComponents(cs) {
  const { PDFName, PDFArray, PDFStream, PDFNumber } = PDFLib;
  if (!cs) return 0;
  const name = nameOf(cs);
  if (name === "/DeviceRGB" || name === "/CalRGB") return 3;
  if (name === "/DeviceGray" || name === "/CalGray") return 1;
  if (cs instanceof PDFArray && cs.size() >= 2) {
    const family = nameOf(cs.lookup(0));
    if (family === "/CalRGB") return 3;
    if (family === "/CalGray") return 1;
    if (family === "/ICCBased") {
      const profile = cs.lookup(1);
      if (profile instanceof PDFStream) {
        const n = profile.dict.lookup(PDFName.of("N"));
        if (n instanceof PDFNumber) {
          if (n.asNumber() === 3) return 3;
          if (n.asNumber() === 1) return 1;
        }
      }
    }
  }
  return 0;
}

/** Retire le prédicteur PNG (10 à 15) ou TIFF (2) d'un flux Flate 8 bits. Renvoie null si non pris en charge. */
function unpredict(data, predictor, colors, columns) {
  if (predictor <= 1) return data;
  const bpp = colors;
  const rowLen = columns * colors;
  if (predictor === 2) {
    const rows = Math.floor(data.length / rowLen);
    for (let r = 0; r < rows; r++) {
      const base = r * rowLen;
      for (let k = bpp; k < rowLen; k++) data[base + k] = (data[base + k] + data[base + k - bpp]) & 0xff;
    }
    return data;
  }
  if (predictor < 10) return null;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const row = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let k = 0; k < rowLen; k++) {
      const a = k >= bpp ? row[k - bpp] : 0;
      const b = prev[k];
      const c = k >= bpp ? prev[k - bpp] : 0;
      let v = src[k];
      switch (ft) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: return null;
      }
      row[k] = v & 0xff;
    }
    prev = row;
  }
  return out;
}

/** Heuristique « photo » : une image à très peu de couleurs distinctes est un graphique, le JPEG l'abîmerait. */
function looksLikePhoto(rgba, width, height) {
  const totalPx = width * height;
  const step = Math.max(1, Math.floor(totalPx / 4096));
  const seen = new Set();
  let sampled = 0;
  for (let p = 0; p < totalPx; p += step) {
    const o = p * 4;
    seen.add((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]);
    sampled++;
  }
  return seen.size >= Math.min(256, sampled * 0.1);
}

/** Calcule la taille cible d'une image d'après sa résolution effective, ou null si aucun ré-échantillonnage. */
function targetSize(pxW, pxH, displayPt, targetDpi) {
  if (!displayPt || displayPt.w <= 0 || displayPt.h <= 0) return null;
  const effW = pxW / (displayPt.w / 72);
  const effH = pxH / (displayPt.h / 72);
  const scale = Math.max(targetDpi / effW, targetDpi / effH);
  if (!(scale > 0) || scale * RESAMPLE_TOLERANCE >= 1) return null;
  return {
    width: Math.max(1, Math.round(pxW * scale)),
    height: Math.max(1, Math.round(pxH * scale)),
  };
}

/** Encode un ImageBitmap en JPEG via un canevas. */
async function bitmapToJpeg(bitmap, quality) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Remplace le contenu d'un XObject image par un JPEG RGB 8 bits. */
function replaceWithJpeg(doc, ref, obj, jpegBytes, width, height) {
  const { PDFName, PDFNumber, PDFRawStream } = PDFLib;
  // Le canevas décode et réencode toujours en RGB, quel que soit l'espace
  // colorimétrique d'origine : /ColorSpace doit suivre, sinon le lecteur
  // interprète mal les nouvelles données.
  obj.dict.set(PDFName.of("Length"), PDFNumber.of(jpegBytes.length));
  obj.dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
  obj.dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
  obj.dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
  obj.dict.set(PDFName.of("Width"), PDFNumber.of(width));
  obj.dict.set(PDFName.of("Height"), PDFNumber.of(height));
  obj.dict.delete(PDFName.of("Decode"));
  obj.dict.delete(PDFName.of("DecodeParms"));
  obj.dict.delete(PDFName.of("DP"));
  obj.dict.delete(PDFName.of("F"));
  doc.context.assign(ref, PDFRawStream.of(obj.dict, jpegBytes));
}

function filterNames(filter) {
  if (!filter) return [];
  if (typeof filter.asArray === "function") return filter.asArray().map(nameOf);
  return [nameOf(filter)];
}

function intOf(obj, fallback) {
  const { PDFNumber } = PDFLib;
  return obj instanceof PDFNumber ? obj.asNumber() : fallback;
}

/** Supprime XMP, vignettes et PieceInfo du catalogue, des pages et des XObjects. */
function removeJunk(doc) {
  const { PDFName, PDFRawStream } = PDFLib;
  const catalog = doc.catalog;
  catalog.delete(PDFName.of("Metadata"));
  catalog.delete(PDFName.of("PieceInfo"));
  doc.getPages().forEach((page) => {
    page.node.delete(PDFName.of("Thumb"));
    page.node.delete(PDFName.of("PieceInfo"));
    page.node.delete(PDFName.of("Metadata"));
  });
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      obj.dict.delete(PDFName.of("Metadata"));
      obj.dict.delete(PDFName.of("PieceInfo"));
    }
  }
}

self.onmessage = async (e) => {
  const { arrayBuffer } = e.data;
  const options = Object.assign({ dpi: 96, quality: 0.6, convertLossless: false, removeJunk: false }, e.data.options || {});
  // Compatibilité avec l'ancien protocole { arrayBuffer, quality }
  if (typeof e.data.quality === "number" && !e.data.options) options.quality = e.data.quality;

  const stats = { imagesFound: 0, recompressed: 0, resampled: 0, converted: 0, skipped: 0, usageUnknown: 0 };

  try {
    const { PDFDocument, PDFName, PDFRawStream } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(arrayBuffer, { updateMetadata: false });
    } catch (err) {
      const details = (err && err.message ? err.message : "").toLowerCase();
      postMessage({
        type: "error",
        message: details.indexOf("encrypt") !== -1
          ? "Ce PDF est protégé par un mot de passe. Retirez la protection avant de le compresser."
          : "Ce fichier est corrompu ou n'est pas un PDF valide.",
      });
      return;
    }

    postMessage({ type: "progress", pct: 8, label: "Analyse de l'utilisation des images…" });
    let analysis;
    try {
      analysis = analyzeUsage(doc);
    } catch (analysisErr) {
      analysis = { usage: new Map(), unknown: new Set(), maxPageW: 595, maxPageH: 842 };
    }
    // Hypothèse de la plus grande utilisation : une image dont l'usage est
    // inconnu (annotation, motif, flux illisible) est supposée couvrir la
    // plus grande page du document. C'est l'hypothèse la plus prudente : elle
    // ne ré-échantillonne jamais plus que ne le ferait un affichage pleine page.
    const fullPage = { w: analysis.maxPageW, h: analysis.maxPageH };

    // Repère tous les XObjects image
    const targets = [];
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      if (nameOf(obj.dict.lookup(PDFName.of("Subtype"))) !== "/Image") continue;
      targets.push([ref, obj]);
    }
    stats.imagesFound = targets.length;

    postMessage({
      type: "progress",
      pct: 12,
      label: targets.length > 0
        ? "Traitement de " + targets.length + " image(s)…"
        : "Aucune image trouvée, préparation du fichier…",
    });

    for (let i = 0; i < targets.length; i++) {
      const [ref, obj] = targets[i];
      const pct = 12 + Math.round(((i + 1) / targets.length) * 75);
      postMessage({ type: "progress", pct, label: "Image " + (i + 1) + " / " + targets.length });

      try {
        const dict = obj.dict;
        const filters = filterNames(dict.lookup(PDFName.of("Filter")));
        const width = intOf(dict.lookup(PDFName.of("Width")), 0);
        const height = intOf(dict.lookup(PDFName.of("Height")), 0);
        const bpc = intOf(dict.lookup(PDFName.of("BitsPerComponent")), 8);
        const hasSMask = !!dict.get(PDFName.of("SMask"));
        const hasMask = !!dict.get(PDFName.of("Mask"));
        const hasDecode = !!dict.get(PDFName.of("Decode"));
        const isImageMask = nameOf(dict.lookup(PDFName.of("ImageMask"))) === "true";
        const key = ref.toString();
        let display = analysis.usage.get(key) || null;
        if (!display || analysis.unknown.has(key)) {
          display = fullPage;
          stats.usageUnknown++;
        }

        if (width < MIN_SIDE || height < MIN_SIDE || width * height > MAX_PIXELS || isImageMask) {
          stats.skipped++;
          continue;
        }

        const isJpeg = filters.length === 1 && filters[0] === "/DCTDecode";
        const isFlateOnly = filters.length === 0 || (filters.length === 1 && filters[0] === "/FlateDecode");

        if (isJpeg) {
          // Le masque par couleur clé (/Mask tableau) dépend des valeurs exactes
          // des pixels : tout réencodage le casserait.
          const maskObj = dict.lookup(PDFName.of("Mask"));
          if (maskObj && typeof maskObj.asArray === "function") { stats.skipped++; continue; }
          if (hasDecode) { stats.skipped++; continue; }

          const originalBytes = obj.contents;
          let bitmap;
          try {
            bitmap = await createImageBitmap(new Blob([originalBytes], { type: "image/jpeg" }));
          } catch (decodeErr) {
            stats.skipped++;
            continue;
          }
          const target = targetSize(bitmap.width, bitmap.height, display, options.dpi);
          let outBitmap = bitmap;
          if (target) {
            // Ré-échantillonnage de haute qualité (filtrage multi-échantillons natif)
            outBitmap = await createImageBitmap(bitmap, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" });
            bitmap.close();
          } else if (bitmap.width > MAX_CANVAS_SIDE || bitmap.height > MAX_CANVAS_SIDE) {
            bitmap.close();
            continue;
          }
          const outW = outBitmap.width;
          const outH = outBitmap.height;
          const jpeg = await bitmapToJpeg(outBitmap, options.quality);
          // Sans ré-échantillonnage, on exige un gain réel (5 %) pour justifier une perte de génération.
          const threshold = target ? originalBytes.length : originalBytes.length * 0.95;
          if (jpeg.length < threshold) {
            replaceWithJpeg(doc, ref, obj, jpeg, outW, outH);
            stats.recompressed++;
            if (target) stats.resampled++;
          }
          continue;
        }

        if (isFlateOnly) {
          const ncomp = losslessComponents(dict.lookup(PDFName.of("ColorSpace")));
          if (!options.convertLossless || ncomp === 0 || bpc !== 8 || hasSMask || hasMask || hasDecode) {
            if (ncomp === 0 || bpc !== 8 || hasSMask || hasMask || hasDecode) stats.skipped++;
            continue;
          }
          if (obj.contents.length < MIN_LOSSLESS_BYTES) continue;

          let raw = filters.length === 0 ? obj.contents : PDFLib.decodePDFRawStream(obj).decode();
          const parms = dict.lookup(PDFName.of("DecodeParms"));
          const predictor = parms && typeof parms.lookup === "function" ? intOf(parms.lookup(PDFName.of("Predictor")), 1) : 1;
          if (predictor > 1) {
            const colors = intOf(parms.lookup(PDFName.of("Colors")), 1);
            const columns = intOf(parms.lookup(PDFName.of("Columns")), 1);
            const pbpc = intOf(parms.lookup(PDFName.of("BitsPerComponent")), 8);
            if (pbpc !== 8 || colors !== ncomp || columns !== width) { stats.skipped++; continue; }
            raw = unpredict(raw, predictor, colors, columns);
            if (!raw) { stats.skipped++; continue; }
          }
          if (raw.length < width * height * ncomp) { stats.skipped++; continue; }

          const rgba = new Uint8ClampedArray(width * height * 4);
          if (ncomp === 3) {
            for (let p = 0, s = 0; p < rgba.length; p += 4, s += 3) {
              rgba[p] = raw[s]; rgba[p + 1] = raw[s + 1]; rgba[p + 2] = raw[s + 2]; rgba[p + 3] = 255;
            }
          } else {
            for (let p = 0, s = 0; p < rgba.length; p += 4, s++) {
              rgba[p] = rgba[p + 1] = rgba[p + 2] = raw[s]; rgba[p + 3] = 255;
            }
          }
          if (!looksLikePhoto(rgba, width, height)) { stats.skipped++; continue; }

          const imageData = new ImageData(rgba, width, height);
          const target = targetSize(width, height, display, options.dpi);
          let bitmap;
          if (target) {
            bitmap = await createImageBitmap(imageData, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: "high" });
          } else {
            if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) { stats.skipped++; continue; }
            bitmap = await createImageBitmap(imageData);
          }
          const outW = bitmap.width;
          const outH = bitmap.height;
          const jpeg = await bitmapToJpeg(bitmap, options.quality);
          // La conversion n'a de sens que si le gain est net (au moins 20 %)
          if (jpeg.length < obj.contents.length * 0.8) {
            replaceWithJpeg(doc, ref, obj, jpeg, outW, outH);
            stats.converted++;
            if (target) stats.resampled++;
          }
          continue;
        }

        // JPX, CCITT, JBIG2, LZW, RunLength, filtres chaînés… : hors périmètre
        stats.skipped++;
      } catch (imgErr) {
        stats.skipped++;
      }
    }

    if (options.removeJunk) {
      postMessage({ type: "progress", pct: 89, label: "Suppression des données inutiles…" });
      try { removeJunk(doc); } catch (junkErr) { /* non bloquant */ }
    }

    postMessage({ type: "progress", pct: 91, label: "Génération du fichier…" });
    const outBytes = await doc.save({ updateFieldAppearances: false });

    postMessage(
      {
        type: "done",
        bytes: outBytes,
        originalSize: arrayBuffer.byteLength,
        newSize: outBytes.byteLength,
        imagesFound: stats.imagesFound,
        stats,
      },
      [outBytes.buffer]
    );
  } catch (err) {
    postMessage({
      type: "error",
      message: "La compression a échoué. Vérifiez votre fichier et réessayez.",
    });
  }
};
