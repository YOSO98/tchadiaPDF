# Plan SEO et visibilité IA à 90 jours : tchadiaPdf

Rédigé le 30 octobre 2026, à partir de `docs/SEO-AUDIT.md`. Hypothèse de
départ : le site est déployé sur tchadiapdf.com, Search Console est déjà
vérifiée (la balise `google-site-verification` est présente sur l'accueil),
aucune donnée de trafic n'a encore été analysée. Le plan est écrit pour
une personne seule, environ 4 à 6 heures par semaine, sans budget.

Règle de conduite : rien de ce qui suit ne doit introduire une promesse
non vérifiée, un tiret cadratin, un mot-clé répété pour le robot, un
script tiers, ou un lien acheté. Le site se distingue par l'honnêteté ;
c'est aussi sa meilleure stratégie face à des concurrents qui ne peuvent
pas se le permettre à l'échelle de centaines d'outils générés en série.

## 1. Indicateurs (KPI) et comment les mesurer

| Indicateur | Source | Point de départ | Objectif J+90 |
|---|---|---|---|
| Pages indexées (hors `noindex`) | Search Console, rapport Indexation des pages | à relever à J+7 | 68 / 68 (toutes les URL du sitemap) |
| Impressions / 28 jours | Search Console, Performances | à relever | Croissance régulière ; un ordre de grandeur de 5 à 10 fois le point de départ est réaliste pour un site neuf qui part de presque rien, pas un engagement |
| Clics / 28 jours | Search Console | à relever | Idem ; suivre surtout le CTR par page (titres et descriptions réécrits) |
| Position moyenne sur les 20 requêtes cibles | Search Console, filtre par requête | à relever | Top 30 sur les 10 requêtes de longue traîne, top 50 sur les 10 requêtes génériques |
| Pages avec au moins 1 clic | Search Console | à relever | 40 pages sur 68 |
| Core Web Vitals (mobile) | Search Console, rapport Signaux Web ; PageSpeed Insights | données insuffisantes probables (site neuf) | LCP < 2,5 s sur l'accueil, fusionner, compresser ; aucune URL « médiocre » |
| Citations IA | Protocole manuel ci-dessous | à relever à J+7 | Mention dans au moins 1 réponse sur 4 pour les requêtes « outil PDF gratuit sans envoi de fichier », « alternative gratuite à iLovePDF en français », « caviarder un pdf gratuitement » |
| Liens entrants (domaines référents) | Search Console, rapport Liens ; Bing Webmaster | 0 ou quasi | 10 à 15 domaines légitimes (GitHub, annuaires open source, Product Hunt, AlternativeTo, forums) |
| Étoiles GitHub | github.com/YOSO98/tchadiaPDF | à relever | Indicateur secondaire de notoriété, pas un objectif en soi |

### Les 20 requêtes cibles

Génériques, fort volume, concurrence maximale (objectif : exister, pas gagner) :

1. fusionner pdf
2. compresser pdf gratuit
3. pdf en word gratuit
4. signer un pdf gratuit
5. modifier pdf gratuit
6. diviser pdf
7. jpg en pdf
8. ocr pdf gratuit
9. protéger pdf mot de passe
10. word en pdf gratuit

Longue traîne et intention précise (objectif : top 30 puis top 10) :

11. caviarder un pdf gratuitement
12. outil pdf sans envoyer le fichier sur un serveur
13. imprimer un pdf en livret
14. aplatir un formulaire pdf
15. numérotation bates pdf gratuit
16. scanner un document avec son téléphone sans application
17. heic en pdf gratuit
18. réparer un pdf qui ne s'ouvre pas
19. markdown en pdf en ligne
20. alternative gratuite à adobe acrobat open source

Mesure : dans Search Console, Performances, ajouter un filtre « Requête »
pour chacune, relever position et impressions tous les 14 jours dans un
tableau (un simple fichier CSV dans `docs/` suffit, pas d'outil payant).

### Protocole de mesure des citations IA (mensuel, 1 heure)

Pour chacun des assistants ChatGPT, Claude, Gemini, Perplexity (et Google
AI Overviews quand elles apparaissent), poser, en français, dans une
session neuve sans historique :

- « Quel outil gratuit pour fusionner des PDF sans envoyer mes fichiers sur un serveur ? »
- « Comment caviarder un PDF gratuitement en français ? »
- « Existe-t-il une alternative open source à iLovePDF ? »
- « tchadiaPdf, c'est quoi ? est-ce fiable ? »
- « Quel site pour convertir HEIC en PDF gratuitement sans application ? »

Noter : cité ou non, position dans la liste, exactitude de la description
(doit mentionner : gratuit, navigateur, open source MIT, français),
présence d'une erreur à corriger sur le site (si l'assistant affirme
quelque chose de faux, c'est souvent que la page source est ambiguë).
Conserver les réponses datées dans `docs/suivi-ia/AAAA-MM.md`.

## 2. Check-list Search Console, Bing Webmaster, IndexNow

À faire une fois, semaine 1. Aucune clé ni identifiant n'est inventé ici :
chaque valeur est générée par l'outil concerné au moment de l'inscription.

### Google Search Console

1. Ouvrir search.google.com/search-console, propriété « Domaine »
   `tchadiapdf.com` (couvre http, https, www et sous-domaines) de
   préférence à la propriété « Préfixe d'URL ». La validation domaine se
   fait par un enregistrement DNS TXT fourni par Google, à ajouter dans
   le DNS Cloudflare (Cloudflare gère le DNS du domaine). La balise
   `google-site-verification` déjà présente sur l'accueil valide la
   propriété « Préfixe d'URL » ; garder les deux ne pose aucun problème.
2. Sitemaps : soumettre `https://tchadiapdf.com/sitemap.xml`. Vérifier
   après 48 heures que le statut est « Opération réussie » et que le
   nombre d'URL découvertes est 68.
3. Indexation des pages : relever le nombre de pages indexées et la liste
   des exclusions. Exclusions attendues et normales : `404.html`
   (noindex), `offline.html` (non liée), les fichiers `/vendor/`, `/docs/`,
   `*.md` (X-Robots-Tag noindex). Toute page d'outil en « Explorée,
   actuellement non indexée » doit être demandée via Inspection de l'URL.
4. Inspection de l'URL : tester `https://tchadiapdf.com/fusionner` et
   `https://tchadiapdf.com/caviarder-pdf`, cliquer « Tester l'URL en direct »
   puis « Afficher la page explorée » : vérifier que le HTML rendu contient
   le bloc « Outils associés » et le JSON-LD. Demander l'indexation des 2
   nouvelles pages (`pourquoi-gratuit`, `tchadiapdf-vs-adobe-acrobat`) et
   de `signets-pdf`.
5. Améliorations : les rapports « Fils d'Ariane », « FAQ » (peut ne pas
   apparaître), « Applications logicielles » doivent afficher 0 erreur.
   Un avertissement « champ facultatif manquant » est acceptable.
6. Paramètres, Statistiques sur l'exploration (après 2 à 3 semaines) :
   vérifier qu'aucune part significative des requêtes ne part sur
   `/vendor/` ou `/tests/` ; sinon renforcer robots.txt.
7. Ciblage international : rien à configurer (hreflang gère les langues,
   le ciblage géographique par pays n'est pas souhaité : francophonie
   entière).

### Bing Webmaster Tools

1. Ouvrir www.bing.com/webmasters, « Importer depuis Google Search
   Console » : cela reprend la propriété vérifiée et le sitemap sans
   nouvelle validation. Sinon, valider par la balise `msvalidate.01`
   fournie par Bing (à ajouter dans `<head>` de index.html par l'équipe
   design) ou par enregistrement DNS CNAME.
2. Sitemaps : vérifier que `sitemap.xml` est listé ; sinon le soumettre.
3. Lancer l'« Analyse du site » (SEO) intégrée : elle signale les titres
   longs et descriptions longues ; les erreurs doivent être nulles après
   cette branche.
4. Bing alimente Copilot et DuckDuckGo, et Bing est une des sources
   d'actualité de ChatGPT : son indexation compte pour la visibilité IA.

### IndexNow (Bing, Yandex, Naver, Seznam ; pas Google)

1. Dans Bing Webmaster, section IndexNow, générer une clé (chaîne
   hexadécimale fournie par Bing). Ne pas la créer soi-même au hasard dans
   le dépôt : la copier depuis l'interface.
2. Créer le fichier `/<clé>.txt` à la racine du dépôt contenant uniquement
   la clé. Ne pas le lister dans le sitemap. Ajouter dans `_headers`
   une règle `/<clé>.txt` avec `X-Robots-Tag: noindex`.
3. À chaque déploiement qui change des pages, soumettre les URL modifiées :
   `POST https://api.indexnow.org/indexnow` avec un corps JSON
   `{"host":"tchadiapdf.com","key":"<clé>","keyLocation":"https://tchadiapdf.com/<clé>.txt","urlList":[...]}`.
   Une étape optionnelle du workflow GitHub Actions de déploiement peut
   le faire avec `curl` (la clé stockée en secret du dépôt, jamais dans le
   code) ; tant que ce n'est pas automatisé, soumettre à la main les URL
   des nouvelles pages depuis Bing Webmaster (« Soumettre des URL »).
4. Google ignore IndexNow : pour Google, sitemap + liens internes +
   demandes d'indexation ponctuelles suffisent.

### Autres inscriptions utiles, gratuites et légitimes

- Cloudflare Web Analytics (sans cookie) ou Plausible déjà prévu dans
  `js/analytics.js` : activer l'un des deux pour mesurer les pages de
  destination réelles ; sans mesure d'audience, Search Console reste la
  seule source.
- Schema Markup Validator (validator.schema.org) et Test des résultats
  enrichis (search.google.com/test/rich-results) sur 3 pages : fusionner,
  pdf-en-word, tchadiapdf-vs-adobe-acrobat.

## 3. Calendrier semaine par semaine

Les actions « équipe design » et « équipe JS » sont celles qui touchent
`index.html`, `a-propos.html`, `css/`, `js/` ; les blocs correspondants
sont dans `docs/SEO-BLOCS-ACCUEIL.md`.

### Semaine 1 (J+1 à J+7) : fondations et mesure

- Fusionner cette branche ; relancer `node scripts/seo-appliquer.js &&
  node scripts/generer-sitemap.js && node scripts/verifier-seo.js` après
  la fusion des branches `signets`, `pieces-jointes`, `assainir` et `design`.
- Équipe design : intégrer le JSON-LD de l'accueil (`--accueil` ou bloc
  fourni), ajouter au pied de page les liens « Pourquoi c'est gratuit » et
  « tchadiaPdf ou Acrobat », ajouter une section « Guides » (5 liens) et la
  carte Signets PDF sur l'accueil.
