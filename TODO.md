# TODO : tchadiaPdf

Ce fichier suit l'avancement du projet. Convention : `[x]` fait, `[ ]` à faire,
`[~]` fait avec un périmètre volontairement réduit (voir note associée).

**État : Phase Conversions en cours (Groupe 3 termine ses 2 derniers outils),
Phase 6 (Déploiement) a livré ses blocs indépendants, Phase Sécurité lancée
en parallèle sur ses blocs indépendants. Round final d'intégration (moi-même)
à faire une fois tout rentré : Groupe 4, Bloc 1/Bloc 2 Phase 6, Bloc 1/Bloc 2
Phase Sécurité, corrections de style, footer global.** Les Phases 1 à 4
(24 outils, design system, moteur WASM, éditeur PDF professionnel) sont
terminées, cf. git log et la suite de ce fichier.

---

## PHASE SÉCURITÉ : durcissement de tchadiaPdf

Objectif : sécuriser le site, sa chaîne de dépendances et l'expérience
utilisateur, de façon réaliste et vérifiable, sans jamais casser les règles
permanentes du projet.

Séquencement (même logique que la Phase 6) : les blocs qui touchent
transversalement TOUTES les pages (en-têtes CSP finaux, attribut integrity
SRI sur chaque balise script/link CDN) ne peuvent être faits proprement
qu'une fois l'inventaire final des pages stable, donc après la fin complète
de la Phase Conversions (Groupe 4 inclus). Ordre retenu :

