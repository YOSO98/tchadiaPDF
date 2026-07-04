# tchadiaPdf

Boîte à outils PDF gratuite, communautaire et open source. Tout le
traitement se fait directement dans le navigateur : aucun fichier n'est
jamais envoyé sur un serveur.

Site 100% statique (HTML/CSS/JS), sans backend, sans base de données.

## Confidentialité par construction

tchadiaPdf s'appuie uniquement sur des bibliothèques JavaScript qui
s'exécutent côté client :

- [pdf-lib](https://pdf-lib.js.org/) pour créer et modifier des documents PDF
- [pdf.js](https://mozilla.github.io/pdf.js/) pour lire et afficher les PDF
- [Tesseract.js](https://tesseract.projectnaptha.com/) pour la reconnaissance de texte (OCR)
- [JSZip](https://stuk.github.io/jszip/) pour regrouper des fichiers en une archive ZIP

Aucune de ces bibliothèques ne communique avec un serveur pour traiter vos
fichiers : tout se passe dans l'onglet de votre navigateur.

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
│   └── <outil>.js          Un fichier JS par outil
├── <outil>.html            Une page dédiée par outil (ex. fusionner.html)
├── TODO.md                 Suivi du développement
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
| Fusionner PDF | Combine plusieurs PDF en un seul document |
| Diviser PDF | Extrait les pages choisies dans un nouveau PDF |
| Faire pivoter PDF | Tourne toutes les pages de 90, 180 ou 270 degrés |
| JPG en PDF | Convertit des images JPG/PNG en document PDF |
| Compresser PDF | Réduit la taille en recompressant les images embarquées |
| Organiser PDF | Réordonne, supprime ou duplique des pages par glisser-déposer |
| Numéros de page | Ajoute une numérotation personnalisable |
| PDF en JPG | Exporte chaque page en image JPG (archive ZIP) |
| Filigrane | Ajoute un filigrane texte ou image sur toutes les pages |
| Rogner PDF | Recadre toutes les pages sur une zone choisie |
| Protéger PDF | Ajoute un mot de passe de chiffrement |
| Déverrouiller PDF | Supprime la protection par mot de passe |
| Signer PDF | Dessine et place une signature manuscrite |
| OCR PDF | Rend un PDF scanné recherchable (français et anglais) |
| Formulaires PDF | Détecte et remplit les champs de formulaire existants |
| Comparer PDF | Affiche deux PDF côte à côte avec leurs différences |

La liste à jour et l'état d'avancement se trouvent dans [TODO.md](TODO.md).

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
