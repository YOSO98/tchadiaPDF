/* tchadiaPdf : chiffrement PDF standard (MD5 + RC4, revision 3, cle 128 bits)
 *
 * pdf-lib ne sait pas chiffrer un PDF. Ce module ajoute un mot de passe en
 * post-traitement des octets produits par pdf-lib (doc.save({ useObjectStreams: false })),
 * en implementant le "standard security handler" defini par la norme PDF
 * (ISO 32000-1, section 7.6). C'est un chiffrement reconnu par tous les
 * lecteurs PDF (Adobe Reader compris), pas le plus moderne (AES-256 ferait
 * mieux) mais robuste et sans dependance externe.
 *
 * Limitation assumee : seuls les FLUX (contenu des pages, polices, images)
 * sont chiffres. Les chaines directes du document (comme /Info) ne le sont
 * pas ; pour eviter qu'un lecteur affiche des metadonnees illisibles en
 * tentant de les dechiffrer quand meme, le dictionnaire /Info est retire du
 * fichier final. Le contenu visible des pages est donc entierement protege.
 */

(function (global) {
  "use strict";

  // ---------- MD5 (RFC 1321) ----------
  function md5(bytes) {
    function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    const S = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const origLen = bytes.length;
    const bitLen = origLen * 8;
    let totalLen = origLen + 1;
    while (totalLen % 64 !== 56) totalLen++;
    totalLen += 8;
    const buf = new Uint8Array(totalLen);
    buf.set(bytes);
    buf[origLen] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(totalLen - 8, bitLen >>> 0, true);
    dv.setUint32(totalLen - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

    for (let chunkStart = 0; chunkStart < totalLen; chunkStart += 64) {
      const M = new Uint32Array(16);
      for (let j = 0; j < 16; j++) M[j] = dv.getUint32(chunkStart + j * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, S[i])) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }

    const out = new Uint8Array(16);
    const outDv = new DataView(out.buffer);
    outDv.setUint32(0, a0, true); outDv.setUint32(4, b0, true);
    outDv.setUint32(8, c0, true); outDv.setUint32(12, d0, true);
    return out;
  }

  // ---------- RC4 ----------
  function rc4(key, data) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    const out = new Uint8Array(data.length);
    let i = 0; j = 0;
    for (let n = 0; n < data.length; n++) {
      i = (i + 1) & 0xff;
      j = (j + S[i]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[n] = data[n] ^ S[(S[i] + S[j]) & 0xff];
    }
    return out;
  }

  const PAD = new Uint8Array([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
  ]);
  const KEY_LEN = 16; // 128 bits

  function concatBytes() {
    let total = 0;
    for (let i = 0; i < arguments.length; i++) total += arguments[i].length;
    const out = new Uint8Array(total);
    let o = 0;
    for (let i = 0; i < arguments.length; i++) { out.set(arguments[i], o); o += arguments[i].length; }
    return out;
  }

  /** Encode une chaine en octets Latin-1 (couvre les caracteres francais courants). */
  function strToLatin1Bytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function padPassword(pw) {
    const bytes = strToLatin1Bytes(pw || "");
    if (bytes.length >= 32) return bytes.slice(0, 32);
    return concatBytes(bytes, PAD.slice(0, 32 - bytes.length));
  }

  function int32LE(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, n, true);
    return b;
  }

  function computeO(userPw, ownerPw) {
    const padded = padPassword(ownerPw || userPw);
    let digest = md5(padded);
    for (let i = 0; i < 50; i++) digest = md5(digest.slice(0, KEY_LEN));
    const rc4Key = digest.slice(0, KEY_LEN);
    let result = rc4(rc4Key, padPassword(userPw));
    for (let i = 1; i <= 19; i++) {
      const xored = new Uint8Array(KEY_LEN);
      for (let k = 0; k < KEY_LEN; k++) xored[k] = rc4Key[k] ^ i;
      result = rc4(xored, result);
    }
    return result;
  }

  function computeFileKey(userPw, O, P, idBytes) {
    const input = concatBytes(padPassword(userPw), O, int32LE(P), idBytes);
    let digest = md5(input);
    for (let i = 0; i < 50; i++) digest = md5(digest.slice(0, KEY_LEN));
    return digest.slice(0, KEY_LEN);
  }

  function computeU(fileKey, idBytes) {
    let result = md5(concatBytes(PAD, idBytes));
    result = rc4(fileKey, result);
    for (let i = 1; i <= 19; i++) {
      const xored = new Uint8Array(KEY_LEN);
      for (let k = 0; k < KEY_LEN; k++) xored[k] = fileKey[k] ^ i;
      result = rc4(xored, result);
    }
    return concatBytes(result, new Uint8Array(16));
  }

  function objectKey(fileKey, objNum, genNum) {
    const extra = new Uint8Array(5);
    extra[0] = objNum & 0xff; extra[1] = (objNum >> 8) & 0xff; extra[2] = (objNum >> 16) & 0xff;
    extra[3] = genNum & 0xff; extra[4] = (genNum >> 8) & 0xff;
    return md5(concatBytes(fileKey, extra)).slice(0, 16);
  }

  // ---------- Aide a la lecture de la structure PDF (format classique, non-compresse) ----------
  function bytesToLatin1(bytes, start, end) {
    end = end === undefined ? bytes.length : end;
    let s = "";
    const CHUNK = 0x2000;
    for (let i = start; i < end; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, end)));
    }
    return s;
  }

  function parseDirectInt(dictText, key) {
    const m = dictText.match(new RegExp("/" + key + "\\s+(\\d+)(?!\\s+\\d+\\s+R)"));
    return m ? parseInt(m[1], 10) : null;
  }
  function parseIndirectRefInt(dictText, key) {
    const m = dictText.match(new RegExp("/" + key + "\\s+(\\d+)\\s+(\\d+)\\s+R"));
    return m ? { num: parseInt(m[1], 10), gen: parseInt(m[2], 10) } : null;
  }

  function pdfLiteralString(bytes) {
    let s = "(";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
      else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
      else s += String.fromCharCode(b);
    }
    return s + ")";
  }

  /**
   * Chiffre un PDF (attendu : octets produits par pdf-lib avec
   * `useObjectStreams: false`, format xref classique) avec un mot de passe.
   * @param {Uint8Array} pdfBytes
   * @param {string} password mot de passe d'ouverture (utilisateur) ; peut
   *   etre vide si un mot de passe proprietaire est fourni (ouverture libre,
   *   droits restreints)
   * @param {{ownerPassword?: string, permissions?: number}} [options]
   *   ownerPassword : mot de passe proprietaire (droits), par defaut le mot
   *   de passe d'ouverture ; permissions : valeur /P (entier signe 32 bits,
   *   norme PDF tableau 22), par defaut -4 (tous les droits accordes)
   * @returns {Uint8Array} le PDF chiffre
   */
  function encryptPdfBytes(pdfBytes, password, options) {
    options = options || {};
    const userPassword = password || "";
    const ownerPassword = options.ownerPassword || userPassword;
    if (!userPassword && !ownerPassword) {
      throw new Error("Indiquez au moins un mot de passe (ouverture ou proprietaire).");
    }
    const P = typeof options.permissions === "number" ? (options.permissions | 0) : -4;

    const tailText = bytesToLatin1(pdfBytes, Math.max(0, pdfBytes.length - 4096));
    const startxrefIdx = tailText.lastIndexOf("startxref");
    if (startxrefIdx === -1) {
      throw new Error("Structure interne du PDF non reconnue. Reessayez avec un autre fichier.");
    }
    const sxMatch = tailText.slice(startxrefIdx).match(/startxref\s+(\d+)/);
    if (!sxMatch) throw new Error("Structure interne du PDF non reconnue. Reessayez avec un autre fichier.");
    const xrefOffset = parseInt(sxMatch[1], 10);

    const xrefText = bytesToLatin1(pdfBytes, xrefOffset);
    if (!/^xref\r?\n/.test(xrefText)) {
      throw new Error("Ce PDF utilise un format interne non pris en charge pour la protection par mot de passe.");
    }

    const trailerIdx = xrefText.indexOf("trailer");
    if (trailerIdx === -1) throw new Error("Structure interne du PDF non reconnue (trailer introuvable).");
    const xrefBody = xrefText.slice(4, trailerIdx);

    const lines = xrefBody.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
    const entries = {};
    let li = 0;
    while (li < lines.length) {
      const header = lines[li].trim().split(/\s+/);
      if (header.length !== 2) break;
      const start = parseInt(header[0], 10);
      const count = parseInt(header[1], 10);
      li++;
      for (let k = 0; k < count; k++) {
        const m = lines[li + k].match(/(\d{10})\s(\d{5})\s([nf])/);
        if (!m) throw new Error("Table de references croisees illisible.");
        entries[start + k] = { offset: parseInt(m[1], 10), gen: parseInt(m[2], 10), type: m[3] };
      }
      li += count;
    }

    const afterTrailer = xrefText.slice(trailerIdx + "trailer".length);
    const trailerDictText = afterTrailer.slice(0, afterTrailer.indexOf("startxref"));
    const rootRef = parseIndirectRefInt(trailerDictText, "Root");
    const sizeMatch = trailerDictText.match(/\/Size\s+(\d+)/);
    if (!rootRef || !sizeMatch) throw new Error("Le trailer du PDF est incomplet.");
    const size = parseInt(sizeMatch[1], 10);

    const bodyEnd = xrefOffset;
    const out = new Uint8Array(pdfBytes.length);
    out.set(pdfBytes);

    const idBytes = new Uint8Array(16);
    crypto.getRandomValues(idBytes);

    const O = computeO(userPassword, ownerPassword);
    const fileKey = computeFileKey(userPassword, O, P, idBytes);
    const U = computeU(fileKey, idBytes);

    for (let objNum = 1; objNum < size; objNum++) {
      const entry = entries[objNum];
      if (!entry || entry.type !== "n") continue;
      const objStartAbs = entry.offset;
      const windowText = bytesToLatin1(out, objStartAbs, Math.min(out.length, objStartAbs + 8192));
      if (!/^\d+\s+\d+\s+obj/.test(windowText)) {
        throw new Error("Objet PDF illisible. Le fichier est peut-etre corrompu.");
      }
      const streamKwIdx = windowText.indexOf("stream");
      const endobjIdx = windowText.indexOf("endobj");
      if (streamKwIdx === -1 || (endobjIdx !== -1 && endobjIdx < streamKwIdx)) continue;

      const dictText = windowText.slice(0, streamKwIdx);
      let length = parseDirectInt(dictText, "Length");
      if (length === null) {
        const ref = parseIndirectRefInt(dictText, "Length");
        if (!ref || !entries[ref.num]) throw new Error("Longueur de flux introuvable dans le PDF.");
        const lenWin = bytesToLatin1(out, entries[ref.num].offset, entries[ref.num].offset + 64);
        const lm = lenWin.match(/^\d+\s+\d+\s+obj\s+(\d+)/);
        if (!lm) throw new Error("Longueur de flux illisible dans le PDF.");
        length = parseInt(lm[1], 10);
      }
      let dataStartRel = streamKwIdx + "stream".length;
      if (windowText[dataStartRel] === "\r") dataStartRel++;
      if (windowText[dataStartRel] === "\n") dataStartRel++;
      const dataStartAbs = objStartAbs + dataStartRel;

      const key = objectKey(fileKey, objNum, entry.gen);
      const encrypted = rc4(key, out.slice(dataStartAbs, dataStartAbs + length));
      out.set(encrypted, dataStartAbs);
    }

    const encObjNum = size;
    const encDictStr =
      encObjNum + " 0 obj\n<< /Filter /Standard /V 2 /R 3 /Length 128 /O " +
      pdfLiteralString(O) + " /U " + pdfLiteralString(U) + " /P " + P + " >>\nendobj\n";

    const idHex = Array.prototype.map.call(idBytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const idEntry = "<" + idHex + "><" + idHex + ">";

    let xrefLines = "xref\n0 " + (size + 1) + "\n0000000000 65535 f \n";
    for (let objNum = 1; objNum < size; objNum++) {
      const entry = entries[objNum];
      if (!entry || entry.type === "f") { xrefLines += "0000000000 65535 f \n"; continue; }
      xrefLines += String(entry.offset).padStart(10, "0") + " " + String(entry.gen).padStart(5, "0") + " n \n";
    }
    xrefLines += String(bodyEnd).padStart(10, "0") + " 00000 n \n";

    const newXrefOffset = bodyEnd + encDictStr.length;
    const trailerStr =
      "trailer\n<< /Size " + (size + 1) + " /Root " + rootRef.num + " " + rootRef.gen + " R /Encrypt " +
      encObjNum + " 0 R /ID [" + idEntry + "] >>\nstartxref\n" + newXrefOffset + "\n%%EOF\n";

    const bodyPart = out.slice(0, bodyEnd);
    const encObjBytes = strToLatin1Bytes(encDictStr);
    const xrefBytes = strToLatin1Bytes(xrefLines);
    const trailerBytes = strToLatin1Bytes(trailerStr);

    const final = new Uint8Array(bodyPart.length + encObjBytes.length + xrefBytes.length + trailerBytes.length);
    let o = 0;
    final.set(bodyPart, o); o += bodyPart.length;
    final.set(encObjBytes, o); o += encObjBytes.length;
    final.set(xrefBytes, o); o += xrefBytes.length;
    final.set(trailerBytes, o);
    return final;
  }

  global.PdfCrypt = { encryptPdfBytes: encryptPdfBytes };
})(window);