**Maintenant, en parallèle (sous-agents, fichiers indépendants)** :
- [ ] BLOC 3 : `js/security-utils.js` (détection de type par octets magiques,
      assainisseur HTML léger, garde-fous taille/nombre de pages), audit et
      correction des injections `innerHTML` avec du contenu non fiable
      (mammoth/XLSX/PPTX/EPUB/Markdown affichés hors d'un cadre sandboxé),
      validation par octets magiques sur les outils les plus exposés.
      EN COURS (sous-agent toujours actif).
- [x] BLOC 4 + BLOC 5 : test Playwright prouvant qu'aucune requête réseau ne
      part avec le contenu d'un fichier utilisateur, `securite.html`,
      `SECURITY.md`, scan de secrets (rien trouvé), `.github/dependabot.yml`,
      étape d'audit de dépendances (`npm audit`, 0 vulnérabilité) ajoutée à
      `ci.yml`. 9/9 tests passent.

**Round final (moi-même, après la fin de la Phase Conversions)** :
- [x] BLOC 1 : CSP durcie (attributs onclick/onchange retirés au profit
      d'addEventListener, pas de nonce/hash nécessaire puisqu'aucun bloc
      `<script>` inline n'existe sur le site), HSTS preload,
      Permissions-Policy, Cross-Origin-Opener-Policy (COEP volontairement
      non activée, risque de casser les CDN sans bénéfice prouvé,
      documenté). Testé en conditions réelles (CSP injectée sur 4 pages
      représentatives via Playwright) : 4/4 passent, 0 violation.
- [ ] BLOC 2 : attribut `integrity`/`crossorigin` SRI sur CHAQUE balise
      CDN de CHAQUE page (script automatisé plutôt qu'édition manuelle,
      pour garantir la cohérence), fallback local déjà présent/à compléter
      pour chaque librairie. DEPENDENCIES.md déjà fait. Différé après la
      refonte de modifier-pdf.html (ci-dessous) pour ne pas toucher ce
      fichier pendant qu'il est en cours de refonte.

---

## PHASE EDITEUR PRO : refonte majeure de modifier-pdf.html

Objectif : amener l'éditeur au niveau des éditeurs PDF professionnels :
détection et affichage immédiat de toutes les zones éditables (pointillés
bleus), classification des blocs (titre/sous-titre/paragraphe/image),
détection de dates et d'e-mails, panneau de styles, édition avec reflow,
remplacement d'image, deux modes clairs (Annoter/Modifier), barre de
navigation de pages avec zoom et recherche. Fait par un sous-agent dédié
(fichier unique et fortement couplé, pas de parallélisation interne
possible sans risque de conflit) avec commits fréquents par étape.

- [ ] Détection : regroupement intelligent des blocs (interligne,
      changement de taille de police), détection d'images via
      paintImageXObject, classification (titre/sous-titre/paragraphe/
      ligne isolée/image), détection dates et e-mails.
- [ ] Affichage : bordures pointillées bleues permanentes en mode
      Modifier, hover = bordure pleine + fond bleu clair, actif = bordure
      plus épaisse. Infobulle de classification au survol.
- [ ] Panneau latéral droit "Styles de texte" (police, taille, gras,
      italique, souligné, alignement, couleur), synchronisé sur la
      sélection.
- [ ] Édition : double-clic = édition sur place au caractère cliqué,
      retour à la ligne automatique dans la largeur du bloc, extension
      verticale si besoin avec avertissement de chevauchement, reflow des
      blocs suivants optionnel (jamais forcé).
- [ ] Images : cadre pointillé, poignées de redimensionnement, glisser
      pour déplacer, bouton flottant Remplacer/Supprimer, ajout d'image
      libre.
- [ ] Deux modes (onglets Annoter/Modifier) avec sous-barre Modifier
      (texte/insérer/images/formulaires), bouton "Enregistrer les
      modifications" toujours visible, avertissement avant fermeture,
      barre de navigation de page (zoom, ajuster largeur, recherche).
- [ ] Robustesse : détection paresseuse par page visible (jusqu'à 100
      pages sans geler), bandeau OCR pour PDF scannés déjà en place à
      vérifier.
- [ ] Tests Playwright obligatoires sur un PDF de contrat réaliste
      (titres, paragraphes, tableaux, logos, dates, e-mails), desktop et
      mobile 375px.
- [ ] BENCHMARK.md : comparaison honnête des capacités atteintes et des
      limites restantes.

---

## PHASE README : refonte professionnelle README.md + README.en.md

Objectif : vitrine professionnelle pour le lancement (Hacker News,
Product Hunt, Reddit). Structure exacte définie par l'utilisateur : en-tête
avec badges et accroche bilingue, captures d'écran réelles (accueil +
éditeur), 3 arguments factuels, liste des outils par catégorie, section
technologies, lancer en local, contribuer, soutenir le projet, pied de
page licence. Ton sobre, aucun superlatif creux, aucun tiret long/moyen.

- [ ] Captures d'écran réelles générées via Playwright dans
      `docs/screenshots/` (accueil, éditeur avec zones en pointillés une
      fois la Phase Éditeur Pro livrée, ou l'éditeur actuel sinon, à
      régénérer ensuite si besoin).
- [ ] README.md complet selon la structure demandée, tous les liens
      vérifiés (pas seulement supposés).
- [ ] README.en.md, traduction fidèle, lien de bascule FR/EN en haut des
      deux fichiers.
- [x] Commit "README professionnel avec captures" fait (`0c80599`). Push a
      faire par l'utilisateur ou moi (voir JOURNAL.md). 43 outils confirmes,
      liens verifies (badges shields.io, fichiers du depot, pages du site).
      Capture de l'editeur prise dans son etat ACTUEL (avant la refonte
      Editeur Pro), a regenerer une fois cette derniere livree.
      Point bloquant reel signale par l'agent : le depot GitHub semble
      prive (404 en HTTPS anonyme alors que le SSH configure fonctionne),
      a rendre public avant le lancement Hacker News/Product Hunt.

---

## PHASE 6 : DÉPLOIEMENT ET LANCEMENT

Objectif : préparer la mise en production réelle (hébergement, sécurité,
mesure, monétisation prête à activer, découvrabilité, santé du dépôt
communautaire), sans jamais casser les règles permanentes du projet.

Séquencement important : certains blocs dépendent de l'inventaire FINAL des
pages du site (celui-ci n'est stable qu'une fois la Phase Conversions
entièrement terminée, Groupe 4 inclus). Ordre retenu :

