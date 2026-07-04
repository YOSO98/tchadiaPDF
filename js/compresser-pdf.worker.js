/* tchadiaPdf : Compresser PDF, traitement lourd dans un Web Worker dédié */

importScripts("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js");

// Plafond du plus grand côté d'une image, en pixels, pour aider la compression
const MAX_DIMENSION = 2000;

self.onmessage = async (e) => {
  const { arrayBuffer, quality } = e.data;

  try {
    const { PDFDocument, PDFName, PDFRawStream, PDFNumber } = PDFLib;

    let doc;
    try {
      doc = await PDFDocument.load(arrayBuffer, { updateMetadata: false });
    } catch (err) {
      const details = (err && err.message ? err.message : "").toLowerCase();
      if (details.indexOf("encrypt") !== -1) {
        postMessage({
          type: "error",
          message: "Ce PDF est protégé par un mot de passe. Retirez la protection avant de le compresser.",
        });
      } else {
        postMessage({
          type: "error",
          message: "Ce fichier est corrompu ou n'est pas un PDF valide.",
        });
      }
      return;
    }

    // Repère tous les flux d'images encodées en JPEG (filtre DCTDecode)
    const targets = [];
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;

      const subtype = obj.dict.lookup(PDFName.of("Subtype"));
      if (!subtype || subtype.toString() !== "/Image") continue;

      const filter = obj.dict.lookup(PDFName.of("Filter"));
      if (!filter) continue;

      let isDct = false;
      if (typeof filter.asArray === "function") {
        isDct = filter.asArray().some((f) => f && f.toString && f.toString() === "/DCTDecode");
      } else if (filter.toString && filter.toString() === "/DCTDecode") {
        isDct = true;
      }
      if (isDct) targets.push([ref, obj]);
    }

    const total = targets.length;
    postMessage({
      type: "progress",
      pct: 5,
      label:
        total > 0
          ? "Préparation de la compression de " + total + " image(s)…"
          : "Aucune image compressible trouvée, préparation du fichier…",
    });

    for (let i = 0; i < total; i++) {
      const [ref, obj] = targets[i];
      const pct = 5 + Math.round(((i + 1) / total) * 85);
      postMessage({ type: "progress", pct, label: "Compression de l'image " + (i + 1) + " / " + total });

      try {
        const originalBytes = obj.contents;
        const blob = new Blob([originalBytes], { type: "image/jpeg" });

        let bitmap;
        try {
          bitmap = await createImageBitmap(blob);
        } catch (decodeErr) {
          // Image illisible : on la laisse telle quelle et on continue
          continue;
        }

        let width = bitmap.width;
        let height = bitmap.height;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / Math.max(width, height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        const canvas = new OffscreenCanvas(width, height);
        const ctx2d = canvas.getContext("2d");
        ctx2d.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const newBlob = await canvas.convertToBlob({ type: "image/jpeg", quality });
        const newBytes = new Uint8Array(await newBlob.arrayBuffer());

        if (newBytes.length < originalBytes.length) {
          obj.dict.set(PDFName.of("Length"), PDFNumber.of(newBytes.length));
          obj.dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
          obj.dict.delete(PDFName.of("DecodeParms"));
          obj.dict.delete(PDFName.of("DP"));
          const newStream = PDFRawStream.of(obj.dict, newBytes);
          doc.context.assign(ref, newStream);
        }
      } catch (imgErr) {
        // On ignore l'erreur pour cette image et on continue avec les suivantes
        continue;
      }
    }

    postMessage({ type: "progress", pct: 95, label: "Génération du fichier final…" });
    const outBytes = await doc.save();

    postMessage(
      {
        type: "done",
        bytes: outBytes,
        originalSize: arrayBuffer.byteLength,
        newSize: outBytes.byteLength,
        imagesFound: total,
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
