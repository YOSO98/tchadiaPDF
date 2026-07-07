/* tchadiaPdf : comportements propres a la page d'accueil (sans attribut onchange inline, CSP stricte) */
(function () {
  var select = document.getElementById("langSwitch");
  if (!select) return;
  select.addEventListener("change", function () {
    if (select.value) window.location.href = select.value;
  });
})();

/* Recherche d'outils en temps reel : filtre les cartes par titre/description,
   masque les sous-groupes et categories devenus vides. Raccourci clavier "/"
   pour cibler le champ (sauf si l'utilisateur est deja dans un champ de
   saisie), Echap pour vider. Aucune bibliotheque externe, aucun envoi reseau. */
(function () {
  var input = document.getElementById("toolSearch");
  if (!input) return;
  var emptyMsg = document.getElementById("toolSearchEmpty");
  var cards = Array.prototype.slice.call(document.querySelectorAll(".tool-card"));

  function normalize(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function applyFilter() {
    var query = normalize(input.value.trim());
    var visibleCount = 0;

    cards.forEach(function (card) {
      var title = card.querySelector("h2");
      var desc = card.querySelector("p");
      var haystack = normalize((title ? title.textContent : "") + " " + (desc ? desc.textContent : ""));
      var match = query === "" || haystack.indexOf(query) !== -1;
      card.classList.toggle("search-hidden", !match);
      if (match) visibleCount++;
    });

    // Masque les sous-groupes ("Vers PDF", "Depuis PDF", "Images") et
    // categories entierement vides une fois le filtre applique.
    document.querySelectorAll(".tool-subgroup").forEach(function (group) {
      var anyVisible = group.querySelectorAll(".tool-card:not(.search-hidden)").length > 0;
      group.classList.toggle("search-hidden", query !== "" && !anyVisible);
    });
    document.querySelectorAll(".tool-category").forEach(function (cat) {
      var anyVisible = cat.querySelectorAll(".tool-card:not(.search-hidden)").length > 0;
      cat.classList.toggle("search-hidden", query !== "" && !anyVisible);
    });

    if (emptyMsg) emptyMsg.hidden = !(query !== "" && visibleCount === 0);
  }

  input.addEventListener("input", applyFilter);

  document.addEventListener("keydown", function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (e.key === "/" && !typing) {
      e.preventDefault();
      input.focus();
    } else if (e.key === "Escape" && document.activeElement === input) {
      input.value = "";
      applyFilter();
      input.blur();
    }
  });
})();

/* Routage intelligent : deposer un fichier n'importe ou sur la page detecte
   son vrai type (octets magiques, js/security-utils.js) et redirige vers
   l'outil le plus pertinent, avec le fichier deja charge (transfert via
   IndexedDB, consomme automatiquement par initDropzone sur la page cible). */
(function () {
  var overlay = document.getElementById("dropRouterOverlay");
  if (!overlay || typeof sniffFileType !== "function" || typeof savePendingFile !== "function") return;

  var ROUTES = {
    pdf: "modifier-pdf.html",
    docx: "word-en-pdf.html",
    xlsx: "excel-en-pdf.html",
    pptx: "powerpoint-en-pdf.html",
    epub: "epub-en-pdf.html",
    heic: "heic-en-pdf.html",
    tiff: "tiff-en-pdf.html",
    webp: "webp-en-pdf.html",
    bmp: "bmp-en-pdf.html",
    jpeg: "jpg-en-pdf.html",
    png: "jpg-en-pdf.html",
    texte: "texte-en-pdf.html",
  };

  var dragDepth = 0;

  function showOverlay() {
    overlay.classList.add("visible");
  }
  function hideOverlay() {
    dragDepth = 0;
    overlay.classList.remove("visible");
  }

  window.addEventListener("dragenter", function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") === -1) return;
    dragDepth++;
    showOverlay();
  });
  window.addEventListener("dragover", function (e) {
    e.preventDefault();
  });
  window.addEventListener("dragleave", function () {
    dragDepth--;
    if (dragDepth <= 0) hideOverlay();
  });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    hideOverlay();
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;
    routeFile(files[0]);
  });

  function routeFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result);
      var kind = sniffFileType(bytes);
      var destination = ROUTES[kind];
      if (!destination) {
        showMsgOnHome(
          kind === "inconnu"
            ? "Format de fichier non reconnu. Consultez la liste complète des conversions."
            : "Aucun outil ne correspond directement à ce type de fichier pour l'instant. Consultez la liste complète des conversions."
        );
        return;
      }
      savePendingFile(file).then(function () {
        window.location.href = destination;
      });
    };
    reader.onerror = function () {
      showMsgOnHome("Impossible de lire ce fichier.");
    };
    reader.readAsArrayBuffer(file.slice(0, 65536));
  }

  function showMsgOnHome(text) {
    var el = document.getElementById("msg");
    if (!el) {
      el = document.createElement("div");
      el.id = "msg";
      el.className = "msg container";
      el.style.marginTop = "16px";
      var hero = document.querySelector(".hero");
      if (hero) hero.insertAdjacentElement("afterend", el);
    }
    el.textContent = "ⓘ " + text + " Voir conversions.html.";
    el.classList.add("visible");
  }
})();
