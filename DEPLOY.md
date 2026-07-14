# Déploiement de tchadiaPdf

tchadiaPdf est un site 100% statique (HTML/CSS/JS purs, aucun backend, aucun
envoi de fichier utilisateur vers un serveur). Ce document décrit la mise en
production sur Cloudflare Pages, la configuration de sécurité associée, et le
rôle de l'intégration continue (CI) GitHub Actions.

---

## 1. Créer un compte Cloudflare

1. Rendez-vous sur [dash.cloudflare.com](https://dash.cloudflare.com) et créez
   un compte (gratuit, aucune carte bancaire requise pour Cloudflare Pages).
2. Confirmez votre adresse e-mail.

## 2. Connecter le dépôt GitHub à Cloudflare Pages

1. Dans le tableau de bord Cloudflare, allez dans **Workers & Pages**.
2. Cliquez sur **Créer une application** puis choisissez l'onglet **Pages**.
3. Cliquez sur **Connecter à Git**, autorisez Cloudflare à accéder à votre
   compte GitHub, puis sélectionnez le dépôt `tchadiapdf`.
4. Choisissez la branche de production (`main`).

## 3. Réglages de build

tchadiaPdf ne nécessite **aucune commande de build** pour être servi tel
quel : c'est un site statique pur.

- **Commande de build** : laisser vide (ou `echo "aucune commande de build"`
  si Cloudflare exige une valeur non vide).
- **Répertoire de sortie (output directory)** : `/` (racine du dépôt).
- Le fichier `_headers` à la racine est pris en compte **automatiquement**
  par Cloudflare Pages à chaque déploiement, sans configuration
  supplémentaire : c'est la convention Cloudflare Pages pour les en-têtes
  HTTP personnalisés.

**Point d'attention futur** : si le Bloc 1 (audit performance) ajoute un jour
une étape de minification CSS/JS via un script `build.js`, la commande de
build Cloudflare Pages devra alors être mise à jour pour exécuter ce script
avant le déploiement (par exemple `node build.js`), et le répertoire de
sortie devra pointer vers le dossier généré plutôt que vers la racine du
dépôt. Cela n'est pas fait par ce Bloc 2 : ce n'est pas son périmètre.

## 4. Ajouter un domaine personnalisé

1. Une fois le premier déploiement réussi, dans le projet Pages, allez dans
   l'onglet **Custom domains**.
2. Cliquez sur **Configurer un domaine personnalisé** et entrez le domaine
   (par exemple `tchadiapdf.com`).
3. Si le domaine est déjà géré par Cloudflare (DNS chez Cloudflare), le
   enregistrement CNAME est ajouté automatiquement. Sinon, ajoutez chez votre
   registrar le CNAME indiqué par Cloudflare pointant vers
   `<projet>.pages.dev`.
4. Le certificat HTTPS est émis et renouvelé automatiquement par Cloudflare
   (aucune action manuelle requise), généralement en quelques minutes.

**Page 404 personnalisée** : le fichier `404.html` à la racine du dépôt est
servi automatiquement par Cloudflare Pages pour toute URL inexistante,
sans configuration supplémentaire (convention native de Cloudflare Pages).
Elle propose une recherche (redirige vers `/?q=...`, repris par
`js/index-page.js`) et les outils les plus utilisés. Balisée `noindex` et
volontairement absente de `sitemap.xml`.

**URLs canoniques sans extension `.html`** : toutes les balises
`canonical`/`og:url`/`hreflang`, le `sitemap.xml` et tous les liens internes
du site utilisent la forme sans `.html` (`/organiser-pdf`, pas
`/organiser-pdf.html` ; `/en/`, pas `/en/index.html`). C'est un
comportement **natif de Cloudflare Pages** : toute requête vers
`/page.html` est automatiquement redirigée (308) vers `/page`, et
`/dossier/index.html` vers `/dossier/`, sans aucune configuration
(`_redirects` ou autre) : ajouter des règles `_redirects` explicites pour
ce cas serait donc redondant, pas nécessaire, et n'a volontairement pas été
fait. Source : documentation officielle Cloudflare Pages sur le service
des pages HTML ([developers.cloudflare.com/pages/configuration/serving-pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)).

**Point d'attention non résolu, à vérifier après déploiement** : le fichier
`_headers` cible les pages HTML via le motif `/*.html` pour leur appliquer
`Cache-Control: no-cache` (voir plus bas). Une fois les pages servies sous
leur forme sans extension, il n'est pas certain que ce motif s'applique
encore à `/organiser-pdf` (sans `.html`) : la documentation Cloudflare ne
précise pas si le filtrage `_headers` s'effectue sur le chemin demandé par
le visiteur ou sur le fichier statique résolu en interne. À vérifier
empiriquement après déploiement, par exemple avec
`curl -I https://tchadiapdf.com/organiser-pdf` et en comparant l'en-tête
`Cache-Control` reçu à celui de `curl -I https://tchadiapdf.com/css/style.css`.
Si `Cache-Control: no-cache` n'apparaît pas sur les pages HTML propres, le
motif `/*.html` du fichier `_headers` devra être élargi (en évitant un motif
générique `/*` qui chevaucherait `/css/*` et `/js/*` : Cloudflare **fusionne**
les en-têtes de toutes les règles qui correspondent à une même requête au
lieu de ne garder que la plus spécifique, ce qui produirait un
`Cache-Control` incohérent, valeurs jointes par une virgule).

## 5. Protection de branche GitHub et CI obligatoire

Le workflow `.github/workflows/ci.yml` s'exécute à chaque push et pull
request : il vérifie les règles de style du projet
(`scripts/check-style-rules.js`) puis lance la suite de tests Playwright.
Pour que cette CI bloque réellement la fusion d'une pull request en cas
d'échec, il faut activer la protection de branche sur GitHub, ce qui **ne
peut pas être fait depuis un commit** : c'est un réglage GitHub à faire
manuellement, par le propriétaire du dépôt.

Étapes (sur github.com, dans les réglages du dépôt) :

1. **Settings > Branches > Add branch protection rule**.
2. Nom de la branche : `main`.
3. Cocher **Require status checks to pass before merging**.
4. Rechercher et sélectionner le check nommé `Regles de style + tests
   Playwright` (le nom du job défini dans `ci.yml`).
5. Cocher également **Require branches to be up to date before merging** si
   vous voulez forcer la re-vérification après chaque nouveau commit sur
   `main`.
6. Enregistrer la règle.

## 6. Outillage de développement local (tests)

Un `package.json` a été ajouté à la racine, uniquement pour l'outillage de
développement (tests, CI). Le site en production reste 100% statique, sans
étape de build : ce `package.json` n'affecte jamais ce qui est déployé sur
Cloudflare Pages.

```
npm ci                          # installe les dependances de developpement
npx playwright install chromium # installe le navigateur de test (une fois)
npm test                        # lance la suite de tests Playwright
npm run check-style             # verifie les regles de style (tirets, couleurs)
npm run version-assets          # cache-busting : voir section dediee ci-dessous
npm run deploy-prep             # enchaine les trois etapes ci-dessus, a lancer avant chaque deploiement
```

**Hook pre-commit optionnel** : `.githooks/pre-commit` relance
`check-asset-version-consistency.js` et `check-style-rules.js` (rapide,
sans la suite Playwright complete) avant d'accepter un commit local. Non
actif par defaut (un hook de `.git/hooks/` n'est jamais suivi par git ni
installe automatiquement au clonage) ; pour l'activer une fois dans son
clone local :

```
git config core.hooksPath .githooks
```

Pour le desactiver : `git config --unset core.hooksPath`.

---

## Justification des choix de configuration (`_headers`)

### Cache-Control

- **Pages HTML (`/`, `/*.html`, et les variantes de langue `/ar/*`, `/en/*`,
  `/es/*`, `/pt/*`)** : `Cache-Control: no-cache`. Le site évolue souvent
  (nouveaux outils ajoutés régulièrement) : on ne veut jamais qu'un visiteur
  reste bloqué sur une version périmée d'une page. `no-cache` autorise quand
  même le navigateur à faire une requête de revalidation conditionnelle
  rapide (souvent une réponse 304 sans re-téléchargement complet) plutôt que
  d'interdire tout cache (`no-store`), ce qui reste plus rapide pour les
  visiteurs qui reviennent sur une page déjà visitée.
- **CSS, JS, WebAssembly (`/css/*`, `/js/*`, `/*.wasm`)** :
  `Cache-Control: public, max-age=31536000, immutable` (un an). Ces fichiers
  sont volumineux (moteurs de conversion, éditeur PDF) et chargés sur
  presque toutes les pages : un cache long améliore nettement les temps de
  chargement pour les visiteurs récurrents. Sûr uniquement parce que le
  cache-busting par hash (ci-dessous) change l'URL dès que le contenu
  change : un fichier `immutable` en cache jamais mis à jour à la même URL
  n'est alors jamais un problème, puisque cette URL ne référence plus qu'un
  contenu qui, par construction, ne changera plus.
  **Incident réel documenté** : c'est arrivé une fois en production avant la
  mise en place du cache-busting (barre de recherche et zone de dépôt de la
  page d'accueil affichées sans style pour les visiteurs ayant déjà
  `css/style.css` en cache). Cause désormais éliminée par
  `scripts/version-assets.js`, voir ci-dessous.
- **`sw.js`** : `Cache-Control: max-age=0, must-revalidate`, **absent du
  fichier `_headers` actuel, à ajouter** (voir "En-têtes cible" plus bas).
  Sans cette règle explicite, le fichier du service worker lui-même
  pourrait être mis en cache par un intermédiaire (proxy, CDN en amont) sans
  revalidation, retardant la détection de toute nouvelle version : c'est le
  seul fichier du site où un cache, même bref, va directement à l'encontre
  du but recherché (voir "Cycle de vie d'une mise à jour" ci-dessous).

### Cache-busting : `scripts/version-assets.js`

À chaque fois que le contenu de `css/style.css` ou d'un fichier `js/*.js`
change (nouveau style, correctif de bug, nouvelle fonctionnalité), il faut
relancer ce script avant de committer, sans quoi les visiteurs ayant déjà
l'ancienne version en cache (voir ci-dessus) ne recevront jamais la mise à
jour :

```
node scripts/version-assets.js   # ou : npm run version-assets
```

Contrairement à l'ancien schéma (un seul numéro de version global,
incrémenté manuellement à chaque exécution), ce script calcule un **hash du
contenu** de chaque fichier `css/*.css` et `js/*.js` (SHA-256, 8 caractères
hexadécimaux) et l'utilise comme suffixe `?v=<hash>` sur toutes les
références locales, dans les 67 pages HTML du site (toutes langues) : le
hash d'un fichier ne change **que si son contenu change**, deux fichiers
non modifiés gardent exactement le même suffixe d'une exécution à l'autre
(idempotent), et un seul fichier modifié n'entraîne la mise à jour que des
pages qui le référencent réellement.

