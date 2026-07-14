/**
 * font-loader.js : bascule non bloquante de la police Inter (Google Fonts).
 *
 * Le <link> de la feuille de style Google Fonts est charge avec
 * media="print" (ne bloque donc jamais le premier rendu, qui utilise la
 * police de secours du systeme le temps que la vraie police arrive), et un
 * attribut data-font-swap le marque pour ce script. Une fois la feuille
 * effectivement chargee, on repasse media a "all" pour l'appliquer.
 *
 * Volontairement un fichier externe (pas un attribut onload="..." inline
 * sur le <link>, plus simple mais interdit par la Content-Security-Policy
 * du site : script-src ne contient pas 'unsafe-inline', voir _headers).
 *
 * link.sheet est deja non nul si la feuille a fini de charger AVANT que ce
 * script (charge en async) ne s'execute : on bascule alors immediatement
 * plutot que d'attendre un evenement "load" qui ne se redeclenchera pas.
 */
(function () {
  var links = document.querySelectorAll("link[data-font-swap]");
  links.forEach(function (link) {
    function swap() {
      link.media = "all";
    }
    if (link.sheet) swap();
    else link.addEventListener("load", swap);
  });
})();