- Search Console : check-list complète ci-dessus ; Bing : import ;
  IndexNow : clé.
- Relever les points de départ de tous les KPI (tableau CSV).
- Première mesure des citations IA (protocole § 1).

### Semaine 2 : les 8 pages sous 100 mots

Rédiger, pour chacune, une FAQ de 4 questions réellement propres à l'outil
(pas de gabarit ; relire AUDIT-QUALITE-GOOGLE.md § 1 avant) et un court
paragraphe d'usage. Ordre, par volume de recherche estimé et par faiblesse
actuelle :

1. `signer-pdf` : valeur d'une signature dessinée vs électronique, taille
   et couleur, plusieurs pages, PDF protégé.
2. `diviser` : plage de pages, un fichier par page, PDF protégé, ordre.
3. `jpg-en-pdf` : ordre des images, orientation et marges, qualité, PNG
   accepté, limite de 20.
4. `ocr-pdf` : langues, durée (ordre de grandeur honnête par page),
   précision, différence avec PDF en texte, texte invisible.
5. `organiser-pdf`, `pivoter`, `deverrouiller-pdf`, `formulaires-pdf`.

`node scripts/seo-appliquer.js` regénère la FAQPage automatiquement
depuis les `<details>` ajoutés ; mettre à jour `faq` dans
`data/outils.json` pour garder le registre informatif (ou relancer
l'extraction).

### Semaine 3 : les 7 autres pages sans FAQ et le comparatif

- FAQ pour `modifier-pdf`, `proteger-pdf`, `metadonnees-pdf`, `signets-pdf`,
  `filigrane`, `rogner-pdf`, `pdf-en-texte`.
- Relire `tchadiapdf-vs-adobe-acrobat.html` face au site d'Adobe du
  moment (les offres changent) ; dater la relecture dans la page.
- Équipe JS : étudier `defer` sur les scripts vendor (voir SEO-AUDIT § 1.5).

### Semaine 4 : premier guide et premiers signaux externes

- Guide n° 1 : « Comment fusionner des PDF pour un dossier administratif
  (visa, CAF, candidature) sans dépasser la taille limite » : requête
  réelle sans page dédiée chez les concurrents (NICHES.md), relie
  fusionner, compresser, organiser, scanner.
- GitHub : topics du dépôt (`pdf`, `pdf-tools`, `pdf-editor`, `privacy`,
  `webassembly`, `static-site`, `french`, `open-source`), description en
  une phrase, README avec capture récente, lien vers le site dans « About ».
  Vérifier que le README anglais pointe vers tchadiapdf.com.
- Mesure J+30 des KPI.

### Semaines 5 et 6 : guides et annuaires open source

- Guide n° 2 : « Comment signer un PDF gratuitement, et quand une signature
  électronique est nécessaire ».
- Guide n° 3 : « PDF trop lourd pour un formulaire en ligne : les 4
  méthodes, et pourquoi la compression ne suffit pas toujours ».
- Soumissions (gratuites, pertinentes, une par jour maximum) :
  AlternativeTo (fiche « alternative à iLovePDF, Smallpdf, Adobe Acrobat »
  avec description factuelle), Open Source Alternative, awesome-lists
  GitHub pertinentes (par pull request respectueuse des règles de la
  liste : `awesome-selfhosted` ne convient pas, il faut un service
  auto-hébergeable ; `awesome-privacy` ou listes PDF conviennent mieux),
  Framalibre (annuaire francophone du libre, très pertinent).

### Semaines 7 et 8 : lancement communautaire

- Product Hunt : lancement un mardi ou mercredi, visuels des outils,
  texte de PROMOTION.md, réponse à tous les commentaires le jour même.
- Hacker News « Show HN » (texte de PROMOTION.md), même semaine mais pas
  le même jour.
- r/opensource puis r/france (fil dédié aux projets), en respectant le
  ton et les règles (PROMOTION.md).
- Guide n° 4 : « Scanner un dossier de plusieurs pages avec son téléphone
  et le réduire sous 2 Mo ».
- Mesure J+60 ; deuxième relevé des citations IA.

### Semaines 9 et 10 : contenu de différenciation

- Article dev.to ou blog technique : « Comment tchadiaPdf prouve qu'aucun
  fichier ne quitte le navigateur (test Playwright de non-fuite) ». Les
  articles techniques sont très repris par les assistants IA.
- Guide n° 5 : « Caviarder ou aplatir ? Masquer, figer, nettoyer un PDF
  avant de l'envoyer » (relie caviarder, aplatir, métadonnées, assainir,
  pièces jointes une fois livrés).
