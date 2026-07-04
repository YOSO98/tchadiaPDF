/* tchadiaPdf : Comparer deux PDF */

const THUMB_WIDTH = 260;
const DIFF_TOLERANCE = 30;

let pdfA = null;
let pdfB = null;
let fileA = null;
let fileB = null;
let numPagesA = 0;
let numPagesB = 0;
let pageCount = 0;
let currentPage = 0;
let pagesData = []; // { width, height, imgA, imgB, imgDiff, differs, hasA, hasB }

const fileListA = document.getElementById("fileListA");
const fileListB = document.getElementById("fileListB");
const compareBtn = document.getElementById("compareBtn");
const compareResult = document.getElementById("compareResult");
const compareSummary = document.getElementById("compareSummary");
const pageIndicator = document.getElementById("pageIndicator");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const canvasA = document.getElementById("canvasA");
const canvasB = document.getElementById("canvasB");
const canvasDiff = document.getElementById("canvasDiff");

initDropzone("dropzoneA", "fileInputA", (files) => handleFile("A", files[0]));
initDropzone("dropzoneB", "fileInputB", (files) => handleFile("B", files[0]));

async function handleFile(which, file) {
  hideMsg();
  hideResult();
  const label = which === "A" ? "Fichier A" : "Fichier B";

  if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    showMsg(label + " : veuillez choisir un fichier PDF.");
    return;
  }

  try {
    setProgress(20, "Lecture de « " + file.name + " »…");
    const buf = await readAsArrayBuffer(file);
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    } catch (e) {
      throw new Error(label + " : impossible d'ouvrir ce PDF. Il est peut-être protégé par mot de passe ou endommagé.");
    }
    if (which === "A") {
      pdfA = pdf;
      fileA = file;
      numPagesA = pdf.numPages;
      renderFileSlot("A", file);
    } else {
      pdfB = pdf;
      fileB = file;
      numPagesB = pdf.numPages;
      renderFileSlot("B", file);
    }
    hideProgress();
  } catch (err) {
    hideProgress();
    if (which === "A") { pdfA = null; fileA = null; numPagesA = 0; clearFileSlot("A"); }
    else { pdfB = null; fileB = null; numPagesB = 0; clearFileSlot("B"); }
    showMsg(err.message || (label + " : impossible d'ouvrir ce PDF."));
  }
  updateCompareBtn();
}

function renderFileSlot(which, file) {
  const list = which === "A" ? fileListA : fileListB;
  list.innerHTML = "";
  const row = document.createElement("div");
  row.className = "file-item";
  row.innerHTML =
    '<span class="f-name"></span>' +
    '<span class="f-meta"></span>' +
    '<button class="icon-btn" title="Retirer" aria-label="Retirer le fichier ' + (which === "A" ? "A" : "B") + '">✕</button>';
  row.querySelector(".f-name").textContent = file.name;
  row.querySelector(".f-meta").textContent = fmtSize(file.size);
  row.querySelector("button").addEventListener("click", () => {
    if (which === "A") { pdfA = null; fileA = null; numPagesA = 0; }
    else { pdfB = null; fileB = null; numPagesB = 0; }
    clearFileSlot(which);
    hideResult();
    hideMsg();
    updateCompareBtn();
  });
  list.appendChild(row);
}

function clearFileSlot(which) {
  const list = which === "A" ? fileListA : fileListB;
  list.innerHTML = "";
}

function updateCompareBtn() {
  compareBtn.disabled = !(pdfA && pdfB);
}

function hideResult() {
  compareResult.classList.remove("visible");
}

compareBtn.addEventListener("click", async () => {
  hideMsg();
  compareBtn.disabled = true;
  try {
    numPagesA = pdfA.numPages;
    numPagesB = pdfB.numPages;
    pageCount = Math.max(numPagesA, numPagesB);
    pagesData = [];

    for (let i = 0; i < pageCount; i++) {
      setProgress(Math.round(((i + 1) / pageCount) * 100), "Comparaison de la page " + (i + 1) + " / " + pageCount + "…");
      try {
        pagesData.push(await buildPageData(i));
      } catch (e) {
        throw new Error("La comparaison a échoué à la page " + (i + 1) + ". Le fichier concerné est peut-être endommagé.");
      }
    }

    hideProgress();
    showSummary();
    currentPage = 0;
    compareResult.classList.add("visible");
    showPage(currentPage);
    compareResult.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    hideProgress();
    showMsg(err.message || "La comparaison a échoué. Réessayez avec d'autres fichiers.");
  } finally {
    compareBtn.disabled = !(pdfA && pdfB);
  }
});

