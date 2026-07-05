/**
 * consent-banner.js : bandeau de consentement publicitaire (tchadiaPdf)
 *
 * Affiche un bandeau simple en bas de page tant qu'aucun choix n'a ete
 * enregistre dans localStorage. Deux boutons :
 *   - "Accepter" : enregistre le consentement et declenche le chargement
 *     de js/ads.js (via l'evenement "tchadiapdf:consent-changed").
 *   - "Refuser" : enregistre le refus ; le site continue de fonctionner
 *     normalement, sans aucune publicite ni requete vers Google.
 *
 * Cle localStorage partagee avec js/ads.js :
 *   "tchadiapdf_ad_consent" -> "granted" | "denied"
 *
 * Ce script est autonome : il injecte son propre <style> (classes
 * consent-banner*) afin d'etre testable sans dependre de css/style.css.
 * Ces regles devront ensuite etre deplacees dans css/style.css (voir le
 * bloc CSS documente separement) ; le <style> injecte ici peut alors etre
 * retire de ce fichier sans changer le comportement.
 *
 * Reouverture : n'importe quelle page peut proposer un lien "Gerer les
 * publicites" dans le footer qui appelle window.tchadiapdfReopenConsentBanner()
 * pour raffricher son choix a tout moment (voir le rapport de livraison
 * pour le marquage HTML exact a ajouter au footer partage).
 */

(function () {
  var AD_CONSENT_KEY = "tchadiapdf_ad_consent";
  var CONSENT_GRANTED = "granted";
  var CONSENT_DENIED = "denied";
  var BANNER_ID = "tchadiapdf-consent-banner";
  var STYLE_ID = "tchadiapdf-consent-banner-styles";

  var BANNER_STYLES =
    "/* Bandeau de consentement (publicite / analytics) */\n" +
    ".consent-banner {\n" +
    "  position: fixed;\n" +
    "  left: 0;\n" +
    "  right: 0;\n" +
    "  bottom: 0;\n" +
    "  z-index: 1000;\n" +
    "  background: var(--white, #FFFFFF);\n" +
    "  border-top: 1px solid var(--border, #E2E8F0);\n" +
    "  box-shadow: 0 -4px 16px rgba(30, 41, 59, 0.08);\n" +
    "  padding: 16px 20px;\n" +
    "  font-family: inherit;\n" +
    "}\n" +
    ".consent-banner-inner {\n" +
    "  max-width: 900px;\n" +
    "  margin: 0 auto;\n" +
    "  display: flex;\n" +
    "  align-items: center;\n" +
    "  justify-content: space-between;\n" +
    "  gap: 20px;\n" +
    "  flex-wrap: wrap;\n" +
    "}\n" +
    ".consent-banner-text {\n" +
    "  color: var(--ink, #1E293B);\n" +
    "  font-size: 0.9rem;\n" +
    "  margin: 0;\n" +
    "  flex: 1 1 320px;\n" +
    "}\n" +
    ".consent-banner-text a { font-weight: 600; }\n" +
    ".consent-banner-actions {\n" +
    "  display: flex;\n" +
    "  gap: 10px;\n" +
    "  flex-wrap: wrap;\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    ".consent-banner-actions .btn-primary,\n" +
    ".consent-banner-actions .btn-secondary {\n" +
    "  width: auto;\n" +
    "  margin-top: 0;\n" +
    "  padding: 10px 20px;\n" +
    "}\n" +
    "@media (max-width: 520px) {\n" +
    "  .consent-banner-inner { flex-direction: column; align-items: stretch; }\n" +
    "  .consent-banner-actions { justify-content: stretch; }\n" +
    "  .consent-banner-actions .btn-primary,\n" +
    "  .consent-banner-actions .btn-secondary { flex: 1; }\n" +
    "}\n";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = BANNER_STYLES;
    document.head.appendChild(style);
  }

  function getStoredConsent() {
    try {
      return window.localStorage.getItem(AD_CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeConsent(value) {
    try {
      window.localStorage.setItem(AD_CONSENT_KEY, value);
    } catch (e) {
      // localStorage indisponible : le bandeau reapparaitra a chaque visite,
      // ce qui reste un comportement sur (fail-safe), sans erreur bloquante.
    }
  }

  function dispatchConsentChanged(value) {
    var evt;
    try {
      evt = new CustomEvent("tchadiapdf:consent-changed", {
        detail: { consent: value },
      });
    } catch (e) {
      evt = document.createEvent("CustomEvent");
      evt.initCustomEvent("tchadiapdf:consent-changed", false, false, {
        consent: value,
      });
    }
    window.dispatchEvent(evt);
  }

  function removeBanner() {
    var existing = document.getElementById(BANNER_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function handleChoice(value) {
    storeConsent(value);
    removeBanner();
    dispatchConsentChanged(value);
  }

  function buildBanner() {
    var banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.className = "consent-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Consentement publicitaire");

    var inner = document.createElement("div");
    inner.className = "consent-banner-inner";

    var text = document.createElement("p");
    text.className = "consent-banner-text";
    text.innerHTML =
      "Ce site peut afficher des publicités (Google AdSense) pour rester " +
      "gratuit. Cela nécessite votre consentement. Vos fichiers, eux, ne " +
      "quittent jamais votre appareil. Voir notre " +
      '<a href="confidentialite.html">politique de confidentialité</a>.';

    var actions = document.createElement("div");
    actions.className = "consent-banner-actions";

    var refuseBtn = document.createElement("button");
    refuseBtn.type = "button";
    refuseBtn.className = "btn-secondary";
    refuseBtn.textContent = "Refuser";
    refuseBtn.addEventListener("click", function () {
      handleChoice(CONSENT_DENIED);
    });

    var acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn-primary";
    acceptBtn.textContent = "Accepter";
    acceptBtn.addEventListener("click", function () {
      handleChoice(CONSENT_GRANTED);
    });

    actions.appendChild(refuseBtn);
    actions.appendChild(acceptBtn);
    inner.appendChild(text);
    inner.appendChild(actions);
    banner.appendChild(inner);

    return banner;
  }

  function showBanner() {
    if (document.getElementById(BANNER_ID)) {
      return;
    }
    injectStyles();
    var banner = buildBanner();
    document.body.appendChild(banner);
  }

  function init() {
    var stored = getStoredConsent();
    if (stored !== CONSENT_GRANTED && stored !== CONSENT_DENIED) {
      showBanner();
    }
  }

  // Expose une fonction globale pour rouvrir le bandeau depuis un lien
  // discret du footer ("Gerer les publicites"), par exemple :
  //   <button type="button" onclick="tchadiapdfReopenConsentBanner()">
  //     Gerer les publicites
  //   </button>
  window.tchadiapdfReopenConsentBanner = function () {
    removeBanner();
    showBanner();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