- Mettre à jour `llms-full.txt` avec les nouveaux outils livrés et
  `llms.txt` (section Guides).

### Semaines 11 et 12 : consolidation

- Revue Search Console : pages à CTR faible (impressions élevées, clics
  bas) : réécrire titre et description dans `data/outils.json`, relancer
  `seo-appliquer`. Pages en position 11 à 20 : enrichir d'une FAQ ou d'un
  paragraphe d'usage.
- Vérifier les Core Web Vitals réels (rapport Search Console) ; si LCP
  mobile > 2,5 s sur les outils, prioriser le `defer` / chargement
  paresseux avec l'équipe JS.
- Relevé J+90 de tous les KPI, troisième mesure IA, bilan et plan suivant
  (traductions des pages d'outils si l'audience en/es/pt/ar apparaît dans
  Search Console).

## 4. Stratégie de contenu

### Principes

- Une page par intention, pas par variante lexicale.
- Chaque page d'outil : H1 court, sous-titre qui dit ce que fait l'outil et
  sa limite principale, FAQ de 3 à 6 questions **réellement posées** pour
  cet outil, encadré « fidélité » quand il y a une approximation, bloc
  « Outils associés » (automatique).
- Chaque guide : « Comment + tâche », 400 à 800 mots, étapes numérotées,
  section « Pourquoi c'est fiable » ou « Ce qui peut mal se passer », lien
  vers l'outil en haut et en bas, date de mise à jour visible, JSON-LD
  HowTo (sans nom de fichier dans le texte des étapes).
