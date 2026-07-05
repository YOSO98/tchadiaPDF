/* tchadiaPdf : utilitaires de securite partages (Bloc 3 "Robustesse du traitement navigateur")
   Ce fichier ne depend d'aucune bibliotheque externe. Il doit etre charge apres js/common.js
   et avant le script propre a chaque outil, dans les pages qui en ont besoin. */

/**
 * Detecte le vrai type d'un fichier a partir de ses octets magiques (les premiers octets
 * du fichier), independamment de son nom ou de son extension. Utile pour reperer un fichier
 * dont l'extension ment sur son contenu reel (par exemple un ".pdf" qui est en fait une image).
 *
 * Limite connue et assumee : les formats bases sur ZIP (DOCX, XLSX, PPTX, EPUB) partagent
 * tous la meme signature ZIP ("PK\x03\x04" ou, plus rarement, "PK\x05\x06" pour une archive
 * vide). On ne peut les distinguer entre eux qu'en regardant le contenu interne de l'archive
 * (present du fichier "[Content_Types].xml" et des dossiers "word/"/"xl/"/"ppt/" pour les
 * formats Office Open XML, ou du fichier "mimetype" contenant "application/epub+zip" pour
 * l'EPUB). Cette fonction tente cette distinction par une recherche heuristique dans les
 * premiers kilo-octets du fichier (ou se trouvent generalement les premieres entrees locales
 * d'une petite archive), mais ce n'est PAS une lecture structuree du zip (pas de central
 * directory) : sur une archive construite de maniere inhabituelle, elle peut echouer a
 * distinguer le sous-format et se contenter de retourner "zip" ou "ooxml".
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {string} un identifiant de format ("pdf", "zip", "docx", "xlsx", "pptx", "epub",
 *   "ooxml", "ole", "png", "jpeg", "gif", "bmp", "tiff", "webp", "heic", "texte") ou "inconnu"
 *   si aucune signature connue ne correspond.
 */
function sniffFileType(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (u8.length < 2) return "inconnu";

  // PDF : "%PDF"
  if (u8.length >= 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) {
    return "pdf";
  }

  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (
    u8.length >= 8 &&
    u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47 &&
    u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a
  ) {
    return "png";
  }

  // JPEG : FF D8 FF
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return "jpeg";
  }

  // GIF : "GIF87a" ou "GIF89a"
  if (
    u8.length >= 6 &&
    u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38 &&
    (u8[4] === 0x37 || u8[4] === 0x39) && u8[5] === 0x61
  ) {
    return "gif";
  }

  // BMP : "BM"
  if (u8[0] === 0x42 && u8[1] === 0x4d) {
    return "bmp";
  }

  // TIFF : "II*\0" (little endian) ou "MM\0*" (big endian)
  if (
    u8.length >= 4 &&
    ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 0x2a && u8[3] === 0x00) ||
      (u8[0] === 0x4d && u8[1] === 0x4d && u8[2] === 0x00 && u8[3] === 0x2a))
  ) {
    return "tiff";
  }

  // WEBP : "RIFF" .... "WEBP"
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
    u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50
  ) {
    return "webp";
  }

  // HEIC/HEIF : boite ISOBMFF "ftyp" a l'offset 4, avec une marque de compatibilite connue.
  if (u8.length >= 12) {
    const box = bytesToAscii(u8, 4, 4);
    if (box === "ftyp") {
      const brand = bytesToAscii(u8, 8, 4);
      const heicBrands = ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"];
      if (heicBrands.indexOf(brand) !== -1) return "heic";
    }
  }

  // OLE/CFB (ancien .doc/.xls) : D0 CF 11 E0 A1 B1 1A E1
  if (
    u8.length >= 4 &&
    u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0
  ) {
    return "ole";
  }

  // ZIP local file header (PK\x03\x04) ou central directory / end-of-archive vide (PK\x05\x06 / PK\x07\x08)
  if (
    u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b &&
    ((u8[2] === 0x03 && u8[3] === 0x04) || (u8[2] === 0x05 && u8[3] === 0x06) || (u8[2] === 0x07 && u8[3] === 0x08))
  ) {
    return sniffZipSubtype(u8) || "zip";
  }

  if (isLikelyPlainText(u8)) return "texte";

  return "inconnu";
}

function bytesToAscii(u8, offset, length) {
  let s = "";
  for (let i = offset; i < offset + length && i < u8.length; i++) {
    s += String.fromCharCode(u8[i]);
  }
  return s;
}

