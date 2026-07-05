# tchadiaPdf

Boîte à outils PDF gratuite, communautaire et open source. Tout le
traitement se fait directement dans le navigateur : aucun fichier n'est
jamais envoyé sur un serveur.

Site 100% statique (HTML/CSS/JS), sans backend, sans base de données.

## Modifier PDF : l'éditeur phare

L'outil [Modifier PDF](modifier-pdf.html) est le plus abouti du site : il
permet de modifier le **texte déjà présent** dans un PDF (pas seulement
d'ajouter des annotations par-dessus), ce que la plupart des concurrents
réservent à leurs offres payantes.

- Détection des blocs de texte existants (via pdf.js), édition directe au clic
- Masquage de l'ancien texte par échantillonnage réel de la couleur de fond
- Correspondance de police (serif / sans-serif / monospace, gras, italique)
  avec les polices libres Liberation Sans/Serif/Mono (SIL OFL, métriques
  compatibles Arial/Times New Roman/Courier New), embarquées en sous-ensembles
- Retour à la ligne automatique si le texte modifié est plus long
- Ajout de texte neuf, d'images, de formes (rectangle, cercle, flèche, trait),
  masquage, surlignage, souligné, barré
- Historique annuler/rétablir illimité, recherche et remplacement dans tout
  le document, zoom, vignettes de navigation, plein écran

Limite assumée : la correspondance de police est une substitution visuelle
proche, pas un clone au pixel près de la police d'origine (un problème non
résolu même par les éditeurs commerciaux pour du texte en police non
standard).

## Confidentialité par construction

tchadiaPdf s'appuie uniquement sur des bibliothèques qui s'exécutent
côté client, ou sur des fichiers statiques servis par un CDN :

