# Audit SEO et visibilité IA : tchadiaPdf

Date : 30 octobre 2026. Périmètre : copie de travail `agent/seo` (45 pages
d'outils en ligne, 2 en cours de livraison sur d'autres branches, accueil,
9 pages annexes, 5 guides, 8 pages traduites). Méthode : analyse du code
(scripts Node ad hoc puis `scripts/verifier-seo.js`), Lighthouse 12 en
local (Chromium de Playwright, émulation mobile, serveur `http-server`
sans compression ni cache HTTP : les scores de performance en production
derrière Cloudflare seront égaux ou meilleurs, jamais pires). Internet
coupé pendant l'audit : aucune donnée Search Console, aucun test de
rendu Google, aucune mesure de positionnement réelle. Tout chiffre
« externe » ci-dessous est donc une estimation à confirmer avec Search
Console une fois le site déployé.

Ce document complète `docs/AUDIT-QUALITE-GOOGLE.md` (juillet 2026, axé
sur les risques de pénalité) : il ne reprend pas ce qui y est déjà
vérifié (pas de contenu dupliqué, pas de bourrage de mots-clés, promesses
exactes).

## Résumé en dix lignes

1. Base technique saine : canonical partout, hreflang complet (x-default
   inclus) sur l'accueil et Soutenir, HTTPS, en-têtes de sécurité, 404
   `noindex`, URL propres sans `.html` (redirection 308 native Cloudflare).
2. Le vrai problème était le **maillage interne** : aucune page d'outil
   ne liait une autre page d'outil (uniquement en-tête et pied de page),
   les 5 guides n'avaient **aucun lien entrant** (orphelins, atteignables
   seulement par le sitemap), `signets-pdf` était orphelin, `securite` n'avait
   qu'un lien entrant. Corrigé par le bloc « Outils associés » (3 à 5 liens
   + guide) sur chaque page d'outil : chaque outil reçoit désormais entre
   2 et 28 liens entrants depuis le corps des pages (moyenne 7,5).
