/* tchadiaPdf : Extraire les images d'un PDF */

const MAX_SIZE = 100 * 1024 * 1024; // 100 Mo

let srcBytes = null;
let currentFile = null;

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const extractBtn = document.getElementById("extractBtn");
const resultEl = document.getElementById("result");
const resultText = document.getElementById("resultText");

initDropzone("dropzone", "fileInput", async (newFiles) => {
  hideMsg();
  resultEl.classList.remove("visible");
  const file = newFiles[0];

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg("Veuillez choisir un fichier PDF.");
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("Ce fichier dépasse la limite de 100 Mo. Choisissez un PDF plus léger.");
    return;
  }

  try {
    setProgress(10, "Lecture du fichier…");
    const bytes = await readAsArrayBuffer(file);

    const { PDFDocument } = PDFLib;
    let doc;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      const details = (err && err.message ? err.message : "").toLowerCase();
      hideProgress();
      srcBytes = null;
      currentFile = null;
      extractBtn.disabled = true;
      fileInfo.classList.remove("visible");
      if (details.indexOf("encrypt") !== -1) {
        showMsg("Ce PDF est protégé par un mot de passe. Retirez la protection avant d'extraire ses images.");
      } else {
        showMsg("Ce fichier est corrompu ou n'est pas un PDF valide.");
      }
      return;
    }

    srcBytes = bytes;
    currentFile = file;
    const numPages = doc.getPageCount();
    fileName.textContent = file.name;
    fileMeta.textContent = fmtSize(file.size) + " · " + numPages + (numPages > 1 ? " pages" : " page");
    fileInfo.classList.add("visible");
    extractBtn.disabled = false;
    hideProgress();
  } catch (e) {
    hideProgress();
    srcBytes = null;
    currentFile = null;
    extractBtn.disabled = true;
    fileInfo.classList.remove("visible");
    showMsg("Impossible de lire ce fichier. Réessayez avec un autre PDF.");
  }
});

/** Décompresse un flux au format FlateDecode (zlib) grâce à l'API native du navigateur. */
async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Tente d'extraire une image à partir d'un flux PDFRawStream /Subtype /Image.
 * Renvoie { bytes, ext } en cas de succès, ou null si le format n'est pas pris en charge.
 */
