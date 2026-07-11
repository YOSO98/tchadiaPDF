/* tchadiaPdf : service worker minimal pour un support hors ligne honnete.
 *
 * Strategie deliberement prudente :
 * - Uniquement les ressources DE MEME ORIGINE (le site lui-meme) sont
 *   interceptees. Les bibliotheques CDN (pdf-lib, pdf.js, mammoth...) ne
 *   sont JAMAIS mises en cache ici : elles ont deja un cache HTTP long
 *   (_headers, un an, immutable) et un attribut integrity (SRI) pour la
 *   plupart, les toucher ici n'apporterait rien et ajouterait un risque
 *   de contournement de l'integrite sans le vouloir.
 * - "Reseau d'abord, secours sur le cache" (network-first) pour TOUTES
 *   les ressources de meme origine, y compris CSS/JS. Un visiteur en
 *   ligne recoit donc toujours la version la plus recente (jamais de
 *   contenu perime servi par erreur) ; le cache ne sert que de secours
 *   hors connexion, mis a jour a chaque visite reussie.
 * - Une page jamais visitee, demandee hors ligne, affiche offline.html
 *   plutot que l'erreur de navigateur par defaut.
 */

// Le suffixe ?v=2 sur les ressources css/js locales suit celui utilise dans
// le HTML (voir les balises <link>/<script> des pages) : un simple
// changement de nom de fichier (via la chaine de requete) force chaque
// visiteur a retelecharger la derniere version, meme si son navigateur
// avait deja mis en cache pour un an l'ancienne URL sans suffixe
// (Cache-Control: immutable sur /css/* et /js/*, voir _headers).
const CACHE_NAME = "tchadiapdf-shell-v3";

const APP_SHELL = [
  "/",
  "/index.html",
  "/offline.html",
  "/manifest.json",
  "/css/style.css?v=3",
  "/js/common.js?v=3",
  "/js/security-utils.js?v=3",
  "/js/index-page.js?v=3",
  "/js/analytics.js?v=3",
  "/js/ads.js?v=3",
  "/js/consent-banner.js?v=3",
  "/js/support-fab.js?v=3",
  "/docs/icons/icon-192.png",
  "/docs/icons/icon-512.png",
  // Quelques outils vedettes pre-mis en cache pour un premier usage hors
  // ligne immediat ; les autres outils sont mis en cache automatiquement
  // des la premiere visite reussie (voir le gestionnaire "fetch" ci-dessous).
  "/fusionner.html",
  "/js/fusionner.js?v=3",
  "/compresser-pdf.html",
  "/js/compresser-pdf.js?v=3",
  "/js/compresser-pdf.worker.js", // instancie via new Worker(...) dans js/compresser-pdf.js, jamais via une balise <script> : pas de suffixe ?v= a faire correspondre
  "/modifier-pdf.html",
  "/js/modifier-pdf.js?v=3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ne touche jamais aux requetes vers un autre domaine (CDN) ni aux
  // methodes autres que GET (formulaires, etc.).
  if (url.origin !== self.location.origin || event.request.method !== "GET") {
    return;
  }

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const offline = await cache.match("/offline.html");
      if (offline) return offline;
    }
    throw err;
  }
}
