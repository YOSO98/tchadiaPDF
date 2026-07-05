# TODO : tchadiaPdf, Phases 3 et 4

Ce fichier suit l'avancement du projet. Convention : `[x]` fait, `[ ]` à faire,
`[~]` fait avec un périmètre volontairement réduit (voir note associée).

**État : Phases 3 et 4 terminées.** Les Phases 1 et 2 (18 premiers outils,
design system, sous-agents, revue de code, tests Playwright) sont
terminées, cf. git log. Le site compte désormais 24 outils.

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
