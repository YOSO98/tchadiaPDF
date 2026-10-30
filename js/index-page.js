/* tchadiaPdf : comportements propres a la page d'accueil (sans attribut onchange inline, CSP stricte) */
(function () {
  var select = document.getElementById("langSwitch");
  if (!select) return;
  select.addEventListener("change", function () {
    if (select.value) window.location.href = select.value;
  });
})();

/* Recherche d'outils : menu deroulant de suggestions (comme Google/Spotlight),
   navigable au clavier (fleches, Entree, Echap), qui ouvre directement l'outil
   choisi. La liste des outils est construite une seule fois a partir des
   cartes deja presentes dans la page (nom, description, icone, lien) : aucune
   donnee dupliquee ailleurs. Raccourci clavier "/" pour cibler le champ (sauf
   si l'utilisateur est deja dans un champ de saisie). Aucune bibliotheque
   externe, aucun envoi reseau. */
(function () {
  var input = document.getElementById("toolSearch");
  if (!input) return;
  var searchWrap = document.getElementById("toolSearchWrap");
  var resultsEl = document.getElementById("toolSearchResults");
  var cards = Array.prototype.slice.call(document.querySelectorAll(".tool-card"));

  var seenHrefs = {};
  var TOOLS = cards
    .map(function (card) {
      var heading = card.querySelector("h2, h3");
      var p = card.querySelector("p");
      var svg = card.querySelector("svg");
      return {
        href: card.getAttribute("href"),
        title: heading ? heading.textContent.trim() : "",
        desc: p ? p.textContent.trim() : "",
        iconHTML: svg ? svg.outerHTML : "",
      };
    })
    .filter(function (t) {
      // Un meme outil peut apparaitre dans plusieurs sections : une seule entree.
      if (!t.href || !t.title || seenHrefs[t.href]) return false;
      seenHrefs[t.href] = true;
      return true;
    });

  var POPULAR = ["/fusionner", "/compresser-pdf", "/modifier-pdf", "/word-en-pdf"]
    .map(function (href) {
      for (var i = 0; i < TOOLS.length; i++) {
        if (TOOLS[i].href === href) return TOOLS[i];
      }
      return null;
    })
    .filter(Boolean);

  function normalize(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  /** Les titres qui commencent par la recherche remontent avant ceux qui la
   * contiennent seulement (dans le titre, puis dans la description). */
  function search(query) {
    var q = normalize(query);
    if (!q) return [];
    var starts = [];
    var contains = [];
    TOOLS.forEach(function (t) {
      var title = normalize(t.title);
      var desc = normalize(t.desc);
      if (title.indexOf(q) === 0) starts.push(t);
      else if (title.indexOf(q) !== -1 || desc.indexOf(q) !== -1) contains.push(t);
    });
    return starts.concat(contains).slice(0, 8);
  }

  var currentResults = [];
  var activeIndex = -1;

  function buildResultRow(tool, index) {
    var a = document.createElement("a");
    a.href = tool.href;
    a.className = "tool-search-result";
    a.setAttribute("role", "option");
    a.id = "toolSearchResult-" + index;

    var icon = document.createElement("span");
    icon.className = "tool-search-result-icon";
    icon.innerHTML = tool.iconHTML; // SVG statique du site lui-meme, jamais de contenu utilisateur

    var text = document.createElement("span");
    var title = document.createElement("span");
    title.className = "tool-search-result-title";
    title.textContent = tool.title;
    var desc = document.createElement("span");
    desc.className = "tool-search-result-desc";
    desc.textContent = tool.desc;
    text.appendChild(title);
    text.appendChild(desc);

    a.appendChild(icon);
    a.appendChild(text);
    a.addEventListener("mouseenter", function () {
      setActive(index);
    });
    return a;
  }

  function buildEmptyState(query) {
    var wrap = document.createElement("div");
    wrap.className = "tool-search-empty-state";

    var strong = document.createElement("strong");
    strong.textContent = "Aucun outil ne correspond à « " + query + " ».";
    wrap.appendChild(strong);

    if (POPULAR.length) {
      var popularLabel = document.createElement("p");
      popularLabel.textContent = "Outils populaires :";
      wrap.appendChild(popularLabel);

      var popularWrap = document.createElement("div");
      popularWrap.className = "tool-search-popular";
      POPULAR.forEach(function (t) {
        var a = document.createElement("a");
        a.href = t.href;
        a.textContent = t.title;
        popularWrap.appendChild(a);
      });
      wrap.appendChild(popularWrap);
    }

    var seeAll = document.createElement("p");
    var link = document.createElement("a");
    link.href = "/conversions";
    link.textContent = "Voir toutes les conversions";
    seeAll.appendChild(link);
    wrap.appendChild(seeAll);

    return wrap;
  }

  function renderResults(query) {
    resultsEl.innerHTML = "";
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");

    var trimmed = query.trim();
    if (!trimmed) {
      hideResults();
      return;
    }

    currentResults = search(trimmed);

    if (currentResults.length === 0) {
      resultsEl.appendChild(buildEmptyState(trimmed));
    } else {
      currentResults.forEach(function (tool, i) {
        resultsEl.appendChild(buildResultRow(tool, i));
      });
    }
    showResults();
  }

  function showResults() {
    resultsEl.hidden = false;
    requestAnimationFrame(function () {
      resultsEl.classList.add("visible");
    });
    input.setAttribute("aria-expanded", "true");
  }

  function hideResults() {
    resultsEl.classList.remove("visible");
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    setTimeout(function () {
      if (!resultsEl.classList.contains("visible")) resultsEl.hidden = true;
    }, 200);
  }

  function setActive(index) {
    var options = resultsEl.querySelectorAll(".tool-search-result");
    options.forEach(function (el) {
      el.classList.remove("active");
      el.setAttribute("aria-selected", "false");
    });
    activeIndex = index;
    if (index >= 0 && options[index]) {
      options[index].classList.add("active");
      options[index].setAttribute("aria-selected", "true");
      options[index].scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", options[index].id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  input.addEventListener("input", function () {
    renderResults(input.value);
  });

  input.addEventListener("focus", function () {
    if (input.value.trim()) renderResults(input.value);
  });

  // Reprend une recherche lancee depuis une autre page (ex. la page 404),
  // via ?q=... dans l'URL : pre-remplit le champ et simule une saisie pour
  // reutiliser exactement le meme moteur de recherche, sans en dupliquer un.
  (function () {
    var params = new URLSearchParams(window.location.search);
    var q = params.get("q");
    if (!q) return;
    input.value = q;
    input.dispatchEvent(new Event("input"));
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  })();

  input.addEventListener("keydown", function (e) {
    var options = resultsEl.querySelectorAll(".tool-search-result");
    if (e.key === "ArrowDown") {
      if (!options.length) return;
      e.preventDefault();
      setActive(activeIndex < options.length - 1 ? activeIndex + 1 : 0);
    } else if (e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      setActive(activeIndex > 0 ? activeIndex - 1 : options.length - 1);
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault();
        window.location.href = options[activeIndex].getAttribute("href");
      } else if (currentResults.length === 1) {
        window.location.href = currentResults[0].href;
      }
    } else if (e.key === "Escape") {
      if (resultsEl.classList.contains("visible")) {
        hideResults();
      } else {
        input.value = "";
        input.blur();
      }
    }
  });

  document.addEventListener("click", function (e) {
    if (searchWrap && !searchWrap.contains(e.target)) hideResults();
  });

  document.addEventListener("keydown", function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (e.key === "/" && !typing) {
      e.preventDefault();
      input.focus();
    }
  });

  // Placeholder rotatif : uniquement au repos (champ vide, non focalise), ne
  // vole jamais le focus, s'arrete des que l'utilisateur interagit.
  var PLACEHOLDERS = [
    "Rechercher parmi " + TOOLS.length + " outils...",
    "Rechercher : fusionner des PDF...",
    "Rechercher : Word en PDF...",
    "Rechercher : compresser...",
  ];
  var placeholderIndex = 0;
  setInterval(function () {
    if (document.activeElement === input || input.value) return;
    input.classList.add("placeholder-fade");
    setTimeout(function () {
      placeholderIndex = (placeholderIndex + 1) % PLACEHOLDERS.length;
      input.placeholder = PLACEHOLDERS[placeholderIndex];
      input.classList.remove("placeholder-fade");
    }, 220);
  }, 3000);
})();