Le script synchronise aussi `sw.js` : chaque entrée `APP_SHELL` reçoit le
hash de son propre fichier, et `CACHE_NAME` reçoit un hash de *build*
dérivé de l'ensemble des fichiers css/js du site (ordre trié, donc stable) :
il change automatiquement dès qu'un seul fichier change, ce qui force le
service worker à considérer qu'il s'agit d'une nouvelle version (voir
"Cycle de vie d'une mise à jour" ci-dessous).

Il suffit ensuite de relire le diff, relancer `npm run check-style` et
`npm test` (ou directement `npm run deploy-prep`, qui enchaîne les trois),
puis committer normalement : aucune étape de build n'est ajoutée, ce sont
toujours des fichiers statiques ordinaires servis tels quels.

Un garde-fou tourne automatiquement en CI (`npm run check-versions`,
`scripts/check-asset-version-consistency.js`) : il échoue si une page
référence encore un hash périmé pour un fichier css/js, ou si `CACHE_NAME`
de `sw.js` ne correspond plus au hash de build actuel, pour éviter qu'une
incohérence passe inaperçue.

Si `js/compresser-pdf.worker.js` (ou tout autre script instancié via
`new Worker(...)` plutôt que par une balise `<script>`) change, il n'a pas
besoin de suffixe : ce n'est pas concerné par la même casse de cache
(vérifié au cas par cas, voir le commentaire dans `sw.js`).

