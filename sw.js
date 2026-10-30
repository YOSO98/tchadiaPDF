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
 *   les ressources de meme origine, y compris le HTML, CSS et JS : jamais
 *   de cache-first, un visiteur en ligne recoit donc toujours la version
 *   la plus recente ; le cache ne sert que de secours hors connexion, mis
 *   a jour a chaque visite reussie.
 * - Une page jamais visitee, demandee hors ligne, affiche /offline plutot
 *   que l'erreur de navigateur par defaut.
 *
 * Cycle de vie d'une mise a jour : skipWaiting() (installation) et
 * clients.claim() (activation) font qu'un nouveau service worker prend le
 * controle de tous les onglets ouverts DES QUE son installation termine,
 * sans attendre leur fermeture. Comme la page deja chargee en memoire dans
 * ces onglets reste toutefois figee sur l'ancien HTML/CSS/JS tant qu'elle
 * n'est pas rechargee, js/common.js ecoute l'evenement "controllerchange"
 * et affiche un bandeau "Nouvelle version disponible" invitant a actualiser
 * (jamais de rechargement automatique et silencieux).
 */

// CACHE_NAME et les suffixes ?v=<hash> ci-dessous sont generes par
// scripts/version-assets.js (npm run version-assets), a relancer a chaque
// modification de css/style.css ou d'un fichier js/*.js avant de committer.
// Le hash de CACHE_NAME derive du contenu de TOUS les fichiers css/js du
// site : il change automatiquement des qu'un seul d'entre eux change, ce
// qui declenche activate() ci-dessous et purge integralement l'ancien
// cache (voir DEPLOY.md, section "Mettre a jour css/style.css ou un
// fichier js/*.js").
const CACHE_NAME = "tchadiapdf-shell-v7da90733";

const APP_SHELL = [
  "/",
  "/offline",
  "/manifest.json",
  "/css/style.css?v=7e6a7e44",
  "/assets/fonts/inter-400.woff2",
  "/assets/fonts/inter-500.woff2",
  "/assets/fonts/inter-600.woff2",
  "/assets/fonts/inter-700.woff2",
  "/js/common.js?v=19064f79",
  "/js/security-utils.js?v=df7bd91a",
  "/js/index-page.js?v=46af2584",
  "/js/analytics.js?v=ced09caa",
  "/js/ads.js?v=744cd80e",
  "/js/consent-banner.js?v=1c4f5cf9",
  "/js/support-fab.js?v=09b1a127",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/favicon.ico",
  // Quelques outils vedettes pre-mis en cache pour un premier usage hors
  // ligne immediat ; les autres outils sont mis en cache automatiquement
  // des la premiere visite reussie (voir le gestionnaire "fetch" ci-dessous).
  "/fusionner",
  "/js/fusionner.js?v=eeffb607",
  "/compresser-pdf",
  "/js/compresser-pdf.js?v=9dac478a",
  "/js/compresser-pdf.worker.js", // instancie via new Worker(...) dans js/compresser-pdf.js, jamais via une balise <script> : pas de suffixe ?v= a faire correspondre
  "/modifier-pdf",
  "/js/modifier-pdf.js?v=de782a08",
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
      const offline = await cache.match("/offline");
      if (offline) return offline;
    }
    throw err;
  }
}
