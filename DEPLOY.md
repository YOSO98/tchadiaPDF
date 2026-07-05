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
```

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
  chargement pour les visiteurs récurrents.
  **Point d'attention** : tant qu'aucune étape de hachage de nom de fichier
  (cache busting) n'existe (voir le Bloc 1, minification via `build.js`, à
  venir), une modification du contenu d'un fichier `.css`/`.js` existant ne
  sera pas vue par les navigateurs qui l'ont déjà en cache avant l'expiration
  de l'année. En pratique, cela concerne surtout les correctifs de bugs sur
  des outils déjà en production : à surveiller, et à corriger avec des noms
  de fichiers versionnés dès que le Bloc 1 sera fait.

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
3. Installation du navigateur Chromium pour Playwright.
4. Exécution de la suite de tests Playwright (`tests/`).

Le job échoue (code de sortie non nul) si l'une de ces étapes échoue, ce qui
bloque naturellement la fusion d'une pull request une fois la protection de
branche GitHub configurée (voir section 5 ci-dessus).