/** Heuristique (non structuree) de sous-type ZIP : recherche de marqueurs de texte dans les premiers octets. */
function sniffZipSubtype(u8) {
  const scanLen = Math.min(u8.length, 8192);
  let s = "";
  for (let i = 0; i < scanLen; i++) s += String.fromCharCode(u8[i]);

  // EPUB : la toute premiere entree de l'archive doit etre "mimetype" (non compressee),
  // contenant litteralement "application/epub+zip".
  if (s.indexOf("mimetypeapplication/epub+zip") !== -1) return "epub";

  // Office Open XML (DOCX/XLSX/PPTX) : presence du descripteur "[Content_Types].xml"
  // et d'un dossier racine caracteristique du type de document.
  if (s.indexOf("[Content_Types].xml") !== -1 || s.indexOf("_rels/") !== -1) {
    if (s.indexOf("word/") !== -1) return "docx";
    if (s.indexOf("ppt/") !== -1) return "pptx";
    if (s.indexOf("xl/") !== -1) return "xlsx";
    return "ooxml"; // zip Office reconnu mais sous-type non trouve dans les premiers octets
  }

  return null;
}

/** Heuristique texte brut : proportion de caracteres imprimables/controle usuels sur un echantillon. */
function isLikelyPlainText(u8) {
  const n = Math.min(u8.length, 2048);
  if (n === 0) return false;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = u8[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 128) printable++;
  }
  return printable / n > 0.95;
}

/**
 * Assainisseur HTML leger, sans dependance externe, pour du HTML derive d'un fichier
 * utilisateur avant toute insertion dans le DOM reel de la page (que ce soit un apercu
 * visible ou un conteneur cache servant a la rasterisation html2canvas).
 *
 * Fonctionnement : parse le HTML dans un document DETACHE (via DOMParser, donc aucun
 * script n'est execute pendant le parsing lui-meme), puis parcourt recursivement l'arbre
 * pour supprimer :
 *  - les elements <script>, <iframe>, <object>, <embed> (execution ou embarquement actif) ;
 *  - tous les attributs commencant par "on" (gestionnaires d'evenements inline, ex: onerror,
 *    onload, onclick...) ;
 *  - les attributs href/src dont la valeur commence par "javascript:".
 *
 * @param {string} html
 * @returns {string} le HTML nettoye (innerHTML du <body> du document assaini)
 */
function sanitizeHtmlForDisplay(html) {
  const DANGEROUS_TAGS = ["SCRIPT", "IFRAME", "OBJECT", "EMBED"];
  const doc = new DOMParser().parseFromString(String(html == null ? "" : html), "text/html");

  function cleanNode(node) {
    // Copie statique : on va potentiellement retirer des enfants pendant l'iteration.
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType !== 1 /* ELEMENT_NODE */) return;

      if (DANGEROUS_TAGS.indexOf(child.tagName) !== -1) {
        child.remove();
        return;
      }

      Array.from(child.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.indexOf("on") === 0) {
          child.removeAttribute(attr.name);
        } else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
          child.removeAttribute(attr.name);
        }
      });

      cleanNode(child);
    });
  }

  cleanNode(doc.body);
  return doc.body.innerHTML;
}

/**
 * Gardien de limites reutilisable (taille de fichier, nombre de pages) avec un message
 * francais clair, pour eviter de dupliquer cette logique dans chaque outil.
 *
 * @param {{sizeBytes?: number, pageCount?: number, maxSizeBytes?: number, maxPages?: number}} params
 * @returns {{ok: true} | {ok: false, message: string}}
 */
function enforceLimits(params) {
  const p = params || {};
  if (typeof p.maxSizeBytes === "number" && typeof p.sizeBytes === "number" && p.sizeBytes > p.maxSizeBytes) {
    const limitLabel = typeof fmtSize === "function" ? fmtSize(p.maxSizeBytes) : Math.round(p.maxSizeBytes / 1048576) + " Mo";
    return { ok: false, message: "Ce fichier dépasse la limite de " + limitLabel + ". Choisissez un fichier plus léger." };
  }
  if (typeof p.maxPages === "number" && typeof p.pageCount === "number" && p.pageCount > p.maxPages) {
    return {
      ok: false,
      message:
        "Ce fichier contient " + p.pageCount + " pages, ce qui dépasse la limite de " + p.maxPages +
        " pages et risque de bloquer votre navigateur. Essayez avec un fichier plus petit.",
    };
  }
  return { ok: true };
}