3. **21 descriptions sur 68 dépassaient 160 caractères** (jusqu'à 209),
   34 titres dépassaient 60 caractères (jusqu'à 96). Toutes les
   descriptions sont désormais entre 70 et 160 ; 22 titres d'outils
   restent entre 61 et 65 caractères (choix assumé pour garder le mot-clé
   et la marque).
4. **Sitemap** : `signets-pdf` manquait ; régénéré depuis le registre
   (68 URL, hreflang `xhtml:link`, lastmod depuis git).
5. **Données structurées** : `SoftwareApplication` minimal sur chaque
   outil, aucune FAQPage alors que 30 pages ont une FAQ en `<details>`,
   aucun BreadcrumbList, aucune `Organization`/`WebSite` sur l'accueil.
   Désormais : `@graph` WebApplication + BreadcrumbList + FAQPage par outil ;
   bloc Organization + WebSite (SearchAction) + ItemList à intégrer sur
   l'accueil (équipe design).
6. **Core Web Vitals** (mobile, local) : accueil 97, compresser 93,
   fusionner 81, pdf-en-word 74, caviarder 67. Le frein est le chargement
   synchrone de pdf-lib (513 Ko) et pdf.js (313 Ko) en fin de `<body>`
   sans `defer` : LCP 4,8 à 4,9 s sur fusionner et caviarder. Hors
   périmètre SEO (fichiers JS), recommandation transmise.
7. **Contenu** : 15 pages d'outils sans FAQ et 8 pages sous 100 mots
   (diviser 76, ocr 77, organiser 70, jpg-en-pdf 83, signer 86,
   deverrouiller 90, pivoter 91, formulaires 95), dont plusieurs sur des
   requêtes à fort volume (« signer pdf », « diviser pdf », « jpg en pdf »,
   « ocr pdf »). Priorité éditoriale numéro un (voir `docs/SEO-PLAN.md`).
8. **Visibilité IA** : `llms.txt` réécrit au format standard, `llms-full.txt`
   créé (47 outils, limites, licence, auteur, méthode de confidentialité,
   comparaison Acrobat, FAQ Q/R, formulation de citation recommandée),
   page comparative honnête `tchadiapdf-vs-adobe-acrobat` et page
   `pourquoi-gratuit` créées.
9. **Robots** : `X-Robots-Tag: noindex` ajouté sur `/vendor/`, `/docs/`,
   `/tests/`, `/scripts/`, `/data/`, `/*.md` (déployés avec le site, sans
   intérêt pour l'index) ; `robots.txt` bloque `/tests/`, `/scripts/`,
   `/data/`, `*.md` ; `/vendor/` et `/js/` restent accessibles pour le rendu.
10. Trois outils (`verifier-seo`, `generer-sitemap`, `seo-appliquer`)
    rendent ces règles vérifiables et reproductibles à chaque ajout
    d'outil.

## 1. Technique

### 1.1 Indexabilité et canonical

| Vérification | Avant | Après |
|---|---|---|
| Pages indexables | 66 (45 outils, accueil, 7 annexes, 5 guides, 8 traduites) | 68 (+ 2 pages créées) |
| Canonical absolue sans `.html` | 66/66 | 68/68, vérifiée par script contre l'URL attendue |
| `meta robots` explicite | 1 (404 `noindex`) | 45 outils + 2 nouvelles pages `index, follow, max-image-preview:large` ; 404 inchangée |
| Pages volontairement hors index | 404.html (`noindex`), offline.html (repli du service worker, absente du sitemap) | identiques |
| Fichiers techniques déployés et indexables | `/vendor/*.js`, `/docs/*.md`, `/tests/*`, `/scripts/*`, `*.md` racine (README, BENCHMARK, TODO...) sans aucune directive | `X-Robots-Tag: noindex` via `_headers` + `Disallow` ciblés dans robots.txt |

`max-image-preview:large` autorise Google à afficher les images Open Graph
en grand dans Discover et les résultats enrichis ; sans effet négatif.

### 1.2 hreflang

- Accueil et Soutenir : 5 langues + `x-default` vers la version française,
  présents dans le `<head>` des 10 pages concernées et, désormais, dans le
  sitemap (`xhtml:link`). Cohérent et réciproque.
- Pages d'outils (français uniquement) : ajout de `hreflang="fr"` et
  `hreflang="x-default"` auto-référents. Ce n'est pas indispensable
  (Google traite une page sans alternates comme monolingue) mais cela
  déclare explicitement la version par défaut et prépare l'ajout de
  traductions sans changer de structure.
- Limite : les 4 accueils traduits renvoient vers des outils en français.
  Google peut juger l'expérience incohérente pour un visiteur anglophone ;
  c'est documenté sur les pages (`lang-note`). Pas une erreur, une
  limite produit.

### 1.3 Sitemap

- Avant : 65 URL, `signets-pdf` absent, lastmod figé au 7 juillet pour la
  plupart des pages, pas d'alternates.
- Après : 68 URL générées par `scripts/generer-sitemap.js` depuis le
  registre + pages annexes + guides + langues ; lastmod = date du dernier
  commit du fichier ; `xhtml:link` hreflang sur l'accueil et Soutenir ;
  les outils dont le fichier n'existe pas encore (`pieces-jointes-pdf`,
  `assainir-pdf`) sont omis automatiquement et apparaîtront au prochain
  passage après fusion de leurs branches.
- `scripts/verifier-seo.js` échoue si une URL du sitemap n'a pas de fichier,
  si une page indexable manque, si une URL porte `.html` ou est en double.

### 1.4 robots.txt, redirections, 404, en-têtes

- robots.txt : `Allow: /` + Sitemap, désormais avec `Disallow` sur
  `/tests/`, `/scripts/`, `/data/`, `/*.md$`. Volontairement **pas** de
  `Disallow` sur `/vendor/` ni `/js/` : bloquer les scripts empêche
  Googlebot de rendre les pages correctement ; le `X-Robots-Tag: noindex`
  suffit à les tenir hors de l'index.
- Redirections `.html` vers URL propre : natives Cloudflare Pages (308),
  documentées dans DEPLOY.md ; aucun lien interne ne pointe vers un
  `.html` (vérifié : 0 occurrence dans les `href` des pages).
- 404 : page personnalisée, `noindex`, propose la recherche. Bon.
- En-têtes : HSTS preload, CSP stricte, COOP, Referrer-Policy. Rien à
  changer pour le SEO. Point ouvert (DEPLOY.md) : le motif `/*.html` du
  `Cache-Control: no-cache` pourrait ne pas s'appliquer aux URL sans
  extension ; à vérifier avec `curl -I https://tchadiapdf.com/fusionner`
  après déploiement. Si le HTML était mis en cache un an, les mises à
  jour SEO (titres, JSON-LD) mettraient très longtemps à être vues.
- `Content-Type: text/plain; charset=utf-8` ajouté pour `/llms.txt` et
  `/llms-full.txt`.

### 1.5 Core Web Vitals (Lighthouse 12, mobile émulé, local)

| Page | Perf. | Access. | Bonnes pratiques | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/` (accueil) | 97 | 95 | 100 | 100 | 1,7 s | 2,3 s | 12 ms | 0 |
| `/compresser-pdf` | 93 | 100 | 100 | 100 | 2,1 s | 2,9 s | 6 ms | 0 |
| `/fusionner` | 81 | 100 | 100 | 100 | 1,5 s | 4,8 s | 108 ms | 0 |
| `/pdf-en-word` | 74 | 98 | 100 | 100 | 3,4 s | 3,9 s | 311 ms | 0 |
| `/caviarder-pdf` | 67 | 100 | 100 | 100 | 4,5 s | 4,9 s | 221 ms | 0 |

Diagnostic :

- **LCP** dégradé sur les pages qui chargent pdf-lib (513 Ko) et/ou pdf.js
  (313 Ko) de façon synchrone en fin de `<body>`. Lighthouse les classe
  « ressources bloquant le rendu » (pdf-lib : 3,4 s sur caviarder). Sur
  `pdf-en-word`, docx.js (726 Ko) s'ajoute : 1,9 Mo au total.
- **CLS = 0** partout : excellent, à préserver (le bloc « Outils associés »
  est en bas de page, hors viewport initial).
- Accessibilité : `label-content-name-mismatch` sur la dropzone
  (`aria-label` différent du texte visible) sur toutes les pages d'outils,
  `heading-order` sur pdf-en-word (un `<h3>` sans `<h2>` dans
  `.fidelity-box`), `aria-allowed-attr` sur l'accueil. Transmis à l'équipe
  design (hors périmètre).
- Sans effet en production mais signalés en local : compression texte et
  cache long absents (le serveur local ne les fait pas ; Cloudflare oui).

Recommandations (équipe JS/design, pas appliquées ici) :

1. `defer` sur les balises `<script src="/vendor/...">` et `js/<outil>.js`
   (comme déjà fait pour analytics/ads/consent) : gain estimé de 1 à 2 s
   de LCP sur les pages lourdes, score 67 à 74 vers 85 et plus. Condition :
   que `common.js` et le script de l'outil n'exigent pas l'exécution
   immédiate avant `DOMContentLoaded` (à vérifier outil par outil).
2. Chargement paresseux de docx.js / mammoth / SheetJS à la sélection du
   fichier (déjà listé dans BENCHMARK.md).
3. `fetchpriority="high"` inutile ici (pas d'image LCP) ; le LCP est un
   paragraphe, le vrai levier est la libération du thread principal.

## 2. On-page

### 2.1 Titres et descriptions

- Avant : 34 titres > 60 caractères (max 96, guide caviarder), 21
  descriptions > 160 caractères sur 68 pages (max 209, pdf-en-jpg).
- Après : 0 description hors 70-160 (contrôle bloquant du vérificateur) ;
  22 titres d'outils entre 61 et 65 caractères, conservés sciemment pour
  garder « gratuit en ligne » + marque (Google tronque par largeur en
  pixels, environ 580 px ; les titres choisis restent en général entiers
  sur ordinateur). Titres longs restants hors outils : accueil (76),
  accueils es/pt (77/74), guides (72 à 96) : à l'équipe design pour
  l'accueil ; les guides pourront être raccourcis lors de leur mise à jour
  éditoriale (non bloquant, un titre long n'est pas pénalisé).
- Modèle retenu pour les outils : `<Verbe/objet> <format> gratuit en ligne
  [précision] : tchadiaPdf`. Chaque titre contient la requête principale au
  début ; la description reprend la promesse différenciante (local, sans
  envoi) et une précision concrète (limite de lot, formats).

### 2.2 H1, hiérarchie

- 1 H1 par page sur 68/68 (vérifié). H1 courts (nom de l'outil), H2
  « Questions fréquentes », H2 fonctionnels dans certains outils
  (caviarder : « Rechercher et caviarder »). Correct.
- Le bloc « Outils associés » ajoute un H2 par page d'outil ; il est
  inséré avant `<footer`, donc après la FAQ : ordre logique.

### 2.3 Intention de recherche par page

Le registre `data/outils.json` consigne pour chaque outil l'intention
(transactionnelle dans 44 cas sur 47, dépannage pour `reparer-pdf`,
sécurité pour `assainir-pdf`), les 5 mots-clés principaux et les outils
associés. Les pages répondent à l'intention dès le premier écran (dropzone,
sous-titre) ; la FAQ porte les variantes informationnelles (« qu'est-ce
qu'aplatir », « pourquoi mes photos sont en HEIC »).

### 2.4 Cannibalisation

- `pdf-en-jpg` couvre aussi PNG, TIFF, WebP (depuis le chantier C) : un seul
  outil, pas de page concurrente ; titre et H1 l'annoncent. OK.
- `jpg-en-pdf` accepte aussi le PNG : la requête « png en pdf » n'a pas de
  page dédiée et atterrit sur `jpg-en-pdf`. Acceptable ; une page
  `png-en-pdf` distincte créerait un quasi-doublon. Mot-clé ajouté dans
  le registre.
- `pdf-en-texte` et `ocr-pdf` se recoupent sur « pdf scanné en texte » :
  rôles distincts (extraction vs couche OCR), FAQ à écrire pour les
  différencier (voir plan).
- `caviarder-pdf` et `aplatir-pdf` : la FAQ d'aplatir fait déjà la
  distinction. Bon exemple.
- Guides vs outils : les guides ciblent « comment + tâche » et renvoient
  à l'outil ; les outils ciblent « <tâche> pdf gratuit ». Pas de conflit.

## 3. Données structurées

| Élément | Avant | Après |
|---|---|---|
| Outils | `SoftwareApplication` (name, url, category, OS, description, offre 0 EUR) | `@graph` : `WebApplication` (sous-type de SoftwareApplication) avec `isAccessibleForFree`, `offers`, `license`, `keywords`, `inLanguage`, `publisher`/`isPartOf` par `@id` ; `BreadcrumbList` (Accueil > [Conversions] > Outil) ; `FAQPage` générée depuis `<section class="faq">` (30 pages) |
| Accueil | `WebPage` + `WebSite` imbriqué | Bloc proposé (`node scripts/seo-appliquer.js --accueil`) : `Organization` (#organization, logo, email, sameAs GitHub), `WebSite` (#website, SearchAction vers `/?q={search_term_string}`, 5 langues), `WebPage`, `ItemList` des 45 outils |
| Guides | `HowTo` avec étapes | inchangé (valide) ; `text` de l'étape 1 cite « caviarder-pdf.html » (nom de fichier) : à réécrire en « l'outil Caviarder PDF » |
| Nouvelles pages | | `Article` + `BreadcrumbList` + `FAQPage` |
| Validité | 52 blocs parsables | 54 blocs parsables, vérifiés par script |

Honnêteté sur l'impact : depuis août 2023, Google n'affiche plus les
résultats enrichis FAQ pour les sites non gouvernementaux et non
médicaux, et a retiré l'affichage HowTo. Le balisage FAQPage et HowTo
n'apportera donc **pas** d'extrait enrichi visible. Il reste utile pour
la compréhension de la page par les moteurs et les assistants IA (format
question/réponse explicite), et ne coûte rien. Le `SoftwareApplication`
peut encore produire une vignette avec prix « Gratuit » ; `BreadcrumbList`
remplace l'URL par un fil d'Ariane dans les résultats.

## 4. Maillage interne

Mesures (liens dans le corps des pages, en-tête et pied de page exclus) :

| | Avant | Après |
|---|---|---|
| Pages d'outils liant un autre outil | 0 / 45 | 45 / 45 (3 à 5 liens + guide) |
| Liens entrants par outil (min / moyenne / max) | 1 / 1,1 / 2 (accueil seulement) | 2 / 7,5 / 28 |
| Guides avec au moins un lien entrant | 0 / 5 | 5 / 5 (depuis la page d'outil correspondante, classe `related-guide`) |
| Pages orphelines | 5 guides, signets-pdf (hors sitemap) | 0 (pieces-jointes et assainir seront liés dès que leurs fichiers existeront) |
| Profondeur de clic depuis l'accueil | outils 1, guides infinie | outils 1, guides 2, nouvelles pages 2 (via les liens croisés ; 1 si ajout au pied de page) |

Ancres : descriptives et variées (`Compresser PDF : réduire le poids du
fichier avant de l'envoyer`), jamais « cliquez ici », jamais la même ancre
répétée avec un mot changé. Les outils les plus liés sont `fusionner` (28)
et `compresser-pdf`, ce qui concentre l'autorité interne sur les deux
requêtes à plus fort volume : cohérent.

Outils encore faiblement liés (2 entrants) : `extraire-images-pdf`,
`webp-en-pdf`, `tiff-en-pdf`, `bmp-en-pdf`, `epub-en-pdf`. Correction
simple : les ajouter dans `outils_associes` d'outils voisins (ex.
`tiff-en-pdf` depuis `ocr-pdf` et `scanner-pdf`), ou mieux, rendre
`conversions.html` plus riche (une phrase par conversion).

Reste à faire (équipe design, index.html et a-propos.html) : lier
`pourquoi-gratuit` et `tchadiapdf-vs-adobe-acrobat` depuis le pied de
page ou la section « Pourquoi tchadiaPdf » ; ajouter une section
« Guides » sur l'accueil (5 liens) ; ajouter la carte `signets-pdf`.

## 5. Contenu : lacunes face aux requêtes cibles

Rappel du contexte (docs/NICHES.md) : sur « fusionner pdf », « compresser
pdf gratuit », « pdf en word », les dix premiers résultats sont tenus par
iLovePDF, Smallpdf, PDF24, Adobe, Canva, PDF2Go, avec une autorité de
domaine hors de portée à court terme. L'objectif réaliste à 90 jours est
la longue traîne et les requêtes à intention précise, plus l'apparition
dans les réponses des assistants.

| Requête | Page | État du contenu | Lacune principale |
|---|---|---|---|
| fusionner pdf (gratuit, en ligne) | /fusionner | 200 mots, 3 FAQ | Pas d'explication sur l'ordre, les PDF protégés, la limite de taille après fusion, les signets conservés ou non |
| compresser pdf gratuit | /compresser-pdf | 231 mots, 3 FAQ | Les concurrents annoncent des taux ; nous devons expliquer honnêtement « pourquoi mon PDF ne maigrit pas » (texte pur) et proposer PDF en JPG à basse résolution comme alternative |
| signer pdf / signer un pdf gratuit | /signer-pdf | **86 mots, 0 FAQ** | Rien sur la valeur juridique, la différence avec une signature électronique, la taille et la couleur du trait, la signature sur plusieurs pages |
| caviarder pdf | /caviarder-pdf + guide | 468 mots, 4 FAQ, guide | Bien couvert ; manque un paragraphe sur les métadonnées restantes (renvoyer vers métadonnées et assainir) |
| pdf en word | /pdf-en-word | 379 mots, 4 FAQ | Correct ; ajouter une FAQ « PDF scanné : passer d'abord par l'OCR » |
| diviser pdf / extraire pages pdf | /diviser | **76 mots, 0 FAQ** | Aucune FAQ (plages de pages, un fichier par page, PDF protégé) |
| jpg en pdf / image en pdf | /jpg-en-pdf | **83 mots, 0 FAQ** | Aucune FAQ (ordre des images, qualité, taille de page, plusieurs images par page) |
| ocr pdf / pdf scanné recherchable | /ocr-pdf | **77 mots, 0 FAQ** | Aucune FAQ (langues, durée, précision, différence avec PDF en texte) |
| modifier pdf gratuit | /modifier-pdf | 384 mots, 0 FAQ | Pas de FAQ alors que les questions sont nombreuses (police, texte scanné, enregistrer) |
| protéger pdf mot de passe | /proteger-pdf | 416 mots, 0 FAQ | Encadré honnête présent ; FAQ absente (oublié le mot de passe ? différence ouverture / propriétaire) |
| organiser pdf, pivoter pdf, filigrane pdf, rogner pdf | pages | 70 à 148 mots, 0 FAQ | Minimum vital |

Contenu que les concurrents n'ont pas et que tchadiaPdf peut tenir :

- Pages « preuve » (`confiance`, `securite`) : uniques dans la catégorie.
  `securite.html` mentionne encore « CDN » et « SRI en cours » alors que
  les bibliothèques sont auto-hébergées : à mettre à jour (hors périmètre
  de cette branche, signalé).
- Comparatif honnête (`tchadiapdf-vs-adobe-acrobat`) : aucun concurrent
  gratuit ne publie ses limites face à Acrobat.
- Cas d'usage administratifs francophones (dossier visa, CAF, candidature,
  mémoire) déjà amorcés dans quelques FAQ : à généraliser.

