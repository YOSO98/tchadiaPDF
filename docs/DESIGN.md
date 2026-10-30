# tchadiaPdf : système de design v2

Un seul fichier CSS (`css/style.css`), pas de build, pas de framework, police
Inter auto-hébergée. Ce document décrit les principes, les tokens, les
composants (avec le HTML à copier) et les règles d'accessibilité. Les classes
sont celles que les 46 pages et leurs scripts utilisent déjà : on améliore le
rendu, on n'impose jamais une nouvelle structure.

## 1. Principes

1. **Le fichier d'abord.** Sur chaque page, le premier geste possible est de
   déposer un fichier. Tout le reste (options, FAQ, publicité) vient après.
2. **Deux couleurs, une échelle de gris.** Blanc et bleu portent l'identité ;
   les gris neutres portent la structure (fonds, bordures). Aucune autre
   teinte, aucun dégradé, pas de rouge ni de vert : un état se lit par
   l'icône, le texte, l'épaisseur du trait et le contraste.
3. **Un composant existe déjà.** Avant d'écrire du CSS, chercher ici. Une
   page peut ajuster une marge dans son `<style>`, pas redéfinir un bouton.
4. **Rythme 4/8.** Toutes les distances sont des multiples de 4 px, les
   grandes de 8 px. Les tailles de texte viennent de l'échelle fluide.
5. **Rapide et honnête.** Pas d'animation décorative ; les transitions
   durent 120 à 260 ms et disparaissent avec `prefers-reduced-motion`. Les
   libellés disent ce qui va se passer (« Télécharger le PDF », pas « OK »).
6. **Accessible par défaut.** Focus visible de 3 px, cibles de 44 px sur
   mobile, texte 4,5:1 minimum, nom accessible égal au texte visible,
   annonces `aria-live` pour messages et progression.

## 2. Tokens (`:root` de `css/style.css`)

### Couleurs

| Token | Valeur | Usage |
|-------|--------|-------|
| `--blue` | `#2563EB` | action primaire, liens, icônes |
| `--blue-dark` | `#1D4ED8` | survol du primaire, texte bleu sur fond clair |
| `--blue-50` | `#EFF6FF` | fond d'accent (tuile d'icône, survol, badge) |
| `--white` | `#FFFFFF` | fond de page et des composants |
| `--ink` | `#1E293B` | texte principal, états d'erreur (trait 2 px), onglet actif |
| `--slate` | `#475569` | texte secondaire (seul gris autorisé pour du texte) |
| `--gray-50` | `#F8FAFC` | fond de la dropzone, du pied de page, des zones calmes |
| `--gray-100` | `#F1F5F9` | survol neutre, bouton désactivé, touche clavier |
| `--gray-200` | `#E2E8F0` | bordures décoratives (`--border`), piste de progression |
| `--gray-300` | `#CBD5E1` | bordures un peu plus présentes (`--border-strong`) |
| `--gray-500` | `#64748B` | bordure des champs et de la dropzone (`--border-input`, 3:1 garanti), jamais pour du texte |

Les gris sont de la famille slate : ce n'est pas une teinte supplémentaire.
`scripts/check-style-rules.js` refuse toute autre valeur hexadécimale.

### Espacement

`--space-1` 4 px, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 20,
`--space-6` 24, `--space-8` 32, `--space-10` 40, `--space-12` 48, `--space-16` 64.

### Typographie

Inter (400, 500, 600, 700), corps 1 rem / 1,6. Échelle fluide :