### Cycle de vie d'une mise à jour du service worker

`sw.js` appelle `self.skipWaiting()` à l'installation et
`self.clients.claim()` à l'activation : un nouveau service worker prend
donc le contrôle de **tous les onglets déjà ouverts** dès que son
installation se termine, sans attendre leur fermeture. À l'activation,
tous les caches dont le nom ne correspond pas au `CACHE_NAME` courant sont
intégralement supprimés (pas d'accumulation d'anciennes entrées).

Cette prise de contrôle immédiate ne recharge toutefois jamais la page
déjà chargée en mémoire dans un onglet ouvert : celle-ci continue d'utiliser
le HTML/CSS/JS avec lequel elle a été chargée jusqu'à ce qu'elle soit
rechargée. `js/common.js` écoute l'évènement `controllerchange` (déclenché
juste après cette prise de contrôle) et affiche un bandeau discret "Nouvelle
version disponible" avec un bouton "Actualiser" qui recharge la page ; la
toute première occurrence de l'évènement (l'activation initiale, pas une
vraie mise à jour) est explicitement ignorée pour ne jamais afficher ce
bandeau à un visiteur de passage. Aucun rechargement automatique et
silencieux n'est effectué : le choix reste toujours celui du visiteur.

### Checklist de déploiement (à suivre avant chaque push vers `main`)