- Pas de blog d'actualité, pas d'articles « 10 meilleurs outils PDF » qui
  recommanderaient le site lui-même : pas crédible.

### Guides à écrire, dans l'ordre (requête cible entre parenthèses)

1. Fusionner des PDF pour un dossier administratif sans dépasser la taille limite (fusionner pdf dossier visa taille limite)
2. Signer un PDF gratuitement, et quand une signature électronique est nécessaire (signer un pdf gratuit valeur juridique)
3. PDF trop lourd pour un formulaire en ligne : 4 méthodes (réduire taille pdf pour envoi)
4. Scanner un dossier de plusieurs pages avec son téléphone et le réduire sous 2 Mo (scanner plusieurs pages en un pdf téléphone)
5. Caviarder ou aplatir : masquer, figer, nettoyer un PDF avant de l'envoyer (anonymiser un pdf)
6. Convertir un PDF scanné en Word : OCR puis conversion (pdf scanné en word)
7. Numérotation Bates : à quoi ça sert et comment la faire gratuitement (numérotation bates)
8. Photos iPhone HEIC : les envoyer en PDF ou JPG lisibles partout (heic illisible)
9. Markdown en PDF propre pour un rapport ou un README (markdown vers pdf)
10. Protéger un PDF par mot de passe : ce que ça protège vraiment (protéger pdf mot de passe limites)