| Token | Valeur | Usage |
|-------|--------|-------|
| `--fs-xs` | 0,78 rem | méta, badges, légendes |
| `--fs-sm` | 0,875 rem | libellés, boutons secondaires, texte des cartes |
| `--fs-base` | 1 rem | corps, bouton primaire |
| `--fs-md` | 1,0625 rem | sous-titre de hero, titre de résultat |
| `--fs-lg` | clamp(1,125 rem, 1,05 rem + 0,35 vw, 1,25 rem) | titre de dropzone, h2 de FAQ |
| `--fs-xl` | clamp(1,25 rem, 1,12 rem + 0,6 vw, 1,5 rem) | h2 de section |
| `--fs-2xl` | clamp(1,5 rem, 1,2 rem + 1,4 vw, 2,1 rem) | h1 de page d'outil |
| `--fs-3xl` | clamp(1,9 rem, 1,35 rem + 2,6 vw, 3 rem) | h1 de l'accueil |

Titres : `line-height: 1.2`, `letter-spacing: -0.015em` (jusqu'à -0,03 em sur
le hero), `text-wrap: balance`.

### Rayons, ombres, mouvement

- `--radius-sm` 6 px (puces, petites commandes), `--radius-btn` 8 px (boutons,
  champs, lignes de fichier), `--radius-card` 12 px (cartes, dropzone,
  résultat), `--radius-pill` 999 px (recherche, badges).
- `--shadow-xs`, `--shadow-sm`, `--shadow-md` : ombres encre à 6 à 10 %
  d'opacité, réservées aux éléments qui flottent réellement (menu de
  recherche, bouton flottant, résultat). Partout ailleurs : une bordure.
- `--dur-1` 120 ms (survol), `--dur-2` 180 ms (apparition), `--dur-3` 260 ms
  (progression), `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)`.
- `--focus-ring: 0 0 0 3px rgba(37, 99, 235, 0.35)`, `--tap: 44px`.

## 3. Composants

### Boutons

```html
<button class="btn-primary">Fusionner les PDF</button>
<button class="btn-secondary">Mettre en pause</button>
<button class="btn-ghost">Traiter un autre fichier</button>
<button class="btn-primary btn-sm">Petit</button>
<button class="btn-primary is-loading" aria-busy="true">Conversion</button>
```

- `.btn-primary` : pleine largeur et `margin-top: 24px` par défaut sur une
  page d'outil (une seule action principale par écran). Dans une barre
  d'actions, ajouter `width:auto; margin-top:0` via la classe locale
  existante (`.batch-actions`, `.result`, `.banner-actions` le font déjà).
- `.btn-secondary` : bordure gris 500, texte bleu foncé, survol bleu clair.
- `.btn-ghost` : sans bordure, pour les actions tertiaires.
- Tailles : `.btn-sm` (36 px), défaut (40 px secondaire, 48 px primaire),
  `.btn-lg` (52 px). `.btn-block` force la pleine largeur.
- États : `:hover` (bleu foncé), `:active` (enfoncé de 1 px), `:disabled`
  (gris 100 + slate, curseur interdit), `.is-loading` (libellé masqué, anneau).
- Do : un verbe à l'infinitif et l'objet (« Télécharger le PDF »).
  Don't : deux primaires côte à côte, un primaire pour « Annuler ».

### Dropzone

```html
<div class="dropzone" id="dropzone" role="button" tabindex="0">
  <svg class="dz-icon" viewBox="0 0 24 24" ...>...</svg>
  <strong>Choisir un fichier PDF</strong>
  <span>ou glissez-le ici, 100 Mo maximum</span>
  <input type="file" id="fileInput" accept="application/pdf">
</div>
```

`initDropzone()` (js/common.js) complète automatiquement : nom accessible
égal au texte visible (`aria-labelledby`), puces des formats acceptés
(`.dz-formats`) dérivées de l'attribut `accept`, classe `dragover` pendant le
glisser. États : repos (gris 50, trait gris 500 en pointillés), survol et
glisser (bleu clair, trait plein bleu, anneau), `.is-error` (trait encre 2 px,
à poser par le script de l'outil quand le fichier est refusé, en plus du
message). Do : une phrase d'action en `strong`, une contrainte en `span`.
Don't : plusieurs dropzones empilées, un texte de plus de deux lignes.

### Liste de fichiers et miniatures