async function buildPageData(pageIndex) {
  const hasA = pageIndex < numPagesA;
  const hasB = pageIndex < numPagesB;

  let baseViewport;
  if (hasA) {
    const page = await pdfA.getPage(pageIndex + 1);
    baseViewport = page.getViewport({ scale: 1 });
  } else {
    const page = await pdfB.getPage(pageIndex + 1);
    baseViewport = page.getViewport({ scale: 1 });
  }
  const scale = THUMB_WIDTH / baseViewport.width;
  const width = Math.max(1, Math.round(baseViewport.width * scale));
  const height = Math.max(1, Math.round(baseViewport.height * scale));

  const canvasFilledA = hasA
    ? await renderPageScaled(pdfA, pageIndex + 1, width, height)
    : missingCanvas(width, height);
  const canvasFilledB = hasB
    ? await renderPageScaled(pdfB, pageIndex + 1, width, height)
    : missingCanvas(width, height);

  const ctxA = canvasFilledA.getContext("2d");
  const ctxB = canvasFilledB.getContext("2d");
  const imgA = ctxA.getImageData(0, 0, width, height);
  const imgB = ctxB.getImageData(0, 0, width, height);
  const imgDiff = ctxA.createImageData(width, height);

  const dataA = imgA.data;
  const dataB = imgB.data;
  const dataD = imgDiff.data;
  let differs = !hasA || !hasB;

  for (let i = 0; i < dataA.length; i += 4) {
    const rA = dataA[i], gA = dataA[i + 1], bA = dataA[i + 2];
    const rB = dataB[i], gB = dataB[i + 1], bB = dataB[i + 2];
    const delta = Math.abs(rA - rB) + Math.abs(gA - gB) + Math.abs(bA - bB);
    if (delta > DIFF_TOLERANCE) {
      dataD[i] = 37;
      dataD[i + 1] = 99;
      dataD[i + 2] = 235;
      dataD[i + 3] = 255;
      differs = true;
    } else {
      dataD[i] = rA >> 1;
      dataD[i + 1] = gA >> 1;
      dataD[i + 2] = bA >> 1;
      dataD[i + 3] = 255;
    }
  }

  return { width, height, imgA, imgB, imgDiff, differs, hasA, hasB };
}

/** Rend une page PDF puis la redessine dans un canvas de dimensions cibles exactes. */
async function renderPageScaled(pdfDoc, pageNum, targetW, targetH) {
  const page = await pdfDoc.getPage(pageNum);
  const naturalViewport = page.getViewport({ scale: 1 });
  const scale = targetW / naturalViewport.width;
  const viewport = page.getViewport({ scale });

  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.round(viewport.width));
  off.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvasContext: off.getContext("2d"), viewport }).promise;

  const final = document.createElement("canvas");
  final.width = targetW;
  final.height = targetH;
  const ctx = final.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, targetW, targetH);
  return final;
}

function missingCanvas(width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#64748B";
  ctx.font = "13px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Page absente", width / 2, height / 2);
  return c;
}

function showSummary() {
  let text = "";
  if (numPagesA !== numPagesB) {
    text += "Les documents ont un nombre de pages différent : A a " + numPagesA + (numPagesA > 1 ? " pages" : " page") +
      ", B a " + numPagesB + (numPagesB > 1 ? " pages" : " page") + ". ";
  }
  const diffCount = pagesData.filter((p) => p.differs).length;
  if (diffCount === 0) {
    text += "Aucune différence détectée sur les " + pageCount + (pageCount > 1 ? " pages." : " page.");
  } else if (diffCount === 1) {
    text += "1 page sur " + pageCount + " diffère.";
  } else {
    text += diffCount + " pages sur " + pageCount + " diffèrent.";
  }
  compareSummary.textContent = text;
}

function showPage(index) {
  const data = pagesData[index];
  if (!data) return;

  [canvasA, canvasB, canvasDiff].forEach((c) => {
    c.width = data.width;
    c.height = data.height;
  });
  canvasA.getContext("2d").putImageData(data.imgA, 0, 0);
  canvasB.getContext("2d").putImageData(data.imgB, 0, 0);
  canvasDiff.getContext("2d").putImageData(data.imgDiff, 0, 0);

  pageIndicator.textContent = "Page " + (index + 1) + " / " + pageCount;
  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === pageCount - 1;
}

prevBtn.addEventListener("click", () => {
  if (currentPage > 0) {
    currentPage -= 1;
    showPage(currentPage);
  }
});
nextBtn.addEventListener("click", () => {
  if (currentPage < pageCount - 1) {
    currentPage += 1;
    showPage(currentPage);
  }
});
