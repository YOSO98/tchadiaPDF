# TODO : tchadiaPdf — Phases 3 et 4

Ce fichier suit l'avancement du projet. Convention : `[x]` fait, `[ ]` à faire,
`[~]` fait avec un périmètre volontairement réduit (voir note associée).

Les Phases 1 et 2 (18 premiers outils, design system, sous-agents, revue de
code, tests Playwright) sont terminées, cf. git log et sections précédentes
de ce fichier dans l'historique. Ce document se concentre sur les Phases 3 et 4.

## Cadrage honnête (à lire avant tout)

Les demandes des Phases 3 et 4 couvrent un périmètre qui, chez les éditeurs
concurrents, représente des années-personnes d'ingénierie (moteur WASM,
éditeur de texte PDF avec correspondance de police, i18n complet sur 5
langues avec URLs localisées, audits Lighthouse, etc.). Objectif réaliste
pour cette itération : livrer un sous-ensemble solide et honnête de chaque
bloc, documenter clairement les limites, et ne jamais prétendre à une
qualité que le code n'atteint pas réellement. Chaque affirmation de
BENCHMARK.md sera vérifiée avant d'être écrite.

---

## PHASE 3 — BLOC 1 : Moteur WASM (qpdf)

- [x] Recherche et validation technique : `@neslinesli93/qpdf-wasm` (qpdf
      compilé en WASM, wrapper ISC, qpdf lui-même Apache 2.0 : compatible MIT).
      Validé en conditions réelles avec pikepdf : chiffrement AES-256 (R6/V5),
      déchiffrement, ouverture refusée sans mot de passe.
- [x] Créer `js/qpdf-engine.js` : chargement paresseux (lazy) du module WASM
      (~1,3 Mo) depuis jsDelivr, avec indicateur de téléchargement au premier
      usage, instance mise en cache pour le reste de la session.
- [x] proteger-pdf : remplacer RC4 128 bits par AES-256 réel via qpdf-wasm
      (garder js/pdf-crypt.js comme implémentation de secours documentée,
      non supprimée, au cas où le WASM échouerait à charger).
- [x] deverrouiller-pdf : remplacer l'approche "aplatir en images" par un
      vrai déchiffrement qpdf (texte et vecteurs préservés, gain de qualité
      majeur par rapport à la Phase 2).
- [x] Nouvel outil reparer-pdf : réparation de PDF corrompus via qpdf
      (reconstruction de table xref, etc.). Limite honnête documentée :
      qpdf ne peut rien pour un fichier tronqué au point de ne plus avoir
      de structure PDF du tout (testé et confirmé).
- [x] Linéarisation : option "Optimiser pour le web (linéarisation)" ajoutée
      à proteger-pdf et reparer-pdf via `--linearize`.
- [~] Compression professionnelle (ré-échantillonnage DPI cible, suppression
      objets/polices inutilisés, métadonnées) : périmètre réduit à ce qui est
      atteignable proprement en client pur (voir notes dans compresser-pdf) ;
      pas de prétention à égaler des moteurs commerciaux propriétaires.

## PHASE 3 — BLOC 2 : Traitement par lots

- [ ] Fusionner : déjà multi-fichiers nativement (Phase 2), ajouter progression
      individuelle par fichier.
