/* tchadiaPdf : JPG en PDF */

let images = []; // { file: File }
let orientation = "auto"; // auto | portrait | paysage
let margin = 0;

const A4 = { w: 595.28, h: 841.89 }; // points

const listEl = document.getElementById("fileList");
const convertBtn = document.getElementById("convertBtn");
const imgOptions = document.getElementById("imgOptions");

initDropzone("dropzone", "fileInput", (newFiles) => {
  hideMsg();
  const ok = newFiles.filter((f) => /image\/(jpeg|png)/.test(f.type));
  if (ok.length < newFiles.length) showMsg("Seules les images JPG et PNG sont acceptées, les autres ont été ignorées.");
  images.push(...ok.map((f) => ({ file: f })));
  renderList();
});

function renderList() {
  listEl.innerHTML = "";
  images.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "file-item";
    row.innerHTML =
      '<span class="f-name"></span>' +
      '<span class="f-meta"></span>' +
      '<button class="icon-btn" title="Monter" aria-label="Monter">↑</button>' +
      '<button class="icon-btn" title="Descendre" aria-label="Descendre">↓</button>' +
      '<button class="icon-btn" title="Retirer" aria-label="Retirer">✕</button>';
    row.querySelector(".f-name").textContent = (i + 1) + ". " + item.file.name;
    row.querySelector(".f-meta").textContent = fmtSize(item.file.size);
    const [up, down, del] = row.querySelectorAll("button");
    up.disabled = i === 0;
    down.disabled = i === images.length - 1;
    up.onclick = () => { [images[i - 1], images[i]] = [images[i], images[i - 1]]; renderList(); };
    down.onclick = () => { [images[i + 1], images[i]] = [images[i], images[i + 1]]; renderList(); };
    del.onclick = () => { images.splice(i, 1); renderList(); };
    listEl.appendChild(row);
  });
  imgOptions.style.display = images.length ? "flex" : "none";
  convertBtn.disabled = images.length === 0;
}

function bindSeg(segId, onPick) {
  document.querySelectorAll("#" + segId + " button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#" + segId + " button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onPick(btn.dataset);
    });
  });
}
bindSeg("orientSeg", (d) => { orientation = d.o; });
bindSeg("marginSeg", (d) => { margin = parseInt(d.m, 10); });

convertBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  convertBtn.disabled = true;
  try {
    const { PDFDocument } = PDFLib;
    const doc = await PDFDocument.create();

    for (let i = 0; i < images.length; i++) {
      setProgress(Math.round((i / images.length) * 90), "Ajout de « " + images[i].file.name + " »…");
      const bytes = await readAsArrayBuffer(images[i].file);
      const img = images[i].file.type === "image/png"
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);

      const isLandscape =
        orientation === "paysage" ||
        (orientation === "auto" && img.width > img.height);
      const pageW = isLandscape ? A4.h : A4.w;
      const pageH = isLandscape ? A4.w : A4.h;
      const page = doc.addPage([pageW, pageH]);

      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;
      const scale = Math.min(availW / img.width, availH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: (pageW - w) / 2,
        y: (pageH - h) / 2,
        width: w,
        height: h,
      });
    }

    setProgress(95, "Génération du fichier…");
    const out = await doc.save();
    hideProgress();
    offerDownload(out, "tchadiapdf-images.pdf");
  } catch (e) {
    hideProgress();
    showMsg("La conversion a échoué. Vérifiez que vos images ne sont pas corrompues.");
  } finally {
    convertBtn.disabled = images.length === 0;
  }
});