### Pages d'outils à enrichir (ordre)

signer-pdf, diviser, jpg-en-pdf, ocr-pdf, organiser-pdf, pivoter,
deverrouiller-pdf, formulaires-pdf, modifier-pdf, proteger-pdf,
metadonnees-pdf, signets-pdf, filigrane, rogner-pdf, pdf-en-texte, puis
compresser-pdf (FAQ « pourquoi mon PDF ne maigrit pas »).

### Pages annexes

- `securite.html` : retirer les mentions de CDN et de SRI « en cours »
  (obsolètes depuis l'auto-hébergement dans /vendor/), sinon un lecteur
  attentif, humain ou IA, y verra une contradiction.
- `a-propos.html` : ajouter les textes fournis dans `docs/SEO-BLOCS-ACCUEIL.md`
  (chiffres clés, « ce que nous ne faisons pas », comment vérifier, comment
  citer).
- `conversions.html` : une phrase par conversion (aujourd'hui une simple
  liste de liens), pour en faire un vrai hub.

## 5. Liens entrants légitimes

À faire :

- GitHub : topics, description, README, « About » avec l'URL ; les pages
  GitHub sont fortement utilisées par les assistants IA pour décrire un
  projet open source.
- Product Hunt, Hacker News, Reddit (r/opensource, r/webdev, r/france) :
  textes prêts dans PROMOTION.md ; espacer les publications.
- AlternativeTo, Open Source Alternative, Framalibre, annuaires de
  logiciels libres francophones : fiches factuelles, sans superlatif.
- Listes « awesome » GitHub pertinentes, par pull request conforme aux
  règles de chaque liste.
- Communautés francophones de développeurs et associations (PROMOTION.md),
  en apportant une réponse utile (par exemple à quelqu'un qui cherche à
  caviarder un document) plutôt qu'un lien nu.
- Un article technique (dev.to, blog personnel) sur le test de non-fuite
  réseau ou sur qpdf en WebAssembly.

À ne pas faire :

- Wikipédia : pas de page sur tchadiaPdf (critères de notoriété non
  remplis ; une création serait supprimée et nuirait à la réputation), pas
  d'ajout de lien dans des articles existants (considéré comme du spam).
- Achat de liens, échanges de liens, réseaux de sites, commentaires de
  blog avec lien, annuaires généralistes payants : risque de pénalité et
  contraire à l'esprit du projet.
- Communiqués de presse répétés, publications identiques sur toutes les
  plateformes le même jour.
- Faux avis, fausses questions sur les forums pour y répondre soi-même.

## 6. Ce qu'il ne faut PAS faire (rappel transversal)

- Pas de pages dupliquées par variante de mot-clé (« pdf fusionner »,
  « fusion pdf », « merger pdf ») : une seule page par intention.
- Pas de FAQ générée par gabarit sur tous les outils : chaque question
  doit être spécifique, sinon Google y voit du contenu mince (voir
  AUDIT-QUALITE-GOOGLE.md).
- Pas de texte caché, pas de mots-clés en bas de page, pas de titres qui
  promettent ce que l'outil ne fait pas (« compressez de 90 % »).
- Pas de redirection ni de réécriture d'URL : les slugs actuels sont
  bons et stables ; changer une URL perd l'historique.
- Pas de blocage des robots IA dans robots.txt (choix délibéré : le site
  veut être cité) ; pas de `noindex` sur les guides.
- Pas de script tiers supplémentaire pour « mesurer le SEO » : Search
  Console et Bing Webmaster suffisent, et la CSP du site l'interdirait de
  toute façon.
- Pas de modification manuelle du `<head>` des pages d'outils : passer par
  `data/outils.json` puis `node scripts/seo-appliquer.js`, sinon
  `verifier-seo` échoue et les changements seront écrasés.
- Pas d'annonce « nous sommes les meilleurs » : le comparatif Acrobat
  liste ce que tchadiaPdf ne fait pas, c'est précisément ce qui le rend
  crédible et citable.

## 7. Maintenance : ce qui tourne à chaque livraison

```
node scripts/seo-appliquer.js && node scripts/generer-sitemap.js && node scripts/verifier-seo.js
npm run check-style && TCHADIA_TEST_PORT=8962 npx playwright test
```

- Nouvel outil : ajouter son entrée dans `data/outils.json` (titre, description
  70-160, mots-clés, 3 à 5 associés, catégorie), créer la page avec une
  `<section class="faq">`, relancer les trois scripts. Le sitemap, le
  JSON-LD, le bloc associé et les liens entrants depuis les voisins se
  mettent à jour seuls.
- Nouveau guide : fichier dans `guides/`, slug ajouté dans `guides` de
  l'outil concerné dans le registre, ligne dans `llms.txt`.
- Tous les trimestres : relire `llms-full.txt` et le comparatif Acrobat.
