/* tchadiaPdf : Fusionner PDF */

let files = []; // { file: File }

const listEl = document.getElementById("fileList");
const mergeBtn = document.getElementById("mergeBtn");

initDropzone("dropzone", "fileInput", (newFiles) => {
  hideMsg();
  const pdfs = newFiles.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length < newFiles.length) showMsg("Seuls les fichiers PDF sont acceptés, les autres ont été ignorés.");
  files.push(...pdfs.map((f) => ({ file: f })));
  renderList();
});

function renderList() {
  listEl.innerHTML = "";
  files.forEach((item, i) => {
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
    down.disabled = i === files.length - 1;
    up.onclick = () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; renderList(); };
    down.onclick = () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; renderList(); };
    del.onclick = () => { files.splice(i, 1); renderList(); };
    listEl.appendChild(row);
  });
  mergeBtn.disabled = files.length < 2;
}

mergeBtn.addEventListener("click", async () => {
  hideMsg();
  document.getElementById("result").classList.remove("visible");
  mergeBtn.disabled = true;
  try {
    const { PDFDocument } = PDFLib;
    const merged = await PDFDocument.create();

    for (let i = 0; i < files.length; i++) {
      setProgress(Math.round((i / files.length) * 90), "Fusion de « " + files[i].file.name + " »…");
      const bytes = await readAsArrayBuffer(files[i].file);
      let src;
      try {
        src = await PDFDocument.load(bytes, { ignoreEncryption: false });
      } catch (e) {
        throw new Error("« " + files[i].file.name + " » est protégé par mot de passe ou endommagé. Retirez-le de la liste et réessayez.");
      }
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }

    setProgress(95, "Génération du fichier final…");
    const out = await merged.save();
    setProgress(100, "Terminé");
    hideProgress();
    offerDownload(out, "tchadiapdf-fusionne.pdf");
  } catch (err) {
    hideProgress();
    showMsg(err.message || "La fusion a échoué. Vérifiez vos fichiers et réessayez.");
  } finally {
    mergeBtn.disabled = files.length < 2;
  }
});