async function extractOneImage(obj, PDFName) {
  const filterObj = obj.dict.lookup(PDFName.of("Filter"));
  let filterNames = [];
  if (filterObj) {
    if (typeof filterObj.asArray === "function") {
      filterNames = filterObj.asArray().map((f) => (f && f.toString ? f.toString() : ""));
    } else if (filterObj.toString) {
      filterNames = [filterObj.toString()];
    }
  }

  // Cas 1 : JPEG brut (DCTDecode), les octets du flux sont déjà un JPEG valide
  if (filterNames.length === 1 && filterNames[0] === "/DCTDecode") {
    return { bytes: obj.contents, ext: "jpg" };
  }

  // Cas 2 : pas de filtre, ou FlateDecode seul : pixels bruts, éventuellement compressés
  const isRawOrFlate = filterNames.length === 0 || (filterNames.length === 1 && filterNames[0] === "/FlateDecode");
  if (!isRawOrFlate) return null; // JPX, JBIG2, CCITTFax, filtres multiples : non pris en charge ici

  const colorSpaceObj = obj.dict.lookup(PDFName.of("ColorSpace"));
  const bpcObj = obj.dict.lookup(PDFName.of("BitsPerComponent"));
  const widthObj = obj.dict.lookup(PDFName.of("Width"));
  const heightObj = obj.dict.lookup(PDFName.of("Height"));
  if (!colorSpaceObj || !bpcObj || !widthObj || !heightObj) return null;

  const colorSpaceName = colorSpaceObj.toString ? colorSpaceObj.toString() : "";
  const bpc = typeof bpcObj.asNumber === "function" ? bpcObj.asNumber() : NaN;
  const width = typeof widthObj.asNumber === "function" ? widthObj.asNumber() : NaN;
  const height = typeof heightObj.asNumber === "function" ? heightObj.asNumber() : NaN;

  if (bpc !== 8 || !width || !height) return null;

  let channels;
  if (colorSpaceName === "/DeviceRGB") channels = 3;
  else if (colorSpaceName === "/DeviceGray") channels = 1;
  else return null; // CMJN, Indexed, ICCBased, etc. : non pris en charge ici

  let raw = obj.contents;
  if (filterNames.length === 1 && filterNames[0] === "/FlateDecode") {
    if (typeof DecompressionStream === "undefined") return null;
    raw = await inflate(raw);
  }

  const expectedLength = width * height * channels;
  if (raw.length < expectedLength) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  if (channels === 3) {
    for (let p = 0; p < width * height; p++) {
      data[p * 4] = raw[p * 3];
      data[p * 4 + 1] = raw[p * 3 + 1];
      data[p * 4 + 2] = raw[p * 3 + 2];
      data[p * 4 + 3] = 255;
    }
  } else {
    for (let p = 0; p < width * height; p++) {
      const v = raw[p];
      data[p * 4] = v;
      data[p * 4 + 1] = v;
      data[p * 4 + 2] = v;
      data[p * 4 + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, ext: "png" };
}

extractBtn.addEventListener("click", async () => {
  if (!srcBytes) return;
  hideMsg();
  resultEl.classList.remove("visible");
  extractBtn.disabled = true;

  try {
    setProgress(0, "Analyse du PDF…");
    const { PDFDocument, PDFName, PDFRawStream } = PDFLib;
    const doc = await PDFDocument.load(srcBytes, { updateMetadata: false });

    // Repère tous les flux d'images embarquées, dans l'ordre de leur découverte
    const candidates = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = obj.dict.lookup(PDFName.of("Subtype"));
      if (!subtype || subtype.toString() !== "/Image") continue;
      candidates.push(obj);
    }

    const total = candidates.length;
    if (total === 0) {
      hideProgress();
      showMsg("Aucune image extractible n'a été trouvée dans ce PDF.");
      extractBtn.disabled = false;
      return;
    }

    const extracted = []; // { bytes, ext }
    let unsupported = 0;

    for (let i = 0; i < total; i++) {
      const pct = Math.round(((i + 1) / total) * 85);
      setProgress(pct, "Extraction de l'image " + (i + 1) + " / " + total);

      try {
        const found = await extractOneImage(candidates[i], PDFName);
        if (found) {
          extracted.push(found);
        } else {
          unsupported++;
        }
      } catch (imgErr) {
        unsupported++;
      }

      // Laisse le navigateur respirer pour garder la barre de progression fluide
      if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    if (extracted.length === 0) {
      hideProgress();
      showMsg("Aucune image extractible n'a été trouvée dans ce PDF.");
      extractBtn.disabled = false;
      return;
    }

    setProgress(90, "Préparation du téléchargement…");
    const padLength = String(extracted.length).length;
    const named = extracted.map((img, idx) => ({
      name: "image-" + String(idx + 1).padStart(padLength, "0") + "." + img.ext,
      bytes: img.bytes,
    }));

    if (named.length === 1) {
      hideProgress();
      resultText.textContent = "Votre image est prête.";
      const mime = named[0].name.endsWith(".jpg") ? "image/jpeg" : "image/png";
      offerDownload(named[0].bytes, "tchadiapdf-" + named[0].name, mime);
    } else {
      const zip = new JSZip();
      named.forEach((img) => zip.file(img.name, img.bytes));
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(90 + Math.round(meta.percent / 10), "Génération de l'archive ZIP...");
      });
      hideProgress();
      resultText.textContent = named.length + " images ont été extraites.";
      offerDownload(zipBlob, "tchadiapdf-images.zip", "application/zip");
    }

    if (unsupported > 0) {
      showMsg(unsupported + " image(s) dans un format non pris en charge n'ont pas pu être extraites.");
    }
  } catch (e) {
    hideProgress();
    showMsg("L'extraction a échoué. Réessayez avec un autre fichier.");
  } finally {
    extractBtn.disabled = !srcBytes;
  }
});