- [pdf-lib](https://pdf-lib.js.org/) pour créer et modifier des documents PDF
- [pdf.js](https://mozilla.github.io/pdf.js/) pour lire et afficher les PDF
- [qpdf](https://qpdf.readthedocs.io/) compilé en WebAssembly ([qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm)) pour le chiffrement AES-256 et la réparation de PDF
- [Tesseract.js](https://tesseract.projectnaptha.com/) pour la reconnaissance de texte (OCR)
- [JSZip](https://stuk.github.io/jszip/) pour regrouper des fichiers en une archive ZIP
- [Liberation Fonts](https://github.com/liberationfonts/liberation-fonts) (SIL OFL) + [fontkit](https://github.com/Hopding/fontkit) pour la correspondance de police dans l'éditeur

Aucune de ces bibliothèques ne communique avec un serveur pour traiter vos
fichiers : tout se passe dans l'onglet de votre navigateur. Les modules les
plus volumineux (qpdf, polices) ne sont téléchargés qu'au moment où vous
utilisez réellement la fonctionnalité correspondante (chargement paresseux).

## Structure du projet

```
tchadiapdf/
├── index.html              Page d'accueil, liste des outils
├── a-propos.html           Page « À propos »
├── confidentialite.html    Politique de confidentialité
├── css/
│   └── style.css           Design system unique (blanc + bleu)
├── js/
│   ├── common.js           Utilitaires partagés (dropzone, progression, téléchargement…)
│   ├── pdf-crypt.js        Chiffrement PDF RC4 128 bits (repli si qpdf-wasm indisponible)
│   ├── qpdf-engine.js       Chargement paresseux de qpdf (WebAssembly)
│   ├── compresser-pdf.worker.js   Web Worker dédié à la recompression d'images
│   └── <outil>.js          Un fichier JS par outil
├── <outil>.html            Une page dédiée par outil (ex. fusionner.html)
├── TODO.md                 Suivi du développement
├── BENCHMARK.md            Comparaison honnête avec les principaux concurrents
├── LICENSE                 Licence MIT
└── CONTRIBUTING.md         Guide de contribution
```

Chaque outil suit le même schéma : une page HTML dédiée (bonne pour le
référencement) et un fichier JavaScript associé, qui réutilise les
fonctions communes de `js/common.js` (zone de glisser-déposer, barre de
progression, message d'erreur, téléchargement du résultat).

## Outils disponibles

| Outil | Description |
|---|---|
| Modifier PDF | Modifie le texte existant, ajoute texte/images/formes/annotations |
| Fusionner PDF | Combine plusieurs PDF en un seul document |
| Compresser PDF | Réduit la taille en recompressant les images embarquées |
| Diviser PDF | Extrait les pages choisies dans un nouveau PDF |
| JPG en PDF | Convertit des images JPG/PNG en document PDF |
| PDF en JPG | Exporte chaque page en image JPG (archive ZIP) |
| Faire pivoter PDF | Tourne toutes les pages de 90, 180 ou 270 degrés |
| Organiser PDF | Réordonne, supprime ou duplique des pages par glisser-déposer |
| Numéros de page | Ajoute une numérotation personnalisable |
| Filigrane | Ajoute un filigrane texte ou image sur toutes les pages |
| Rogner PDF | Recadre toutes les pages sur une zone choisie |
| Protéger PDF | Chiffrement AES-256 réel par mot de passe (qpdf) |
| Réparer PDF | Reconstruit la structure d'un PDF endommagé (qpdf) |
| Déverrouiller PDF | Supprime la protection par mot de passe (qpdf) |
| Signer PDF | Dessine et place une signature manuscrite |
| OCR PDF | Rend un PDF scanné recherchable (français et anglais) |
| Formulaires PDF | Détecte et remplit les champs de formulaire existants |
| Comparer PDF | Affiche deux PDF côte à côte avec leurs différences |
| Scanner un document | Transforme une photo en PDF avec correction de perspective |
| Aplatir PDF | Fige les champs de formulaire dans la page |
| Métadonnées PDF | Consulte et modifie titre, auteur, mots-clés |
| PDF en texte | Extrait le texte, avec repli OCR si nécessaire |
| Livret PDF | Imposition 2 pages par feuille pour impression en livret |
| Extraire les images | Récupère toutes les images embarquées d'un PDF (ZIP) |

Compresser PDF, Rogner PDF, PDF en JPG, Faire pivoter PDF, Numéros de page
et Filigrane acceptent aussi un traitement par lots (jusqu'à 50 fichiers,
file d'attente avec pause/reprise, export ZIP).

Le détail des choix techniques et le journal des vérifications se trouvent
dans [TODO.md](TODO.md) ; une comparaison honnête avec les principaux
concurrents (qualité, vitesse, limites) est dans [BENCHMARK.md](BENCHMARK.md).

## Langues

Le site est en français par défaut. La page d'accueil est aussi disponible
en [anglais](en/index.html), [espagnol](es/index.html),
[portugais](pt/index.html) et [arabe](ar/index.html) (avec mise en page
adaptée de droite à gauche). Les pages d'outils elles-mêmes restent en
français pour le moment ; traduire un outil est une bonne première
contribution, voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Lancer le projet en local

Le site est statique, aucune installation n'est nécessaire. Un simple
serveur HTTP local suffit (nécessaire pour que les Web Workers et les
imports fonctionnent correctement, un simple double-clic sur les fichiers
ne suffit pas).

Avec Python :

```bash
python -m http.server 8080
```

Avec Node.js :

```bash
npx http-server -p 8080
```

Puis ouvrez `http://localhost:8080` dans votre navigateur.

## Déployer sur Cloudflare Pages

1. Poussez le dépôt sur GitHub (ou GitLab).
2. Sur [Cloudflare Pages](https://pages.cloudflare.com/), créez un nouveau
   projet et connectez le dépôt.
3. Configuration de build :
   - Commande de build : aucune (laisser vide)
   - Répertoire de sortie : `/` (racine du dépôt)
4. Déployez. Le site étant 100% statique, aucune variable d'environnement
   n'est nécessaire.

Toute mise à jour poussée sur la branche principale est redéployée
automatiquement.

## Contribuer

Les contributions sont les bienvenues. Consultez
[CONTRIBUTING.md](CONTRIBUTING.md) pour les règles du design system et la
marche à suivre pour proposer un nouvel outil.

## Licence

Projet distribué sous licence [MIT](LICENSE).