**Round 1 (lancé immédiatement, en parallèle de la fin de la Phase
Conversions, sur des fichiers indépendants)** :
- [x] BLOC 2 complet : config Cloudflare Pages (`_headers`), DEPLOY.md,
      workflow GitHub Actions CI, fondation d'outillage Node de développement
      (`package.json`, `tests/` avec une vraie suite Playwright committée,
      `scripts/check-style-rules.js`). 5/5 tests locaux, 8 violations de
      style préexistantes détectées (voir plus bas, à corriger au round final).
- [x] BLOC 3 complet : `js/analytics.js` (Plausible, désactivé par défaut),
      `js/ads.js` + `js/consent-banner.js`, `ADSENSE.md`, `mentions-legales.html`
      (placeholders d'identité légale à compléter avant mise en ligne réelle),
      `confidentialite.html` mis à jour. CSS du bandeau de consentement fourni
      par l'agent, à intégrer dans `css/style.css` au round final. Balises
      `<script>` non ajoutées aux pages (fait en une seule passe au Round 2).
- [x] BLOC 5 (préparation) + PROMOTION.md : README (badges, section aperçu
      avec captures à ajouter), CONTRIBUTING complété, CODE_OF_CONDUCT.md,
      templates GitHub, CHANGELOG.md, PROMOTION.md. Chiffre d'outils et
      badge CI (statique) à corriger au Round 2.

**Round 2 (après la fin complète de la Phase Conversions, fait par moi
directement, pas par sous-agent, car nécessite l'inventaire final des
pages et une vue d'ensemble cohérente)** :
- [ ] BLOC 1 : fallback local pour toutes les CDN + integrity/crossorigin,
      minification CSS/JS via build.js, audit Lighthouse sur les 10 pages
      les plus importantes, vérification de tous les liens internes,
      sitemap à jour (toutes pages, toutes langues).
- [ ] BLOC 4 : Open Graph/Twitter Card sur toutes les pages, images de
      partage, JSON-LD sur chaque outil (PROMOTION.md déjà fait au Round 1).
- [ ] Passe finale du BLOC 5 : lien mentions-legales dans le footer de
      toutes les pages (ancien + nouveaux outils, en une seule opération),
      chiffres réels dans le README, captures d'écran réelles.
- [ ] Mise à jour finale de README.md et CHANGELOG.md, commit, push.

---

## PHASE CONVERSIONS : tchadiaPdf, centre de conversion complet

Objectif : transformer tchadiaPdf en centre de conversion de fichiers
complet (Office, images, formats modernes), en gardant les règles
permanentes du projet : uniquement blanc/bleu, français comme langue par
défaut (les 4 autres langues restent celles de la page d'accueil, périmètre
existant non étendu automatiquement à ces 19 nouvelles pages sauf mention
contraire), aucun tiret long ou moyen (—/–) nulle part, 100% navigateur
(aucun envoi de fichier à un serveur), tests Playwright avant de considérer
un outil terminé, et ne rien casser des 24 outils existants.

Méthode : exécution autonome, un sous-agent dédié par groupe de conversions
(Groupes 1, 2, 3), chaque sous-agent ne créant que des fichiers nouveaux
(une page HTML + un script JS par outil, plus ses propres scripts de test
dans le répertoire de travail temporaire) pour éviter tout conflit d'édition
en parallèle. L'intégration transverse (Groupe 4 : accueil, page pivot
`conversions.html`, composants CSS partagés `.fidelity-box`/`.faq`/`.banner`)
est faite après coup, une fois les 3 groupes livrés, pour garantir la
cohérence finale.

### Composants partagés (faits en amont, avant les sous-agents)

- [x] `css/style.css` : `.fidelity-box` (encadré bleu clair "Fidélité de
      conversion"), `.faq` (accordéon `<details>/<summary>` pour la FAQ SEO),
      `.banner`/`.banner-actions` (bandeau d'information avec bouton
      d'action, généralisé pour toutes les pages de conversion),
      `.conv-matrix`/`.conv-group`/`.conv-links` (page pivot).

### GROUPE 1 : Office vers PDF (terminé)

- [x] word-en-pdf, excel-en-pdf, powerpoint-en-pdf, texte-en-pdf. Testés avec
      fixtures réelles (DOCX tableau+images, XLSX 3 feuilles, PPTX 5 slides,
      TXT). 2 bugs trouvés et corrigés en cours de route (images mammoth non
      chargées avant pagination, faux .xlsx accepté silencieusement).

### GROUPE 2 : PDF vers Office (terminé)

- [x] pdf-en-word, pdf-en-excel (aperçu avant téléchargement), pdf-en-powerpoint.
      pdf-en-texte vérifié fonctionnel, non modifié.

### GROUPE 3 : Images et formats modernes (terminé, 12/12)

- [x] heic-en-jpg, heic-en-pdf, webp-en-pdf, tiff-en-pdf, bmp-en-pdf,
      png-en-jpg, jpg-en-png, svg-en-pdf, svg-en-png, markdown-en-pdf,
      html-en-pdf (sandbox vérifié contre XSS), epub-en-pdf (bug blob:
      images trouvé et corrigé).

### GROUPE 4 : Interface et honnêteté (terminé)

- [x] Nouvelle catégorie "Convertir" sur `index.html`, en 2e position,
      sous-sections Vers PDF (13) / Depuis PDF (5) / Images (4).
- [x] Page pivot `conversions.html` : matrice des 22 conversions + FAQ.
- [x] Encadré "Fidélité de conversion" et FAQ SEO sur chaque page (fait par
      chaque groupe individuellement).
- [x] Traitement par lots (20 fichiers, ZIP) sur chaque outil de conversion.

### VALIDATION (terminée)

- [x] Re-testé les 22 conversions après les correctifs de sécurité du Bloc 3,
      fichier de sortie rouvert et vérifié programmatiquement : 22/22 OK.
- [x] `BENCHMARK.md` mis à jour avec les limites réelles de chaque groupe.
- [x] Suite de tests Playwright committée rejouée : 9/9, 0 régression.
- [ ] Push différé à la toute fin de la session autonome (voir dernière
      section de ce fichier).

---

## Historique : Phases 1 à 4 (terminées)

## Cadrage honnête (à lire avant tout)

Les demandes des Phases 3 et 4 couvrent un périmètre qui, chez les éditeurs
concurrents, représente des années-personnes d'ingénierie (moteur WASM,
éditeur de texte PDF avec correspondance de police, i18n complet sur 5
langues avec URLs localisées, audits Lighthouse, etc.). Objectif réaliste
retenu : livrer un sous-ensemble solide et honnête de chaque bloc,
documenter clairement les limites, et ne jamais prétendre à une qualité
que le code n'atteint pas réellement. Voir BENCHMARK.md pour le détail
vérifié de chaque affirmation.

---

## PHASE 3, BLOC 1 : Moteur WASM (qpdf)

- [x] Recherche et validation technique : `@neslinesli93/qpdf-wasm` (qpdf
      compilé en WASM, wrapper ISC, qpdf lui-même Apache 2.0 : compatible MIT).
      Validé en conditions réelles avec pikepdf : chiffrement AES-256 (R6/V5),
      déchiffrement, ouverture refusée sans mot de passe.
- [x] `js/qpdf-engine.js` : chargement paresseux (lazy) du module WASM
      (~1,3 Mo) depuis jsDelivr, avec indicateur de téléchargement au premier
      usage, instance mise en cache pour le reste de la session.
- [x] proteger-pdf : chiffrement AES-256 réel via qpdf-wasm (repli automatique
      sur js/pdf-crypt.js en RC4 128 bits si le moteur ne charge pas).
- [x] deverrouiller-pdf : déchiffrement réel via qpdf, texte et vecteurs
      préservés (repli sur l'ancienne méthode "aplatir en images" si le
      moteur qpdf ne charge pas).
- [x] reparer-pdf (nouvel outil) : réparation de PDF corrompus via qpdf.
- [x] Linéarisation : option ajoutée à proteger-pdf et reparer-pdf.
- [~] Compression professionnelle : recompression JPEG uniquement (voir
      limite documentée dans BENCHMARK.md), pas de ré-échantillonnage DPI
      explicite ni de suppression d'objets/polices inutilisés dans cette
      itération.

## PHASE 3, BLOC 2 : Traitement par lots

- [x] Compresser PDF : mode lot (jusqu'à 50 fichiers), file d'attente,
      pause/reprise/annulation, export ZIP, Web Worker réutilisé pour tout
      le lot.
- [x] Rogner PDF : mode lot, zone de recadrage définie une fois sur le
      premier fichier puis appliquée proportionnellement aux autres.
- [x] PDF en JPG : mode lot, ZIP avec noms préfixés par fichier source.
- [x] Faire pivoter PDF : mode lot (outil historique, non-régression
      vérifiée).
- [x] Numéros de page : mode lot, réglages uniques appliqués à tous les
      fichiers.
- [x] Filigrane : mode lot, réglages uniques appliqués à tous les fichiers.
- [x] Non-régression du mode un seul fichier vérifiée avec Playwright sur
      les 6 outils (comportement identique à l'avant, pas de ZIP inutile).
- [~] Diviser, Fusionner : non retouchés dans cette itération (Fusionner
      gère déjà nativement plusieurs fichiers depuis la Phase 2 ; Diviser
      n'a pas été jugé prioritaire, l'extraction de pages par lot ayant un
      sens d'usage moins évident).
- [x] Gros fichiers : compresser-pdf utilise déjà un Web Worker (rule 6) ;
      testé avec une image embarquée de 3000x2000 px (PDF de 4,2 Mo) sans
      geler l'interface.

## PHASE 3, BLOC 3 : Outils avancés

- [x] aplatir-pdf : fusion formulaires dans la page (form.flatten()).
- [x] metadonnees-pdf : voir/modifier titre, auteur, mots-clés.
- [x] extraire-images-pdf : toutes les images d'un PDF, export ZIP.
- [x] pdf-en-texte : extraction texte (pdf.js) + repli OCR si PDF scanné.
- [x] livret-pdf : imposition 2 pages par feuille, algorithme vérifié.
- [x] Éditeur complet : voir PHASE 4 (modifier-pdf devient l'éditeur central).

## PHASE 3, BLOC 4 : International

- [x] Infrastructure i18n légère : pages statiques localisées + sélecteur
      de langue dans l'en-tête + détection non automatique (l'utilisateur
      choisit via le sélecteur, pas de redirection automatique intrusive).
- [~] Traduction complète en anglais, espagnol, portugais, arabe (RTL) :
      périmètre réduit à la page d'accueil (pas aux 24 pages d'outils, ce
      qui aurait représenté 96 pages supplémentaires à traduire et
      maintenir). Les cartes d'outils des pages traduites renvoient vers
      les pages françaises existantes, avec une note explicite à ce sujet.
      Documenté comme périmètre initial extensible par la communauté.
- [x] URLs localisées avec hreflang : `/en/`, `/es/`, `/pt/`, `/ar/`
      (répertoires physiques, pas de génération de pages fictives).
- [x] Support RTL propre pour l'arabe : `dir="rtl"`, mise en page miroir,
      icônes retournées, vérifié visuellement.
- [x] Le français reste la langue par défaut.

## PHASE 3, BLOC 5 : Fiabilité

- [x] PDF de test difficiles générés et vérifiés avec Playwright : 300
      pages (organiser-pdf, numeros-de-pages, modifier-pdf), grosse image
      3000x2000 px (compresser-pdf), formulaire AcroForm réel
      (formulaires-pdf, aplatir-pdf).
- [x] Audit performance réel avec `lighthouse` en CLI headless sur 3 pages
      représentatives (voir BENCHMARK.md pour les scores et leur analyse).
- [x] BENCHMARK.md : comparaison honnête, limites documentées.

---

## PHASE 4, L'ÉDITEUR (modifier-pdf)

- [x] BLOC 1 : moteur d'édition de texte existant (pdf.js getTextContent,
      regroupement en blocs, édition inline, masquage par échantillonnage de
      couleur de fond, réinjection via pdf-lib, police de substitution
      Liberation Sans/Serif/Mono avec sous-ensembles embarqués). Validé
      visuellement : texte original masqué, nouveau texte enveloppé avec la
      police de substitution.
- [x] BLOC 2 : fonctions d'éditeur (taille/couleur/gras/italique, suppression,
      déplacement, ajout de texte/images, whiteout, surlignage/souligné/barré,
      formes dont la flèche, historique annuler/rétablir illimité, zoom,
      vignettes, recherche et remplacement).
- [x] BLOC 3 : interface (barre d'outils latérale, barre contextuelle, plein
      écran, raccourcis clavier documentés via une aide "?", avertissement
      avant fermeture (beforeunload), barre d'outils mobile en bas).
- [x] BLOC 4 : cas difficiles (PDF scanné sans texte → bandeau proposant
      l'OCR, PDF protégé → renvoyer vers déverrouiller-pdf, documents 200+
      pages → seule la page courante est rendue en pleine résolution,
      vignettes progressives non bloquantes).
- [x] BLOC 5 : mise en avant (modifier-pdf en première position sur
      index.html, carte double largeur, grille réordonnée par utilité,
      section SEO ajoutée sur modifier-pdf.html, README mis à jour).

Note de cadrage : la correspondance de police au pixel près avec une police
non embarquée dans le PDF d'origine est un problème non résolu même par les
éditeurs commerciaux (ils butent sur le même mur). L'objectif réaliste
retenu est une substitution visuellement proche (serif/sans-serif/mono,
gras, italique, taille), pas un clone parfait de la police d'origine :
documenté tel quel dans le README et BENCHMARK.md.

---

## Notes techniques ajoutées en Phase 3/4

- qpdf-wasm chargé depuis `https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/`
  (fichiers `qpdf.js` + `qpdf.wasm`, ~1,3 Mo, chargement paresseux uniquement
  quand l'utilisateur déclenche une action qui en a besoin).
- Polices de substitution : Liberation Sans/Serif/Mono, licence SIL OFL 1.1,
  récupérées en TTF depuis `github.com/shantigilbert/liberation-fonts-ttf`
  (miroir du projet officiel), métriques compatibles Arial/Times New
  Roman/Courier New, embarquées en sous-ensembles via pdf-lib + fontkit
  (`@pdf-lib/fontkit`, chargé paresseusement au moment de l'enregistrement
  uniquement, ce qui a fait passer le score Lighthouse de modifier-pdf.html
  de 65 à 78).
- Note technique WOFF2 : les polices `@fontsource` (WOFF2) provoquent une
  erreur dans le sous-ensembleur de `@pdf-lib/fontkit` (`RangeError: Index
  out of range` dans `TTFSubset._addGlyph`) ; les fichiers TTF bruts de
  Liberation Fonts, eux, se sous-ensemblent sans problème. D'où le choix du
  dépôt GitHub ci-dessus plutôt qu'un package npm de polices web modernes.

## Pistes d'amélioration futures (non bloquantes, voir BENCHMARK.md)

- Audit Lighthouse sur le déploiement de production (CDN réel).
- Ré-échantillonnage DPI explicite et nettoyage des objets inutilisés pour
  compresser-pdf.
- Détection automatique des bords pour scanner-pdf.
- Étendre l'internationalisation aux pages d'outils individuelles.
- Permissions de chiffrement PDF plus fines pour proteger-pdf (actuellement
  toutes les permissions sont accordées par défaut).
- Mode lot pour Diviser PDF.