1. `npm run deploy-prep` (enchaîne `version-assets`, `check-style`, `test`) :
   corrige tout ce qui échoue avant de continuer.
2. Relire le diff produit par `version-assets` (pages HTML, `sw.js`) :
   confirmer qu'il ne touche que les suffixes `?v=` et `CACHE_NAME`.
3. Committer, pousser, laisser la CI (`.github/workflows/ci.yml`) confirmer
   une deuxième fois de façon indépendante.
4. Une fois déployé sur Cloudflare Pages, vérifier qu'un visiteur reçoit
   bien la nouvelle version : ouvrir le site dans un onglet resté ouvert
   depuis avant le déploiement, attendre quelques secondes (le service
   worker se met à jour en tâche de fond), et confirmer que le bandeau
   "Nouvelle version disponible" apparaît. Sur un onglet fraîchement ouvert,
   `curl -I https://tchadiapdf.com/css/style.css?v=<hash attendu>` doit
   répondre 200 avec `Cache-Control: public, max-age=31536000, immutable`,
   et `curl -I https://tchadiapdf.com/sw.js` doit répondre avec
   `Cache-Control: max-age=0, must-revalidate` (voir "En-têtes cible"
   ci-dessous : à ajouter manuellement à `_headers`, jamais généré
   automatiquement).

### En-têtes cible pour `_headers` (Cache-Control)

Bloc complet, prêt à copier-coller dans `_headers` à la suite du bloc
`Content-Security-Policy` existant. Toutes les lignes ci-dessous sont déjà
présentes et correctes dans le fichier actuel, **à l'exception de la
dernière** (`/sw.js`), qui manque et doit être ajoutée :

```
/
  Cache-Control: no-cache

/*.html
  Cache-Control: no-cache

/ar/*
  Cache-Control: no-cache

/en/*
  Cache-Control: no-cache

/es/*
  Cache-Control: no-cache

/pt/*
  Cache-Control: no-cache

/css/*
  Cache-Control: public, max-age=31536000, immutable

/js/*
  Cache-Control: public, max-age=31536000, immutable

/*.wasm
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: max-age=0, must-revalidate
```

Une phrase par ligne :

- `/` et `/*.html` : jamais de cache long sur le HTML, le site évolue trop
  souvent pour risquer qu'un visiteur reste bloqué sur une page périmée.
- `/ar/*`, `/en/*`, `/es/*`, `/pt/*` : même règle pour les pages traduites,
  qui vivent dans des sous-dossiers non couverts par le motif `/*.html`
  seul (celui-ci ne matche que les chemins se terminant littéralement par
  `.html`, pas un dossier entier).
- `/css/*`, `/js/*`, `/*.wasm` : cache long et immuable, sûr uniquement
  grâce au cache-busting par hash (`scripts/version-assets.js`) qui change
  l'URL à chaque changement de contenu.
- `/sw.js` : jamais de cache, même bref, c'est le seul fichier dont la
  détection de mise à jour par le navigateur dépend directement de la
  fraîcheur de la réponse HTTP.

**Non résolu, à vérifier après déploiement** (déjà documenté plus haut dans
ce fichier, rappelé ici car directement lié) : depuis le passage aux URLs
canoniques sans extension `.html`, il n'est pas certain que le motif
`/*.html` s'applique encore aux pages servies sous leur forme propre
(`/organiser-pdf`). Vérifier avec `curl -I` après déploiement ; si
`Cache-Control: no-cache` n'apparaît pas sur une page HTML propre, élargir
le motif en évitant `/*` (qui chevaucherait `/css/*` et `/js/*` : Cloudflare
fusionne les en-têtes de toutes les règles correspondantes au lieu de ne
garder que la plus spécifique, ce qui produirait un `Cache-Control`
incohérent).

