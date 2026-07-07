/* tchadiaPdf : bouton de soutien flottant, visible sur toutes les pages.
   Injecte via JS (comme js/consent-banner.js) plutot que duplique dans
   chaque fichier HTML, pour rester maintenable en un seul endroit. */
(function () {
  var LABELS = {
    fr: "Soutenir",
    en: "Support",
    es: "Apoyar",
    pt: "Apoiar",
    ar: "دعم",
  };
  var lang = (document.documentElement.getAttribute("lang") || "fr").slice(0, 2);
  var label = LABELS[lang] || LABELS.fr;

  var HEART =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';

  var link = document.createElement("a");
  link.href = "soutenir.html";
  link.className = "support-fab";
  link.innerHTML = HEART + '<span class="fab-label">' + label + "</span>";

  function mount() {
    document.body.appendChild(link);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