- [ ] Compresser PDF, PDF en JPG, Numéros de page, Filigrane, Rogner PDF,
      Pivoter, Diviser : ajouter mode lot (jusqu'à 50 fichiers), file
      d'attente avec pause/reprise/annulation par fichier, export ZIP global.
- [ ] Gros fichiers (jusqu'à 500 Mo) : vérifier/renforcer l'usage des
      Web Workers et des transferables pour ne jamais geler l'onglet.
      Limite honnête : au-delà d'une certaine taille, la mémoire du
      navigateur reste une contrainte dure (pas de solution miracle 100%
      client pour un PDF de 500 Mo sur un appareil à 4 Go de RAM).

## PHASE 3 — BLOC 3 : Outils avancés

- [ ] aplatir-pdf : fusion formulaires/annotations dans la page (form.flatten()).
- [ ] metadonnees-pdf : voir/modifier titre, auteur, mots-clés, dates.
- [ ] extraire-images-pdf : toutes les images d'un PDF, export ZIP.
- [ ] pdf-en-texte : extraction texte (pdf.js) + repli OCR si PDF scanné.
- [ ] livret-pdf : imposition 2 pages par feuille (assemblage livret).
- [~] Éditeur complet : voir PHASE 4 (modifier-pdf devient l'éditeur central).

## PHASE 3 — BLOC 4 : International

- [~] Infrastructure i18n légère (fichiers JSON, détection langue navigateur,
      sélecteur dans le header) : livrée.
- [~] Traduction complète en anglais, espagnol, portugais, arabe (RTL) :
      périmètre réduit à la page d'accueil + 2 outils phares (fusionner-pdf,
      modifier-pdf) plutôt qu'aux 18 outils, pour rester réaliste. Documenté
      comme périmètre initial extensible par la communauté (CONTRIBUTING.md
      mis à jour avec la marche à suivre pour traduire un outil de plus).
- [ ] URLs localisées avec hreflang : `/en/`, `/es/`, `/pt/`, `/ar/` pour les
      pages traduites uniquement (pas de génération de 90 pages fictives).
- [x] Le français reste la langue par défaut.

## PHASE 3 — BLOC 5 : Fiabilité

- [ ] Générer des PDF de test difficiles (nombreuses pages, gros DPI, police
      exotique, formulaire) et vérifier le comportement de chaque outil
      concerné, avec Playwright.
- [~] Audit performance : mesure réelle avec `lighthouse` en CLI headless sur
      quelques pages représentatives (pas de promesse de score sans mesure).
- [x] BENCHMARK.md : comparaison honnête, limites documentées.

---

## PHASE 4 — L'ÉDITEUR (modifier-pdf)

- [ ] BLOC 1 : moteur d'édition de texte existant (pdf.js getTextContent,
      regroupement en blocs, édition inline, masquage par échantillonnage de
      couleur de fond, réinjection via pdf-lib, police de substitution
      Liberation Sans/Serif/Mono avec sous-ensembles embarqués).
- [ ] BLOC 2 : fonctions d'éditeur (taille/couleur/gras/italique, suppression,
      déplacement, ajout de texte/images, whiteout, surlignage/souligné/barré,
      formes, historique annuler/rétablir illimité, zoom, vignettes,
      recherche et remplacement).
- [ ] BLOC 3 : interface (barre d'outils latérale, barre contextuelle, plein
      écran, raccourcis clavier documentés, avertissement avant fermeture,
      barre d'outils mobile en bas).
- [ ] BLOC 4 : cas difficiles (PDF scanné sans texte → proposer OCR d'abord,
      texte en tableau/incliné → whiteout + texte neuf, PDF protégé →
      renvoyer vers déverrouiller-pdf, documents 200+ pages → rendu à la
      demande).
- [ ] BLOC 5 : mise en avant (modifier-pdf en premier sur index.html, carte
      double largeur, grille réordonnée par utilité, SEO renforcé, README mis
      à jour).

Note de cadrage : la correspondance de police au pixel près avec une police
non embarquée dans le PDF d'origine est un problème non résolu même par les
éditeurs commerciaux (ils butent sur le même mur). L'objectif réaliste est
une substitution visuellement proche (serif/sans-serif/mono, gras, italique,
taille), pas un clone parfait de la police d'origine. Ce sera documenté tel
quel dans l'interface et dans BENCHMARK.md, pas présenté comme une limite
cachée.

---

## Notes techniques ajoutées en Phase 3/4

- qpdf-wasm chargé depuis `https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/`
  (fichiers `qpdf.js` + `qpdf.wasm`, ~1,3 Mo, chargement paresseux uniquement
  quand l'utilisateur déclenche une action qui en a besoin).
- Polices de substitution : Liberation Sans/Serif/Mono, licence SIL OFL 1.1,
  métriques compatibles Arial/Times New Roman/Courier New, embarquées en
  sous-ensembles (glyphes réellement utilisés uniquement) pour rester léger.
