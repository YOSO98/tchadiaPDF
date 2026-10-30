# Audit design et expérience utilisateur : tchadiaPdf

Date : 30 octobre 2026. Périmètre : accueil (5 langues), pages d'outils (46),
éditeur Modifier PDF (revue seule, sans code). Références de niveau visées par
le propriétaire : Linear, Stripe, Apple, Figma, Notion pour la clarté, le
rythme et la finition ; plus simple et plus rapide qu'Acrobat en ligne,
Smallpdf et iLovePDF.

## 1. Méthode

- Captures Playwright (Chromium, sans option) en 1280 px et 390 px, servies
  par `npx http-server -p 8961 -a 127.0.0.1 -e html --silent .`, avec un PDF
  de test chargé là où c'est pertinent : `node scripts/audit-design.js
  <dossier>`.
- Contrôle automatisé d'accessibilité avec `@axe-core/playwright`
  (devDependency ajoutée), règles WCAG 2.0/2.1/2.2 A et AA + bonnes
  pratiques. Résultats bruts : `docs/design-audit/axe-avant.json` et
  `axe-apres.json`.
- Contrastes calculés (formule WCAG, voir section 5).
- Relevé heuristique (Nielsen + grille interne : hiérarchie, densité,
  cohérence, affordance, états, mobile, accessibilité).

Captures avant/après (10 fichiers, `docs/design-audit/*-avant-apres.png`) :
accueil, pdf-en-word, caviarder-pdf, numeros-de-pages, modifier-pdf, chacun
en 1280 px et 390 px. Les pages longues sont tronquées à 2600 px (1280) et
3200 px (390).

## 2. Constats « avant » (priorité P1 bloquant, P2 important, P3 finition ; effort S/M/L)

| # | Constat | Heuristique | Prio | Effort | Statut |
|---|---------|-------------|------|--------|--------|
| 1 | Accueil : la promesse « déposez un fichier, on choisit l'outil » est une pilule de 44 px en pointillés gris, subordonnée à la recherche ; l'affordance de dépôt est quasi nulle | Hiérarchie, affordance | P1 | M | Corrigé : zone de dépôt pleine largeur en premier, recherche ensuite |
| 2 | Accueil : 8 cartes « populaires » puis 44 cartes « tous » dupliquent les outils (doublons dans la recherche aussi : « Fusionner PDF » deux fois) ; page de 3 439 px en 390 px avant le pied | Densité, cohérence | P1 | M | Corrigé : une grille, onglet « Populaires » par défaut, dédoublonnage dans `index-page.js` |
| 3 | Accueil : aucune section de confiance ni de comparaison avec les suites payantes ; l'argument « 0 octet envoyé » n'apparaît qu'en badge | Persuasion, confiance | P1 | M | Corrigé : sections « Pourquoi tchadiaPdf » et « Ce qu'Acrobat fait payer, ici gratuit » |
| 4 | Accueils en/es/pt/ar : structure différente du français (25 cartes, pas de recherche, pas de dépôt, pied sans « Gérer les publicités ») | Cohérence | P2 | M | Corrigé : même structure, 45 cartes traduites |
| 5 | En-tête : un seul lien « Tous les outils », pas de recherche hors accueil, pas de lien vers le code source ; `nav` sans nom (axe `landmark-unique`) | Navigation | P2 | S | Corrigé par le gabarit (recherche `/?q=`, GitHub, `aria-label`) |
| 6 | Pied de page : contenu centré en vrac, texte « 0 octet » absent, variantes différentes entre pages (securite.html, 404.html, en/) | Cohérence | P2 | S | Corrigé par le gabarit (bloc confidentialité, nav nommée, mentions) |
| 7 | Aucun lien d'évitement ; `main` sans id ; hero de l'accueil hors de tout landmark (axe `region`) | Accessibilité | P1 | S | Corrigé par le gabarit |
| 8 | Dropzone : bordure bleue en pointillés sur fond blanc, pas d'état d'erreur, formats acceptés non annoncés ; `aria-label` différent du texte visible (axe `label-content-name-mismatch`, 4 pages sur 4) | Affordance, accessibilité | P1 | S | Corrigé (CSS + `decorateDropzone` dans common.js) |
| 9 | Messages `.msg` : un glyphe texte « ⓘ » / « ⚠ », pas de rôle ARIA, pas de distinction visuelle info/erreur | États | P1 | S | Corrigé : icône SVG, `role=status/alert`, bordure 1 px (info) ou 2 px encre (erreur) |
| 10 | Progression : pas de pourcentage, pas de `role=progressbar`, libellé non annoncé | États, accessibilité | P2 | S | Corrigé dans `setProgress` |
| 11 | Résultat : titre + bouton seulement, pas de résumé (nom, taille), pas d'action secondaire, fond bleu clair qui concurrence le bouton | États | P2 | S | Corrigé : coche, résumé, « Traiter un autre fichier », fond blanc |
| 12 | Bouton primaire désactivé à 40 % d'opacité : illisible sur fond blanc (texte blanc transparent) | Lisibilité | P2 | S | Corrigé : fond gris-100, texte slate (6,92:1) |
| 13 | Bouton de soutien flottant (130 px) recouvre les cartes à 1280 px et les options à 390 px | Densité | P2 | S | Corrigé : pastille 48 px, libellé visible seulement au-dessus de 1440 px |
| 14 | Icônes des cartes de conversion : la même icône pour 13 outils « X en PDF » ; taille 42 px sans fond, poids visuel inégal | Cohérence | P3 | M | Partiel : tuile 44 px uniforme ; jeu d'icônes distinct par outil à dessiner (voir limites) |
| 15 | FAQ : « + » textuel en préfixe, boîtes bordées empilées ; cible < 44 px | Finition, mobile | P3 | S | Corrigé : liste à filets, chevron rotatif, cible 52 px |
| 16 | Encadré de fidélité en bleu plein qui pèse autant que le bouton d'action ; titre `h3` sans `h2` (axe `heading-order`) | Hiérarchie | P3 | S | Partiel : encadré blanc à filet bleu ; le `h3` est dans le corps des pages (hors périmètre, à passer en `h2` par les équipes outils) |
| 17 | Liens dans les paragraphes distingués par la couleur seule (axe `link-in-text-block`, caviarder-pdf) | Accessibilité | P2 | S | Corrigé : soulignement des liens de texte courant |
| 18 | Champ de recherche de l'accueil : `aria-expanded` sur un `input` sans rôle combobox (axe `aria-allowed-attr`, critique) | Accessibilité | P1 | S | Corrigé : `role="combobox"` |
| 19 | Cibles tactiles : `.icon-btn` 32 px, `.seg button` 34 px, `.category-tabs` ok | Mobile | P2 | S | Corrigé : 44 px sous 640 px |
| 20 | Emplacement publicitaire (boîte vide de 90 px en pointillés) placé juste sous le hero : casse le rythme avant le premier contenu utile | Rythme | P3 | S | Déplacé après la grille d'outils sur l'accueil (réversible par l'équipe publicité) ; inchangé sur les pages d'outils |
| 21 | Éditeur : zone d'édition sous la ligne de flottaison en 1280 × 800 et en 390 px, même PDF chargé | Hiérarchie | P1 | M | Non corrigé (autre chantier) : voir section 6 |
| 22 | Pas de `prefers-reduced-motion` sur `scroll-behavior` ni sur `scrollIntoView` | Accessibilité | P3 | S | Corrigé |

## 3. Résultats axe-core (1280 px, 5 pages)

| Page | Avant | Après |
|------|-------|-------|
| accueil | 4 (1 critique `aria-allowed-attr`, 1 sérieux `label-content-name-mismatch`, `landmark-unique`, `region` × 4) | 1 (`region` sur le bouton flottant, bonne pratique) |
| pdf-en-word | 4 | 2 (`heading-order` dans le corps, `region`) |
| caviarder-pdf | 4 (dont `link-in-text-block`) | 1 (`region`) |
| numeros-de-pages | 3 | 1 (`region`) |
| modifier-pdf | 4 | 2 (`heading-order` dans le corps, `region`) |

Résidu : `region` vient du bouton de soutien injecté par `js/support-fab.js`
hors de tout landmark (bonne pratique axe, pas un critère WCAG) ; correction
d'une ligne dans ce script (`role="complementary"` sur un conteneur) à faire
par son propriétaire. `heading-order` : `h3` « Fidélité de conversion » et
« Styles de texte » à passer en `h2` dans le corps des pages.

## 4. Ce qui a changé pour l'utilisateur

- Accueil : il dépose un fichier en premier geste, ou cherche, ou filtre ;
  il voit pourquoi faire confiance au site et ce qu'il gagne par rapport à
  Acrobat ; la page est deux fois plus courte sur mobile.
- Toutes les pages : recherche d'outil depuis l'en-tête, lien d'évitement,
  pied de page lisible avec la garantie « 0 octet envoyé », bouton de
  soutien discret.
- Pages d'outils : dropzone qui ressemble à une zone de dépôt (fond, trait,
  icône, formats acceptés), messages et progression compréhensibles,
  résultat avec le nom et la taille du fichier et une suite évidente, boutons
  et champs cohérents, focus visible, cibles tactiles de 44 px.

## 5. Contrastes mesurés (WCAG 2.2, seuil texte 4,5:1, non-texte 3:1)

| Paire | Ratio | Usage |
|-------|-------|-------|
| #1E293B sur #FFFFFF | 14,63 | texte principal |
| #475569 sur #FFFFFF | 7,58 | texte secondaire |
| #475569 sur #EFF6FF | 6,96 | texte secondaire sur fond bleu clair |
| #475569 sur #F8FAFC | 7,24 | texte secondaire sur gris 50 (dropzone, pied) |
| #475569 sur #F1F5F9 | 6,92 | bouton désactivé |
| #FFFFFF sur #2563EB | 5,17 | bouton primaire, onglet segmenté actif |
| #2563EB sur #FFFFFF | 5,17 | liens, icônes |
| #1D4ED8 sur #FFFFFF | 6,70 | bouton secondaire |
| #1D4ED8 sur #EFF6FF | 6,16 | badge, « Gratuit, sans compte » |
| #2563EB sur #EFF6FF | 4,75 | icônes sur tuile bleu clair |
| #FFFFFF sur #1E293B | 14,63 | lien d'évitement, onglet de catégorie actif |
| #64748B sur #FFFFFF | 4,76 | bordure des champs, anneau segmenté (non texte) |
| #64748B sur #F8FAFC | 4,55 | trait de la dropzone (non texte) |
| #CBD5E1 / #E2E8F0 sur blanc | 1,48 / 1,23 | bordures décoratives uniquement (cartes, filets), jamais seul indicateur |

Le focus est un anneau de 3 px `#2563EB` à 2 px de décalage (5,17:1 sur
blanc) ; les champs ajoutent une ombre de focus de 3 px.

## 6. Revue UX de l'éditeur Modifier PDF (sans code, pour l'autre chantier)

### Parcours critique observé : ouvrir, trouver un mot, le modifier, enregistrer

1. **Ouvrir.** Titre, sous-titre de trois lignes et dropzone occupent 520 px
   avant la première ligne de l'éditeur ; en 1280 × 800 comme en 390 px, la
   page du PDF n'est pas visible après le chargement (captures). Le visiteur
   croit que rien ne s'est passé.
2. **Trouver un mot.** La loupe est un bouton de 36 px perdu entre le zoom et
   le plein écran ; Ctrl+F fonctionne mais rien ne l'annonce avant l'aide
   « ? ». Le champ s'ouvre dans la même barre, décale les boutons, et le
   compteur « 1/4 » n'est pas annoncé aux lecteurs d'écran.
3. **Modifier.** Trois barres empilées (Annoter/Modifier, sous-barre, barre de
   zoom) plus une colonne d'outils, une colonne de vignettes et un panneau de
   styles : six zones de commande pour une tâche. Le panneau « Styles de
   texte » reste vide tant qu'aucun bloc n'est sélectionné (on lit « Sélectionnez
   un bloc » à droite, l'indication principale est sous la page). Le double-clic
   pour éditer n'est indiqué que dans un texte gris sous la page.
4. **Enregistrer.** Deux boutons : « Télécharger le PDF modifié » en bas de
   page et « Enregistrer les modifications » flottant en bas à droite, qui
   recouvre le panneau de styles (capture 1280). Le bouton flottant du soutien
   occupait le coin opposé et chevauchait la colonne d'outils (corrigé par la
   pastille 48 px).

### Problèmes constatés

- P1 : zone de travail hors écran après chargement ; aucune réduction de la
  dropzone ni du titre une fois le fichier ouvert.
- P1 : deux actions d'enregistrement concurrentes, libellés différents.
- P1 : mobile (390 px) : barre d'outils mobile en bas, vignettes en rangée,
  panneau de styles absent (`display:none` sous 1100 px) : impossible de
  changer la police ou la taille d'un bloc sur téléphone.
- P2 : `.icon-btn` de 36 px pour zoom, recherche, aide, plein écran ; glyphes
  typographiques (◀ ▶ − +) au lieu d'icônes alignées ; boutons de la recherche
  en `btn-secondary` pleine hauteur à côté d'un champ de 34 px.
- P2 : le mode par défaut `body.mode-edit` masque 9 outils d'annotation sans
  l'indiquer ; le bouton « Annoter » n'a pas d'état « contient des outils
  cachés ».
- P2 : raccourcis V/T/I actifs sans indication visible sur les boutons ; pas
  de raccourci pour enregistrer (Ctrl+S) ni pour naviguer entre pages
  (PageUp/PageDown).
- P2 : `h3` « Styles de texte » sans `h2` ; `role="tab"` sans `tabpanel` ;
  `#overlayCanvas` sans nom accessible ; survol des blocs à 16 % d'opacité
  bleue (contraste de l'indication < 3:1).
- P3 : « Ajuster à la largeur » en bas de page alors que le zoom est en haut ;
  valeur de zoom non saisissable.

### Propositions, dans l'ordre

1. **Réduire la tête de page après chargement** : passer le titre en une ligne
   (« Modifier un PDF · nom.pdf · 3 pages »), replier la dropzone en bouton
   « Ouvrir un autre fichier » dans la barre, et faire défiler jusqu'à la
   page. Gain : la première page visible à 1280 × 800 et à 390 px.
2. **Une seule barre d'outils** sur deux rangées maximum : à gauche les modes
   (Sélection, Texte, Image, Formes ▾, Annotations ▾), au centre le zoom (−,
   valeur saisissable, +, Ajuster), à droite Rechercher, Annuler/Rétablir,
   Aide, Plein écran, puis un unique bouton primaire **Enregistrer**
   (Ctrl+S). Supprimer le bouton flottant et le bouton de bas de page.
   Réutiliser `.seg` pour les modes et `.btn-primary` pour Enregistrer.
3. **Panneau de styles contextuel** : afficher le panneau seulement quand un
   bloc est sélectionné (sinon une seule phrase d'aide dans la barre d'état),
   regrouper Police / Taille / Gras-Italique-Souligné / Alignement / Couleur
   sur une ligne de `.seg` ; sur mobile, le même panneau en feuille ancrée en
   bas (hauteur 40 %), ouverte depuis un bouton « Style » de la barre mobile.
4. **Navigation de pages** : vignettes repliables (bouton « Pages » qui
   ouvre/ferme la colonne), compteur « 2 / 12 » cliquable pour saisir un
   numéro, PageUp/PageDown et Début/Fin, bouton « Ajuster à la largeur » remonté
   près du zoom.
5. **Recherche** : panneau ancré sous la barre, champ 40 px, résultats
   « 1 sur 4 » avec `aria-live`, Entrée / Maj+Entrée pour naviguer, bouton
   « Remplacer » dans le même panneau, surlignage des occurrences à 3:1
   minimum (trait plein bleu + fond `--blue-50`).
6. **Raccourcis** : afficher la lettre dans le `title` et en petite étiquette
   sur les boutons (déjà fait pour V, T, I), ajouter Ctrl+S, Ctrl+Plus/Moins,
   Échap pour désélectionner, et garder « ? » pour l'aide.
7. **Mobile** : barre inférieure de 56 px avec cinq actions (Sélection,
   Texte, Pages, Style, Enregistrer), outils secondaires dans un menu
   « Plus », gestes pinch-to-zoom sur le canevas, cibles 44 px partout.
8. **Accessibilité** : `h2` pour les titres du panneau, `role="toolbar"`
   avec navigation flèches gauche/droite, `aria-pressed` sur les outils,
   `aria-label` sur le canevas (« Page 2 sur 12, mode sélection »), focus
   visible 3 px sur les blocs sélectionnables.

## 7. Mode sombre : proposition chiffrée (non livré dans cette vague)

- Périmètre : tokens uniquement, la palette reste blanc/bleu (fond `#0F172A`
  à définir, encre inversée, bleu éclairci `#60A5FA` à valider pour 4,5:1),
  activé par `prefers-color-scheme` et un commutateur mémorisé en
  `localStorage`, `color-scheme: dark` sur `html`.
- Travail : 1 jour pour les tokens et les composants de `css/style.css`
  (tout passe déjà par des variables) ; 1 jour pour les 46 feuilles `<style>`
  locales des pages (couleurs en dur `rgba(37, 99, 235, …)`, canevas et
  aperçus PDF qui doivent rester clairs) ; 0,5 jour de vérification des
  contrastes et des captures ; soit 2,5 jours. Pré-requis : étendre la palette
  autorisée de `scripts/check-style-rules.js` aux teintes sombres et
  documenter la règle « les aperçus de documents restent sur fond blanc ».

## 8. Limites de cette vague

- Les corps de pages d'outils n'ont pas été touchés (chantiers parallèles) :
  `h3` orphelins, `style=""` en ligne, `.file-item` utilisé comme résumé de
  fichier restent tels quels, mais hérités du nouveau rendu.
- Les icônes des cartes restent celles d'origine (13 conversions partagent
  la même) : un jeu de 45 pictogrammes distincts est à dessiner (effort M).
- Les traductions ajoutées (21 cartes et les nouvelles sections en en/es/pt/ar)
  sont de l'équipe design ; l'arabe en particulier doit être relu par un
  locuteur natif.
- Les suffixes `?v=` n'ont pas été recalculés : lancer `npm run
  version-assets` à l'intégration (css/style.css, js/common.js,
  js/index-page.js ont changé).