### X-Frame-Options : DENY (plutôt que SAMEORIGIN)

Aucune page du site n'a besoin d'être affichée dans un `<iframe>`, ni par
tchadiaPdf lui-même, ni par un site tiers. `DENY` est donc l'option la plus
sûre contre le détournement de clics (clickjacking). Le même choix est
répété dans la CSP via `frame-ancestors 'none'` (équivalent moderne,
compris par les navigateurs récents).

### Content-Security-Policy

Construite à partir d'une recherche de tous les hôtes externes réellement
utilisés dans le dépôt (`src=`/`href=` dans les fichiers `.html`, plus les
chargements dynamiques de script trouvés dans `js/*.js`) :

- `https://cdnjs.cloudflare.com` : pdf.js (`pdf.worker.min.js`), pdf-lib.
- `https://cdn.jsdelivr.net` : tesseract.js (OCR), fontkit, la police
  Liberation Sans (`modifier-pdf.js`), le moteur qpdf-wasm.
- `https://fonts.googleapis.com` : feuille de style de la police Inter
  (Google Fonts).
- `https://fonts.gstatic.com` : fichiers de police réels servis par la
  feuille de style Google Fonts ci-dessus (jamais référencé directement
  dans le HTML, mais nécessaire dans `font-src` sans quoi les polices
  échoueraient à charger).

`'unsafe-inline'` a été nécessaire à deux endroits, faute d'alternative
simple sur un site statique sans étape de build (pas de nonces/hash
possibles facilement) :

- `script-src` : à cause d'un attribut `onchange="..."` inline sur le
  sélecteur de langue de la page d'accueil (`index.html` et ses variantes
  linguistiques). Sans `'unsafe-inline'`, le changement de langue serait
  cassé par la CSP.
- `style-src` : à cause du grand nombre de blocs `<style>` inline et
  d'attributs `style="..."` déjà présents sur la majorité des pages
  d'outils.

`'wasm-unsafe-eval'` a été ajouté à `script-src` par précaution : plusieurs
outils chargent des modules WebAssembly (qpdf-wasm, et potentiellement
d'autres moteurs de conversion) ; certains navigateurs exigent cette
directive (ou l'ancienne `'unsafe-eval'`, plus permissive et évitée ici)
pour autoriser `WebAssembly.instantiate`.

`img-src` inclut `data:` et `blob:` : les outils génèrent des images et des
fichiers de sortie côté client (miniatures de pages, aperçus, téléchargements
via URL objet), jamais depuis un serveur distant.

**CSP à revérifier** : la Phase Conversions ajoute encore de nouveaux outils
au moment où ce Bloc 2 a été écrit. Si un futur outil charge une librairie
depuis un autre CDN que `cdnjs.cloudflare.com` ou `cdn.jsdelivr.net`, le
fichier `_headers` devra être mis à jour en conséquence, sans quoi la
librairie sera bloquée par la CSP en production. Cette vérification finale
(une fois toutes les pages en place) est à faire par le propriétaire du
dépôt avant la mise en production réelle.

---

## Intégration continue (CI)

Le workflow `.github/workflows/ci.yml` s'exécute à chaque push et pull
request :

1. Installation de Node.js et des dépendances de développement (`npm ci`).
2. Vérification bloquante des règles de style du projet
   (`scripts/check-style-rules.js`) : aucun tiret long/moyen nulle part,
   aucune couleur hexadécimale hors de la palette blanc/bleu du projet.
3. Vérification bloquante de la cohérence des versions css/js
   (`scripts/check-asset-version-consistency.js`) : voir "Mettre à jour
   `css/style.css` ou un fichier `js/*.js`" ci-dessus.
4. Installation du navigateur Chromium pour Playwright.
5. Exécution de la suite de tests Playwright (`tests/`).

Le job échoue (code de sortie non nul) si l'une de ces étapes échoue, ce qui
bloque naturellement la fusion d'une pull request une fois la protection de
branche GitHub configurée (voir section 5 ci-dessus).
