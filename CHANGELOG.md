# Journal des modifications

Tous les changements notables de ce projet sont documentés dans ce
fichier, dans l'esprit de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Ce projet
n'utilise pas de numéros de version sémantique classiques : les entrées
sont organisées par phase de développement, telles que suivies dans
[TODO.md](TODO.md). Le détail technique de chaque affirmation ci-dessous
(limites, choix assumés) se trouve dans [BENCHMARK.md](BENCHMARK.md).

## [Non publié] : Parité Acrobat, vague 2

### Ajouté

- Signer PDF : signature numérique PAdES (B-B, `ETSI.CAdES.detached`,
  SHA-256, RSA ou ECDSA) avec un certificat .p12/.pfx ouvert localement.
  Le certificat, son mot de passe et le PDF ne quittent pas le navigateur.
  Bibliothèques pkijs et @signpdf vendorisées dans `vendor/` (SRI,
  chargement à la demande). Limites détaillées dans BENCHMARK.md.

## [Non publié] : Phase Conversions et Phase 6 (en cours)

Cette section décrit un travail en cours au moment de la rédaction. Le
périmètre exact n'est pas encore figé : se référer à TODO.md pour l'état
le plus à jour.

### En cours d'ajout

- Phase Conversions : nouveaux outils de conversion (Office vers PDF, PDF
  vers Office, images et formats modernes vers/depuis PDF ou entre eux).
  Le nombre exact d'outils de conversion livrés n'est pas encore
  définitif, plusieurs groupes de conversion étant encore en cours de
  finalisation ou de validation au moment de la rédaction de ce fichier.
- Phase 6, Bloc 2 : configuration Cloudflare Pages, workflow CI GitHub
  Actions, fondation d'outillage Node (`package.json`, suite de tests
  Playwright committée dans le dépôt).
- Phase 6, Bloc 3 : analytics respectueux de la vie privée, bandeau de
  consentement, mentions légales, mise à jour de la politique de
  confidentialité.
- Phase 6, Bloc 5 (préparation) : présent fichier, badges du README, mise
  à jour de CONTRIBUTING.md, ajout de CODE_OF_CONDUCT.md et des modèles
  GitHub (issues, pull request). Les chiffres et captures d'écran
  définitifs seront mis à jour une fois la Phase Conversions terminée.
- Phase 6, Bloc 4 : PROMOTION.md (liste de communautés où présenter le
  projet une fois prêt).

## [Phase 4] : Éditeur PDF professionnel

### Ajouté

- Refonte complète de l'outil Modifier PDF en éditeur professionnel :
  détection des blocs de texte existants, édition directe au clic,
  masquage par échantillonnage de couleur de fond, correspondance de
  police (Liberation Sans/Serif/Mono, gras, italique), retour à la ligne
  automatique.
- Ajout de texte neuf, d'images, de formes (rectangle, cercle, flèche,
  trait), masquage, surlignage, soulignement, barré.
- Historique annuler/rétablir illimité, recherche et remplacement dans
  tout le document, zoom, vignettes de navigation, plein écran.
- Gestion des cas difficiles : PDF scanné sans texte (bandeau proposant
  l'OCR), PDF protégé (renvoi vers Déverrouiller PDF), documents longs
  (rendu haute résolution limité à la page courante).
- Mise en avant de l'outil sur la page d'accueil (première position,
  carte double largeur).

### Corrigé

- Granularité d'édition mot par mot et ligne par ligne, et fiabilité du
  double-clic pour la sélection de texte dans l'éditeur.

### Limite documentée

- La correspondance de police est une substitution visuelle proche
  (serif/sans-serif/monospace, gras, italique, taille), pas un clone au
  pixel près de la police d'origine si celle-ci n'est pas standard : un
  problème non résolu même par les éditeurs commerciaux.

## [Phase 3] : Moteur WASM, traitement par lots, outils avancés, international, fiabilité

### Ajouté

- Bloc 1 (moteur WASM) : intégration de qpdf compilé en WebAssembly pour
  un chiffrement AES-256 réel. Protéger PDF et Déverrouiller PDF utilisent
  ce moteur (avec repli automatique sur une méthode plus simple si le
  module ne charge pas). Nouvel outil Réparer PDF.
- Bloc 2 (traitement par lots) : jusqu'à 50 fichiers, file d'attente avec
  pause/reprise/annulation et export ZIP, sur Compresser PDF, Rogner PDF,
  PDF en JPG, Faire pivoter PDF, Numéros de page et Filigrane.
- Bloc 3 (outils avancés) : Aplatir PDF, Métadonnées PDF, Extraire les
  images, PDF en texte (avec repli OCR), Livret PDF (imposition 2 pages
  par feuille).
- Bloc 4 (international) : infrastructure i18n légère, page d'accueil
  disponible en anglais, espagnol, portugais et arabe (support RTL
  complet), sélecteur de langue dans l'en-tête, URLs localisées avec
  hreflang. Traduction limitée à la page d'accueil pour cette itération
  (pas aux pages d'outils individuelles).
- Bloc 5 (fiabilité) : tests avec des PDF difficiles (300 pages, grosses
  images, formulaires AcroForm réels), audits de performance Lighthouse,
  rédaction de BENCHMARK.md.

## [Phase 1 et 2] : Version initiale

### Ajouté

- Lancement de tchadiaPdf avec un socle de 18 outils PDF gratuits
  fonctionnant entièrement dans le navigateur.
- Design system unique du site : uniquement blanc et bleu, composants
  partagés (dropzone, barre de progression, messages, boutons).
- Extension rapide à 24 outils au total (Protéger PDF, Déverrouiller PDF,
  Scanner un document, première version de Modifier PDF, et autres),
  avec mise à jour de la page d'accueil.

---

Pour le détail exhaustif de chaque décision technique, voir
[TODO.md](TODO.md) (suivi bloc par bloc) et [BENCHMARK.md](BENCHMARK.md)
(comparaison honnête avec les principaux concurrents et limites connues).