## 6. Visibilité dans les assistants IA

Ce qu'un assistant (ChatGPT, Claude, Gemini, Perplexity, AI Overviews)
a besoin de trouver pour citer un site avec confiance : une description
factuelle stable, un auteur et une licence identifiables, des limites
avouées (signal de fiabilité), un format question/réponse, des pages
comparatives et des mentions tierces. État :

| Signal | Avant | Après |
|---|---|---|
| `llms.txt` | Présent, 10 outils sur 45, sections non standard | Format standard (H1, blockquote, sections, liens absolus), 47 outils par catégorie, guides, projet, Optional ; pointeur vers llms-full |
| `llms-full.txt` | Absent | Créé : identité, méthode de confidentialité en 6 points, modèle économique, 47 outils avec limites, ce que le site ne fait pas, comparaison Acrobat, FAQ Q/R, formulation de citation recommandée |
| Page à propos vérifiable | Existe (auteur, financement, contact, GitHub) | Textes complémentaires à intégrer fournis dans le rapport (équipe design) |
| Licence visible | LICENSE dans le dépôt, mention sur a-propos et mentions légales | + `license` dans chaque JSON-LD, dans llms-full |
| Comparatif honnête | BENCHMARK.md (dépôt, non indexé par les IA de façon fiable) | Page publique `tchadiapdf-vs-adobe-acrobat` |
| FAQ en question/réponse | 30 pages en `<details>` | + FAQPage JSON-LD, + section Q/R dans llms-full, + 2 nouvelles pages |
| Accès des robots IA | Aucun blocage dans robots.txt | Inchangé : GPTBot, ClaudeBot, PerplexityBot, Google-Extended autorisés (choix assumé : le site veut être cité) |
| Mentions tierces | Aucune action (PROMOTION.md prêt) | Plan dans `docs/SEO-PLAN.md` : les assistants s'appuient fortement sur Reddit, GitHub, Product Hunt, articles comparatifs |