```html
<div class="file-list" id="fileList">
  <div class="file-item">
    <span class="f-name">1. contrat.pdf</span>
    <span class="f-meta">1,2 Mo · 12 pages</span>
    <button class="icon-btn" aria-label="Monter">↑</button>
    <button class="icon-btn" aria-label="Retirer">✕</button>
  </div>
</div>
<div class="thumbs-grid">
  <div class="thumb selected"><canvas></canvas><div class="t-num">1</div></div>
</div>
```

Un `.file-item` seul (résumé du fichier chargé) posé directement dans
`.tool-page` reçoit la marge haute de 16 px. `.icon-btn` passe à 44 px sous
640 px ; toujours un `aria-label`. `.thumb.selected` : trait bleu + fond bleu
clair ; le numéro passe en bleu foncé gras.

### Options, segmentés, champs, cases

```html
<div class="options">
  <label for="qualite">Qualité</label>
  <select id="qualite">...</select>
  <div class="seg" role="group" aria-label="Orientation">
    <button type="button" class="active" aria-pressed="true">Portrait</button>
    <button type="button" aria-pressed="false">Paysage</button>
  </div>
  <label class="case-a-cocher"><input type="checkbox"> Ne pas appliquer sur la première page</label>
</div>
```

- Champs (`input` texte, nombre, date, `select`, `textarea`) dans
  `.tool-page` : 40 px de haut, bordure gris 500, rayon 8 px, focus bordure
  bleue + anneau. Une page peut réduire le `padding` pour un rendu compact.
- `.seg button` : 40 px (44 sur mobile), actif bleu plein ; relier le groupe
  à son libellé avec `aria-labelledby` ou `aria-label`, refléter l'état avec
  `aria-pressed`.
- Cases et radios : 18 px, `accent-color` bleu, libellé cliquable englobant.
- Do : libellé au-dessus ou à gauche, en 600, suivi de deux-points si la
  page l'a déjà. Don't : placeholder en guise de libellé.

### Progression

```html
<div class="progress-wrap" id="progress">
  <div class="progress-label">Conversion en cours</div>
  <div class="progress-bar"><div></div></div>
</div>
```

`setProgress(pct, libellé)` affiche le pourcentage à droite du libellé
(`.progress-pct`), pose `role="progressbar"` et `aria-valuenow`, et annonce
le libellé (`aria-live="polite"`). Pour un traitement sans mesure, ajouter
`indeterminate` sur `.progress-bar` (bande animée, statique en mouvement
réduit) ; préférer toujours une progression réelle.

### Carte de résultat

```html
<div class="result" id="result">
  <p>Votre PDF fusionné est prêt.</p>
  <a class="btn-primary" href="#">Télécharger le PDF</a>
</div>
```

`offerDownload()` ajoute la coche, le résumé `nom.pdf · 1,2 Mo`
(`.result-summary`), l'action secondaire « Traiter un autre fichier »
(`.result-actions`), puis les lignes de soutien. Ordre imposé : téléchargement
d'abord, actions secondaires ensuite, résumé entre le titre et le bouton. Le
focus est déplacé sur le bouton de téléchargement.

### Messages

```js
showMsg("Fichier ajouté.");                 // info : icône i, trait 1 px
showWarning("Fichier volumineux, patience.");// avertissement : triangle, fond gris 50
showError("PDF protégé par mot de passe.", { retry, suggestionHref, suggestionText }); // erreur : trait encre 2 px, role=alert
```

Jamais de rouge ni de vert. `.msg-actions` accueille un `.btn-secondary`
« Réessayer » et un lien d'outil alternatif. Un message remplace le précédent :
une seule zone `#msg` par page.

### Encadré de fidélité, FAQ, bandeau

```html
<div class="fidelity-box"><h3>Fidélité de conversion</h3><p>...</p></div>
<section class="faq"><h2>Questions fréquentes</h2><details><summary>Question ?</summary><p>Réponse.</p></details></section>
<div class="banner visible">Texte <div class="banner-actions"><button class="btn-primary">Oui</button></div></div>
```

