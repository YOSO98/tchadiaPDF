/**
 * analytics.js : mesure d'audience respectueuse de la vie privee (tchadiaPdf)
 *
 * Pourquoi Plausible Analytics et pas Google Analytics ?
 * - Plausible ne depose aucun cookie et ne collecte aucune donnee personnelle
 *   (pas d'empreinte numerique, pas d'identifiant croise entre sites).
 * - Cela ne contredit pas la promesse centrale du site ("100% prive, aucun
 *   fichier envoye sur un serveur") : ce script ne mesure que la frequentation
 *   des pages (URL visitee, referrer, pays approximatif via l'IP, jamais
 *   stockee), jamais le contenu des fichiers traites par les outils.
 * - Etant cookie-free et sans donnee personnelle, aucun bandeau de consentement
 *   RGPD n'est requis pour ce script en particulier (contrairement aux
 *   publicites, gerees separement par js/ads.js et js/consent-banner.js).
 *
 * Interrupteur : ce script ne fait STRICTEMENT rien tant que ANALYTICS_ENABLED
 * vaut false ci-dessous (aucun appel reseau). Pour l'activer un jour :
 *   1. Creer un compte sur https://plausible.io (ou heberger une instance
 *      open source de Plausible soi-meme).
 *   2. Declarer le domaine du site dans le tableau de bord Plausible.
 *   3. Passer ANALYTICS_ENABLED a true ci-dessous.
 *   4. Renseigner PLAUSIBLE_DOMAIN avec le domaine exact declare (ex :
 *      "tchadiapdf.com").
 *   5. Ajouter <script defer src="js/analytics.js"></script> sur les pages
 *      HTML du site (passe globale, non faite par ce fichier lui-meme).
 */

// ------------------------------------------------------------------
// INTERRUPTEUR : passer a true uniquement une fois le compte Plausible
// cree et le domaine ci-dessous renseigne avec sa vraie valeur.
// ------------------------------------------------------------------
const ANALYTICS_ENABLED = false;

// Domaine exact declare dans Plausible (ex : "tchadiapdf.com").
// [A COMPLETER] par le proprietaire du site une fois le compte Plausible cree.
const PLAUSIBLE_DOMAIN = "[A COMPLETER : domaine Plausible, ex. tchadiapdf.com]";

// URL du script Plausible. https://plausible.io/js/script.js est l'offre
// hebergee par defaut ; en cas d'auto-hebergement, adapter cette URL.
const PLAUSIBLE_SCRIPT_URL = "https://plausible.io/js/script.js";

(function () {
  if (!ANALYTICS_ENABLED) {
    // Rien : aucun script charge, aucune requete reseau, aucun cookie.
    return;
  }

  if (!PLAUSIBLE_DOMAIN || PLAUSIBLE_DOMAIN.indexOf("A COMPLETER") !== -1) {
    // Garde-fou : on refuse de charger le script tant que le domaine n'a
    // pas ete correctement renseigne, meme si ANALYTICS_ENABLED est true.
    console.warn(
      "[analytics.js] ANALYTICS_ENABLED est a true mais PLAUSIBLE_DOMAIN " +
      "n'est pas configure. Aucun script ne sera charge."
    );
    return;
  }

  var script = document.createElement("script");
  script.defer = true;
  script.setAttribute("data-domain", PLAUSIBLE_DOMAIN);
  script.src = PLAUSIBLE_SCRIPT_URL;
  document.head.appendChild(script);
})();
