# Contribuer à tchadiaPdf

Merci de votre intérêt pour tchadiaPdf. Ce projet est communautaire et
open source (licence MIT) : toute contribution est bienvenue, qu'il
s'agisse d'un nouvel outil, d'une correction de bug ou d'une amélioration
de la documentation.

## Principe fondateur

Aucun fichier de l'utilisateur ne doit jamais quitter son navigateur.
Toute contribution qui enverrait un fichier PDF ou une image vers un
serveur, une API tierce ou un service d'analyse sera refusée. Le
traitement doit être fait uniquement avec des bibliothèques exécutées
côté client (pdf-lib, pdf.js, Tesseract.js, JSZip).

## Règles du design system

Le design de tchadiaPdf est volontairement minimal et doit rester
cohérent d'un outil à l'autre.

1. **Deux couleurs seulement** : blanc (`#FFFFFF`) et bleu (`#2563EB`,
   avec sa variante foncée `#1D4ED8` pour les survols et sa variante
   très claire `#EFF6FF` pour les fonds). Texte en `#1E293B` (encre) ou
   `#64748B` (gris atténué). Aucune autre couleur, aucun dégradé. Les
   messages d'erreur ou d'information n'utilisent jamais de rouge ou de
   vert : une icône et un texte suffisent (voir la classe `.msg` dans
   `css/style.css`).
2. **Un composant existe déjà probablement.** Avant d'ajouter du CSS,
   vérifiez `css/style.css` : dropzone, liste de fichiers, miniatures,
   options, boutons segmentés, boutons primaires/secondaires, barre de
   progression, résultat, message, emplacement publicitaire. Réutilisez
   ces classes plutôt que d'en créer de nouvelles.
3. **Typographie** : jamais de tiret cadratin (Unicode U+2014) ni de tiret
   demi-cadratin (Unicode U+2013) dans les textes, titres ou messages.
   Utilisez les deux-points, la virgule ou le point selon le contexte.
4. **Tout est en français** : interface, messages d'erreur, commentaires
   de code.

## Proposer un nouvel outil

Chaque outil suit exactement la même structure que `fusionner.html` /
`js/fusionner.js`. Pour ajouter un outil `mon-outil` :

1. **Créez `mon-outil.html`** à la racine, en copiant la structure d'une
   page existante :
   - `<head>` avec titre et méta-description en français (utile pour le
     référencement), sans tiret long
   - en-tête (`site-header`) et pied de page (`site-footer`) identiques
     aux autres pages
   - `<main class="tool-page">` contenant : un `<h1>`, un sous-titre
     (`.tool-sub`), une dropzone (`.dropzone` avec `role="button"` et
     `tabindex="0"` pour l'accessibilité clavier), les options propres à
     l'outil (`.options`, `.seg`, miniatures `.thumbs-grid`…), une zone
     de message (`.msg`), le bouton d'action (`.btn-primary`), la barre
     de progression (`.progress-wrap`), le résultat (`.result`) et un
     emplacement publicitaire (`.ad-slot`)
   - chargement de `js/common.js` puis de `js/mon-outil.js`, après les
     bibliothèques CDN nécessaires (pdf-lib, pdf.js, JSZip…)

2. **Créez `js/mon-outil.js`**, en réutilisant les fonctions de
   `js/common.js` : `initDropzone`, `setProgress`/`hideProgress`,
   `showMsg`/`hideMsg`, `offerDownload`, `fmtSize`, `readAsArrayBuffer`,
   `renderPdfPage`.

3. **Gérez les erreurs systématiquement** : fichier protégé par mot de
   passe, PDF corrompu, mauvais format de fichier, fichier trop volumineux.
   Chaque cas doit afficher un message clair via `showMsg()`, jamais une
   erreur JavaScript brute dans la console sans retour utilisateur.

4. **Traitements lourds dans un Web Worker.** Si l'outil fait de l'OCR,
   de la compression ou tout traitement long, déportez-le dans un Web
   Worker, affichez la progression réelle (pas une barre indéterminée) et
   proposez un bouton Annuler.

5. **Ajoutez la carte sur `index.html`** dans `.tools-grid`, en retirant
   la classe `soon` si une carte existait déjà en « bientôt disponible ».

6. **Vérifiez avant de proposer votre contribution** :
   - le responsive mobile (la grille et les options s'empilent
     correctement sous 520px)
   - la navigation au clavier (tabulation, entrée/espace sur la
     dropzone, focus visible)
   - qu'aucun des autres outils n'est cassé
   - qu'aucun tiret long ou moyen n'a été introduit
   - mettez à jour `README.md` (tableau des outils) et `TODO.md`

## Proposer un nouvel outil de conversion

Les outils de conversion (ex. Word en PDF, HEIC en JPG) suivent les mêmes
règles que ci-dessus, avec quelques ajouts propres à cette famille d'outils :

1. **Encadré « Fidélité de conversion »** (classe `.fidelity-box` dans
   `css/style.css`) : expliquez honnêtement ce qui est préservé et ce qui ne
   l'est pas (mise en forme complexe, polices non standard, animations,
   macros, etc.). N'affirmez jamais une fidélité parfaite si elle n'a pas été
   vérifiée sur des fichiers réels.
2. **FAQ SEO** (classe `.faq`, accordéon `<details>/<summary>`) : quelques
   questions/réponses courtes du type « Comment convertir X en Y
   gratuitement ? ».
3. **Traitement par lots** : jusqu'à 20 fichiers, export ZIP, cohérent avec
   les autres outils de conversion.
4. **Bibliothèque côté client uniquement** : toute nouvelle dépendance doit
   s'exécuter entièrement dans le navigateur (ex. mammoth.js, SheetJS,
   pptxgenjs, heic2any, UTIF.js, marked.js). Aucun appel à un service de
   conversion distant.
5. **Ajoutez l'outil à la page pivot** `conversions.html` (matrice des
   conversions disponibles) en plus de la carte sur `index.html`.
6. **Testez avec un vrai fichier généré** dans le format source (par exemple
   un DOCX contenant un tableau et une image, pas seulement un fichier
   texte trivial), puis rouvrez le fichier converti pour vérifier son
   contenu, pas seulement son apparence.

## Lancer les tests

Une suite de tests [Playwright](https://playwright.dev/) est prévue dans le
dépôt (répertoire `tests/`, une fois `package.json` en place). Une fois ces
fichiers présents, installez les dépendances puis lancez la suite complète :

```bash
npm install
npx playwright test
```

Si `package.json`/`tests/` ne sont pas encore présents au moment de votre
contribution, testez au minimum manuellement dans un navigateur (voir la
liste de vérifications de la section précédente) et décrivez vos tests
manuels dans votre pull request.

## Style de code

- JavaScript vanille, sans framework ni bundler.
- Pas de build step : les fichiers sont servis tels quels.
- Commentaires en français, uniquement quand ils expliquent un choix non
  évident (pas de commentaire qui répète ce que le code dit déjà).

## Signaler un bug

Ouvrez une issue avec le modèle « Rapport de bug » (`.github/ISSUE_TEMPLATE`)
en décrivant le comportement attendu, le comportement observé, le
navigateur utilisé et si possible un fichier PDF permettant de reproduire
le problème (en vous assurant qu'il ne contient aucune donnée
personnelle). Pour proposer une idée d'outil ou d'amélioration, utilisez le
modèle « Suggestion de fonctionnalité ».

## Code de conduite

Ce projet suit un [Code de conduite](CODE_OF_CONDUCT.md) inspiré du
Contributor Covenant. En participant, vous acceptez de le respecter.