Limite : aucune mesure réelle de citation n'a pu être faite (pas
d'internet). Protocole de mesure proposé dans le plan (20 requêtes, 4
assistants, mensuel).

## 7. Priorisation impact / effort

| # | Action | Impact | Effort | État |
|---|---|---|---|---|
| 1 | Bloc « Outils associés » + désorphelinage des guides | Fort (maillage, découverte) | Faible (script) | Fait |
| 2 | Descriptions 70-160, titres sous 65 | Moyen (CTR) | Faible | Fait |
| 3 | Sitemap généré, `signets-pdf` inclus, hreflang | Moyen | Faible | Fait |
| 4 | JSON-LD @graph + Organization/WebSite sur l'accueil | Moyen (entités, IA) | Faible | Fait (accueil : bloc à intégrer) |
| 5 | llms.txt / llms-full.txt / comparatif / pourquoi-gratuit | Fort pour les IA, faible pour Google | Moyen | Fait |
| 6 | FAQ sur les 15 outils sans FAQ, enrichir les 8 pages < 100 mots | Fort (longue traîne) | Moyen (rédaction, équipe contenu) | À faire, semaine 1 à 4 du plan |
| 7 | `defer` sur les scripts vendor, chargement paresseux | Moyen (CWV, mobile) | Moyen (équipe JS, tests) | Recommandé |
| 8 | Lier nouvelles pages et guides depuis l'accueil / pied de page | Moyen | Faible (équipe design) | Blocs fournis |
| 9 | Search Console + Bing Webmaster + IndexNow | Fort (indexation, mesure) | Faible | Check-list dans le plan |
| 10 | Mentions tierces (GitHub topics, Product Hunt, AlternativeTo, Reddit) | Fort (autorité, citations IA) | Moyen, étalé | Plan semaines 3 à 12 |
| 11 | Mise à jour de `securite.html` (CDN, SRI) | Faible SEO, fort crédibilité | Faible | Signalé |
| 12 | Traductions des outils | Fort à long terme | Élevé | Hors 90 jours |

## 8. Ce qui a été volontairement écarté

- Pas de pages « png-en-pdf », « jpeg-en-pdf », « pdf merge » en doublon :
  cannibalisation et contenu mince.
- Pas de mots-clés dans le `<h1>` au-delà du nom de l'outil : la lisibilité
  prime, les titres SEO portent les variantes.
- Pas de `Disallow` des robots IA : le projet veut être cité et n'a pas de
  contenu à protéger.
- Pas de FAQ générées automatiquement : chaque question doit être écrite
  pour l'outil, sinon c'est du gabarit (voir AUDIT-QUALITE-GOOGLE.md § 1).
- Pas de `hreflang` vers des pages traduites inexistantes.