/* Routage intelligent : deposer un fichier n'importe ou sur la page detecte
   son vrai type (octets magiques, js/security-utils.js) et redirige vers
   l'outil le plus pertinent, avec le fichier deja charge (transfert via
   IndexedDB, consomme automatiquement par initDropzone sur la page cible). */
(function () {
  var overlay = document.getElementById("dropRouterOverlay");
  if (!overlay || typeof sniffFileType !== "function" || typeof savePendingFile !== "function") return;

  var ROUTES = {
    pdf: "/modifier-pdf",
    docx: "/word-en-pdf",
    xlsx: "/excel-en-pdf",
    pptx: "/powerpoint-en-pdf",
    epub: "/epub-en-pdf",
    heic: "/heic-en-pdf",
    tiff: "/tiff-en-pdf",
    webp: "/webp-en-pdf",
    bmp: "/bmp-en-pdf",
    jpeg: "/jpg-en-pdf",
    png: "/jpg-en-pdf",
    texte: "/texte-en-pdf",
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

  // Zone de depot compacte et persistante du hero : meme routage que le
  // survol de la page entiere, mais accessible au clic (choix de fichier)
  // sans avoir a faire glisser quoi que ce soit.
  if (document.getElementById("heroDropzone") && typeof initDropzone === "function") {
    initDropzone("heroDropzone", "heroFileInput", function (files) {
      if (files && files.length) routeFile(files[0]);
    });
  }

  function showMsgOnHome(text) {
    var el = document.getElementById("msg");
    if (!el) {
      el = document.createElement("div");
      el.id = "msg";
      el.className = "msg container";
      var hero = document.querySelector(".hero");
      if (hero) hero.insertAdjacentElement("afterend", el);
    }
    var full = text + " Voir la page Conversions.";
    if (typeof showMsg === "function") {
      showMsg(full);
    } else {
      el.textContent = full;
      el.classList.add("visible");
    }
    el.scrollIntoView({ block: "center" });
  }
})();

/* Filtre du catalogue d'outils par categorie (boutons a bascule), instantane,
   sans rechargement. "Populaires" (par defaut) n'affiche que les cartes
   marquees data-popular ; "Tous" reaffiche l'integralite du catalogue. Toutes
   les cartes restent dans le DOM (referencement), seul l'affichage change. */
(function () {
  var tabs = document.querySelectorAll(".category-tabs button");
  var catalog = document.getElementById("toolsCatalog");
  if (!tabs.length || !catalog) return;
  var cards = Array.prototype.slice.call(catalog.querySelectorAll(".tool-card"));
  var status = document.getElementById("catalogStatus");
  var lang = (document.documentElement.getAttribute("lang") || "fr").slice(0, 2);
  var STATUS = {
    fr: function (n) { return n + " outil" + (n > 1 ? "s" : "") + " affiché" + (n > 1 ? "s" : ""); },
    en: function (n) { return n + " tool" + (n > 1 ? "s" : "") + " shown"; },
    es: function (n) { return n + " herramienta" + (n > 1 ? "s" : "") + " mostrada" + (n > 1 ? "s" : ""); },
    pt: function (n) { return n + " ferramenta" + (n > 1 ? "s" : "") + " apresentada" + (n > 1 ? "s" : ""); },
    ar: function (n) { return n + " أداة معروضة"; },
  };

  function applyFilter(filter) {
    var shown = 0;
    cards.forEach(function (card) {
      var match =
        filter === "tous" ||
        (filter === "populaires" && card.hasAttribute("data-popular")) ||
        card.dataset.category === filter;
      card.classList.toggle("tool-card-hidden", !match);
      if (match) shown++;
    });
    if (status) status.textContent = (STATUS[lang] || STATUS.fr)(shown);
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) {
        t.classList.remove("active");
        t.setAttribute("aria-pressed", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-pressed", "true");
      applyFilter(tab.dataset.filter);
    });
  });

  var initial = document.querySelector(".category-tabs button.active");
  if (initial && initial.dataset.filter !== "tous") applyFilter(initial.dataset.filter);
})();
