/**
 * ads.js : chargement conditionnel de Google AdSense (tchadiaPdf)
 *
 * Regle absolue, appliquee par DEUX gardes independantes et cumulatives
 * dans tchadiapdfInitAds() ci-dessous, verifiees a chaque appel (pas
 * seulement au chargement initial) :
 *   1. Consentement : tant que l'utilisateur n'a pas explicitement accepte
 *      les publicites via le bandeau de consentement (js/consent-banner.js),
 *      ce script ne fait STRICTEMENT rien.
 *   2. Configuration : tant que ADSENSE_CLIENT_ID ci-dessous n'a pas ete
 *      remplace par un vrai identifiant AdSense (voir
 *      tchadiapdfIsAdsensePlaceholder), ce script ne fait STRICTEMENT rien
 *      non plus, MEME si le consentement a ete donne.
 * Dans les deux cas : aucune requete reseau vers Google, aucun cookie,
 * aucune modification du DOM. Le placeholder "Espace publicitaire" des
 * blocs .ad-slot reste affiche tel quel.
 *
 * Cle localStorage partagee avec consent-banner.js :
 *   "tchadiapdf_ad_consent" -> "granted" | "denied"
 *
 * Configuration requise avant mise en production, seul endroit du fichier
 * a modifier :
 *   - Remplacer ADSENSE_CLIENT_ID ci-dessous par l'ID client reel obtenu
 *     apres validation du compte Google AdSense (format "ca-pub-XXXXXXXXXXXXXXXX").
 *   - Remplacer ADSENSE_SLOT_ID par l'ID de bloc d'annonce reel (optionnel :
 *     un seul slot "responsive" peut suffire pour tous les emplacements).
 *   - Voir ADSENSE.md a la racine du projet pour la procedure complete.
 */

// [A COMPLETER] une fois le compte AdSense approuve : ID client (ca-pub-...).
// C'est la SEULE constante a modifier pour activer les publicites (avec
// ADSENSE_SLOT_ID juste en dessous) : tout le reste du fichier lit
// exclusivement cette valeur, jamais de duplication ailleurs.
const ADSENSE_CLIENT_ID = "[A COMPLETER : ca-pub-XXXXXXXXXXXXXXXX]";

// [A COMPLETER] : ID de bloc d'annonce (data-ad-slot). Un slot "auto" /
// responsive unique peut etre reutilise sur tous les .ad-slot du site.
const ADSENSE_SLOT_ID = "[A COMPLETER : ID de bloc AdSense]";

const AD_CONSENT_KEY = "tchadiapdf_ad_consent";
const AD_CONSENT_GRANTED = "granted";

const ADSENSE_SCRIPT_URL =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

var tchadiapdfAdsInitialized = false;

/**
 * Vrai si `value` est absente, vide, ou reconnaissable comme placeholder
 * jamais renseigne (contient "XXXX" ou "A COMPLETER", insensible a la
 * casse). Utilisee pour ADSENSE_CLIENT_ID et ADSENSE_SLOT_ID : aucune des
 * deux constantes n'est jamais inspectee ailleurs dans ce fichier via un
 * autre motif, pour ne garder qu'une seule definition de "non configure".
 */
function tchadiapdfIsAdsensePlaceholder(value) {
  if (!value) return true;
  var upper = String(value).toUpperCase();
  return upper.indexOf("XXXX") !== -1 || upper.indexOf("A COMPLETER") !== -1;
}

function tchadiapdfHasAdConsent() {
  try {
    return window.localStorage.getItem(AD_CONSENT_KEY) === AD_CONSENT_GRANTED;
  } catch (e) {
    // localStorage indisponible (navigation privee stricte, etc.) : par
    // prudence on considere qu'il n'y a pas de consentement.
    return false;
  }
}

function tchadiapdfPopulateAdSlots() {
  var slots = document.querySelectorAll(".ad-slot");
  slots.forEach(function (slot) {
    if (slot.getAttribute("data-ads-populated") === "true") {
      return;
    }
    slot.setAttribute("data-ads-populated", "true");
    slot.textContent = "";
    slot.removeAttribute("aria-hidden");

    var ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", ADSENSE_CLIENT_ID);
    if (!tchadiapdfIsAdsensePlaceholder(ADSENSE_SLOT_ID)) {
      ins.setAttribute("data-ad-slot", ADSENSE_SLOT_ID);
    }
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");

    slot.appendChild(ins);

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      // Si le script AdSense n'est pas encore charge/valide (ex. ID
      // placeholder), on ignore silencieusement : le bloc reste vide
      // plutot que de faire planter la page.
    }
  });
}

function tchadiapdfLoadAdsenseScript() {
  var script = document.createElement("script");
  script.async = true;
  script.src = ADSENSE_SCRIPT_URL + "?client=" + encodeURIComponent(ADSENSE_CLIENT_ID);
  script.crossOrigin = "anonymous";
  script.onload = tchadiapdfPopulateAdSlots;
  document.head.appendChild(script);
}

function tchadiapdfInitAds() {
  if (tchadiapdfAdsInitialized) {
    return;
  }
  if (!tchadiapdfHasAdConsent()) {
    // Pas de consentement : on ne fait rien, le placeholder reste affiche.
    // Cette garde doit toujours s'evaluer AVANT celle de la configuration
    // ci-dessous, meme avec un ID reel deja renseigne : c'est la promesse
    // faite dans le bandeau de consentement (js/consent-banner.js).
    return;
  }
  if (tchadiapdfIsAdsensePlaceholder(ADSENSE_CLIENT_ID)) {
    // Consentement donne, mais ADSENSE_CLIENT_ID n'a pas encore ete
    // renseigne avec l'ID reel (voir ADSENSE.md) : on ne charge RIEN,
    // silencieusement cote reseau (aucune requete vers Google, aucun
    // cookie). Le console.warn est purement informatif pour un
    // developpeur qui a active le consentement en test ; il ne declenche
    // aucun chargement.
    console.warn(
      "[ads.js] Consentement publicitaire accorde, mais ADSENSE_CLIENT_ID " +
      "n'est pas encore configure (voir ADSENSE.md) : aucune publicite chargee."
    );
    return;
  }
  tchadiapdfAdsInitialized = true;
  tchadiapdfLoadAdsenseScript();
}

// Lancement initial : si le consentement a deja ete donne lors d'une visite
// precedente, les publicites se chargent des ce chargement de page.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tchadiapdfInitAds);
} else {
  tchadiapdfInitAds();
}

// Si l'utilisateur accepte le bandeau de consentement pendant la session en
// cours (sans recharger la page), consent-banner.js declenche cet evenement
// pour activer les publicites immediatement.
window.addEventListener("tchadiapdf:consent-changed", function (event) {
  if (event && event.detail && event.detail.consent === AD_CONSENT_GRANTED) {
    tchadiapdfInitAds();
  }
});