Le titre de l'encadré devrait être un `h2` si la page n'a pas de `h2` avant
lui (ordre des titres). La FAQ est une liste à filets avec chevron rotatif ;
`summary` fait 52 px minimum.

### Cartes d'outils, sections de l'accueil

```html
<a class="tool-card" href="/fusionner" data-category="organiser" data-popular>
  <svg class="tool-icon" viewBox="0 0 24 24" ...>...</svg>
  <h3>Fusionner PDF</h3>
  <p>Combinez plusieurs fichiers PDF en un seul.</p>
</a>
```

`data-category` : `modifier`, `convertir`, `organiser`, `securite`,
`extraire` ; `data-popular` pour l'onglet par défaut. Sections :
`.home-section` + `.section-head` (titre + lien), `.category-tabs`
(`aria-pressed`), `.trust-grid > .trust-item`, `.compare-table` (avec
`data-label` sur les cellules pour la version mobile en liste).

### En-tête, pied, lien d'évitement, bandeau de consentement

Générés par `node scripts/appliquer-gabarit.js` : ne pas les éditer à la main
dans une page, modifier le script puis le relancer. L'en-tête porte le logo,
le formulaire `.header-search` (GET `/?q=`, repris par l'accueil), la
navigation nommée et le lien GitHub ; le pied porte le bloc `.footer-privacy`
(« Confidentialité : 0 octet envoyé »), la navigation nommée et
`.footer-legal`. Le bandeau de consentement (`.consent-banner`) utilise
`.btn-primary` / `.btn-secondary` avec 44 px de hauteur.

## 4. Do / Don't

- Do : un seul `h1`, puis des `h2` de section ; `h3` dans les cartes et les
  encadrés seulement s'il y a un `h2` avant.
- Do : écrire les textes en français, sans tiret long ni demi-cadratin ;
  les deux-points, la virgule et le point suffisent.
- Do : annoncer les changements d'état (`role="status"`, `aria-live`) plutôt
  que compter sur la couleur.
- Don't : ajouter une couleur, un dégradé, une ombre colorée, une police.
- Don't : redéfinir `.btn-primary`, `.dropzone`, `.msg` dans un `<style>` de
  page ; ajuster une marge locale est acceptable, changer le composant non.
- Don't : `style=""` en ligne pour masquer ou afficher (préférer `hidden` ou
  une classe `.visible` existante).

## 5. Check-list d'accessibilité (à vérifier avant de livrer une page)

1. Tabulation du haut en bas : ordre logique, lien d'évitement en premier,
   focus visible (anneau 3 px) sur chaque commande, aucun piège.
2. Dropzone activable à Entrée et Espace, nom accessible égal au texte
   visible (automatique via `initDropzone`).
3. Chaque champ a un `label` relié (`for`/`id`) ; chaque bouton icône un
   `aria-label` ; chaque `nav` un `aria-label` distinct.
4. Messages par `showMsg` / `showWarning` / `showError` (rôles ARIA posés) ;
   progression par `setProgress` ; résultat par `offerDownload`.
5. Contrastes : texte sur `--slate` ou `--ink` uniquement ; bleu `#2563EB`
   pour du texte seulement sur blanc ou gris 50 (5,17:1 et 4,94:1).
6. Cibles tactiles de 44 px sous 640 px (`.icon-btn`, `.seg button`,
   boutons secondaires y passent automatiquement).
7. Pas d'information portée par la couleur seule : icône + texte + trait.
8. Vérifier avec `prefers-reduced-motion: reduce` (aucune animation) et au
   zoom 200 % (rien de coupé, options empilées sous 520 px).
9. Lancer `node scripts/audit-design.js /tmp/audit` : zéro violation axe
   sérieuse ou critique sur la page.
10. `npm run check-style` et `TCHADIA_TEST_PORT=... npx playwright test` verts.
