# PROGRESS : session nocturne autonome

## PHASE 0 : découverte

**Stack** : site 100% statique (HTML/CSS/JS vanilla, aucun framework, aucune
étape de build). Chaque outil = une page HTML à la racine + un fichier JS
dédié dans `js/`, qui réutilisent `js/common.js` (`initDropzone`,
`setProgress`/`hideProgress`, `showMsg`/`hideMsg`, `offerDownload`,
`fmtSize`, `readAsArrayBuffer`, `renderPdfPage`). Bibliothèques PDF déjà en
place : `pdf-lib` (lecture/écriture), `pdf.js` (rendu de miniatures et
extraction de texte), chargées via CDN avec intégrité SRI. Design system
strict : uniquement blanc/bleu (variables CSS dans `css/style.css`),
français, jamais de tiret cadratin/demi-cadratin. Outillage de dev :
`package.json` (devDependencies uniquement, pas de build du site),
`npm test` = suite Playwright dans `tests/`, `npm run check-style` = lint
maison (tirets + palette de couleurs). Conventions confirmées en lisant
plusieurs outils existants (`fusionner.html`/`js/fusionner.js`,
`compresser-pdf.html`/`js/compresser-pdf.js`) avant de toucher au code.

**Découverte majeure, avant tout code** : les 5 fonctionnalités demandées
dans la mission (organiseur de pages, filigrane, numérotation, formulaires,
métadonnées) **existent déjà** dans le dépôt (`organiser-pdf.html`,
`filigrane.html`, `numeros-de-pages.html`, `formulaires-pdf.html`,
`metadonnees-pdf.html`), de même que le bonus (`scanner-pdf.html`,
redressement de perspective 4 coins + contraste + noir/blanc déjà présents).
Conformément à la règle "choisis la plus simple et la plus cohérente",
plutôt que de reconstruire ces outils depuis zéro (risque de doublons, de
régression, et travail inutile), j'ai comparé chaque outil existant au
cahier des charges point par point et je complète uniquement les écarts
réels trouvés. Détail ci-dessous.

## Comparaison cahier des charges vs existant

| Fonctionnalité | Demandé | Déjà présent | Écart réel trouvé |
|---|---|---|---|
| Organiseur de pages | grille miniatures, glisser-déposer, dupliquer, supprimer, pivoter | grille + glisser-déposer + dupliquer + supprimer + monter/descendre | **Pivoter une page : absent** |
| Filigrane | texte, opacité, taille, couleur, diagonale/horizontal, aperçu direct | type texte/image, opacité, taille (3 tailles), position (5 zones) | **Couleur : fixe (non réglable). Orientation : diagonale imposée (pas de choix horizontal). Aperçu en direct : absent** |
| Numérotation | position, format | position (grille 6 zones), format (1 / 1 sur n / Page 1) | Aucun, déjà complet |
| Formulaires PDF | détection AcroForm, formulaire web, génération + option aplatir | détection de champs (texte/case/radio/liste), formulaire web, génération | **Option "aplatir" après remplissage : absente** (l'outil `aplatir-pdf.html` existe séparément mais rien ne relie les deux) |
| Métadonnées | affichage complet, tout supprimer, suppression sélective, message confidentialité | Titre/Auteur/Sujet/Mots-clés/Créateur/Producteur/Date, champs éditables un par un | **Bouton "Tout supprimer" : absent. Message de réassurance confidentialité inline : absent** (seul un lien de pied de page générique existe) |
| Bonus scanner | perspective, contraste, N&B | redressement 4 coins (homographie), filtre contraste, filtre N&B | Aucun, déjà complet (seule l'auto-détection des bords, hors périmètre demandé, reste manuelle, déjà documenté comme limite connue dans BENCHMARK.md) |

## Ordre de traitement retenu

1. [x] Organiser PDF : ajouter la rotation par page
2. [x] Filigrane : couleur réglable + orientation diagonale/horizontale + aperçu en direct
3. [x] Formulaires PDF : option d'aplatissement après remplissage
4. [ ] Métadonnées : bouton "Tout supprimer" + message de confidentialité inline
5. [ ] Bonus scanner : vérifié déjà complet, aucun développement nécessaire

## Journal

**Organiser PDF, rotation par page** : ajout d'un champ `rotation` (0/90/
180/270) par entrée de `order`, d'un bouton "Pivoter" (⟳) dans les
actions de chaque miniature, d'un aperçu CSS en direct (`transform:
rotate(...) scale(0.75)` pour 90/270, repris du même motif déjà utilisé
dans `js/pivoter.js` pour rester cohérent avec l'existant), et de
l'application réelle au moment de la génération via
`page.setRotation(degrees((rotationExistante + rotationChoisie) % 360))`
dans pdf-lib (la rotation existante de la page source est préservée,
la nouvelle s'ajoute par-dessus). La duplication d'une page copie sa
rotation. Testé de bout en bout (Playwright, hors suite committee) :
3 clics = 270°, confirmé dans le PDF de sortie via une relecture
pdf-lib du fichier téléchargé. `npm run check-style` et `npm test`
(9/9) toujours au vert.

**Filigrane, couleur + orientation + aperçu en direct** : ajout d'un
sélecteur de couleur (`<input type="color">`, converti en RGB normalisé
pour pdf-lib) et d'un choix d'orientation diagonale/horizontale
(auparavant imposée : diagonale seulement en position centre, horizontale
seulement dans les coins). Les deux réglages sont désormais indépendants
de la position choisie. Ajout d'un aperçu en direct sous forme de canvas
(page fictive à l'échelle réelle du PDF chargé une fois connu, sinon
ratio A4 par défaut), mis à jour à chaque changement de texte, taille,
couleur, opacité, position, orientation ou image de filigrane ; pour le
filigrane image, l'aperçu charge l'image réelle dans un `<img>` en
mémoire (blob URL) plutôt qu'un placeholder générique. Mode lot et mode
fichier unique appliquent la même couleur/orientation choisie. Testé de
bout en bout (Playwright, hors suite committee) : changement de couleur/
orientation/position, aperçu non vide confirmé par lecture des pixels du
canvas, génération réussie sans erreur console. `npm run check-style` et
`npm test` (9/9) toujours au vert.

**Formulaires PDF, option d'aplatissement** : ajout d'une case à cocher
"Aplatir le formulaire après remplissage" (repliée tant qu'aucun champ
n'est détecté), qui appelle `form.flatten()` juste avant `pdfDoc.save()`
si cochée, avec la même gestion d'avertissement (aplatissement partiel
non bloquant) déjà utilisée dans `js/aplatir-pdf.js`, pour rester cohérent
avec l'existant plutôt que d'inventer un nouveau comportement. Testé de
bout en bout (Playwright, hors suite committee) avec un PDF généré à la
volée (champ texte AcroForm) : sans la case cochée, le champ reste
présent et modifiable avec la valeur saisie ; avec la case cochée, le
formulaire de sortie ne contient plus aucun champ (aplati). `npm run
check-style` et `npm test` (9/9) toujours au vert.
