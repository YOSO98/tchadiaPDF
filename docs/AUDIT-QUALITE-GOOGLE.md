# Audit anti-pénalité Google : tchadiaPdf

Date de l'audit : 2026-07-14. Méthode : recherche automatisée (scripts
Node ad hoc, non committés, sur les 59 pages indexables du dépôt (44
outils, accueil, pages annexes, 2 pages par langue ar/en/es/pt) croisée
avec une relecture manuelle ciblée. Conclusion générale : le site est
globalement sain. La plupart des critères classiques de pénalité
reviennent négatifs (aucun problème trouvé), ce qui reflète le soin déjà
apporté au contenu lors des sessions précédentes. Un seul vrai manque
technique a été trouvé et corrigé (balises canonical absentes).

## 1. Contenu dupliqué ou quasi dupliqué

**Vérifié, aucun problème trouvé.**

- **Titres et meta descriptions** : comparaison exacte des 59 balises
  `<title>` et `<meta name="description">` entre elles. **Zéro doublon
  exact.** Chaque page a un titre et une description qui lui sont propres.
- **Les 43 pages d'outils n'existent qu'en français** : seules
  `index.html` et `soutenir.html` sont traduites (dans `ar/`, `en/`,
  `es/`, `pt/`), avec des balises `hreflang` correctement posées sur les
  5 versions (vérifié dans le `<head>` de chaque page concernée). Il n'y
  a donc pas de risque de contenu dupliqué entre langues sur les pages
  d'outils : elles n'ont tout simplement pas d'équivalent traduit.
  Les traductions de l'accueil, elles, sont le cas d'usage normal et
  attendu de `hreflang` (Google les traite comme des versions
  linguistiques d'une même page, pas comme du duplicata).
- **Paires de conversion proches** (ex. `png-en-jpg.html` /
  `jpg-en-png.html`, ou les 4 pages HEIC/TIFF/WebP/BMP → PDF) : lues en
  détail, y compris leurs FAQ. Le contenu est réellement différencié
  (ex. la FAQ PNG→JPG parle de la perte de qualité et de la
  transparence ; la FAQ JPG→PNG parle du poids de fichier plus élevé et
  de l'absence de restauration de qualité) plutôt que d'être un
  gabarit avec un mot changé. Aucune reformulation nécessaire.

## 2. Exactitude des promesses affichées

**Vérifié, aucun problème trouvé.** Recherche de toutes les occurrences
de "aucune donnée", "ne quitte", "100% privé/local", "illimité", "sans
limite", "sans inscription" sur l'ensemble du site.

- La formulation utilisée est systématiquement **"vos fichiers"** ou
  **"traitement 100% local"**, jamais la formulation trop large "aucune
  donnée ne quitte votre appareil" (qui serait fausse : les scripts
  publicitaires/analytics, quand ils sont chargés après consentement,
  transmettent bien certaines données techniques, même si aucun contenu
  de fichier n'est jamais concerné).
- Le bandeau de consentement (`js/consent-banner.js`) fait déjà
  explicitement cette distinction : *"Ce site peut afficher des
  publicités (Google AdSense)... Vos fichiers, eux, ne quittent jamais
  votre appareil."* C'est exactement la formulation que ce volet de la
  mission demandait de vérifier.
- `confidentialite.html` reste précis : *"Aucune donnée **liée au
  contenu de vos fichiers**..."*, jamais une généralisation abusive.
- **"Gratuit et illimité" / "sans limite"** : la seule limite réelle du
  site est un plafond par lot (20 à 50 fichiers selon l'outil, voir
  `MAX_FILES` dans les fichiers `js/*.js` concernés), pas une limite
  d'usage globale. `conversions.html` le précise déjà explicitement dans
  sa FAQ : *"Certains outils limitent le traitement par lot à 20
  fichiers à la fois, sans limite sur le nombre de conversions
  successives."* Aucune page ne prétend l'inverse.
- **"Sans inscription"** : vrai partout, le site n'a ni compte ni
  authentification nulle part (statique, sans backend).

## 3. Titres/descriptions dupliqués, pages orphelines, liens cassés

**Vérifié par script (parcours de tous les `href="*.html"` internes du
dépôt, résolution des chemins relatifs, comparaison avec les fichiers
réels).**

- **Titres/descriptions dupliqués** : 0 (voir point 1).
- **Liens internes cassés** : **0 lien cassé** sur l'ensemble du site.
- **Pages orphelines** (aucun lien entrant interne) : une seule,
  `offline.html`. C'est le comportement voulu : cette page est la page
  de repli du service worker en mode hors ligne
  (`sw.js`), elle n'a jamais vocation à être un lien de
  navigation ni une page indexée. Elle est déjà volontairement absente
  de `sitemap.xml` (vérifié : 59 pages indexables listées sur 60 fichiers
  HTML du dépôt, l'écart est exactement `offline.html`). Rien à corriger.

**Observation mineure, non corrigée (n'est pas un facteur de pénalité,
seulement d'affichage)** : 34 des 59 titres dépassent 60 caractères et
16 des 59 descriptions dépassent 160 caractères, seuils au-delà desquels
Google tronque l'affichage dans les résultats de recherche. Ce n'est pas
un risque de pénalité (Google ne pénalise pas la longueur, il tronque
simplement l'affichage), donc volontairement laissé de côté dans cette
passe pour rester concentré sur les vrais risques de pénalité listés
par la mission. Liste complète des pages concernées disponible dans
l'historique de cet audit si une passe de réécriture est décidée plus
tard.

## 4. Sur-optimisation / bourrage de mots-clés

**Vérifié par échantillonnage (analyse de fréquence lexicale sur
plusieurs pages représentatives), aucun problème trouvé.** Aucune
répétition artificielle détectée : la densité du mot-clé principal
(nom de l'outil) reste naturelle (2 à 4 occurrences sur des pages de
60 à 200 mots), cohérente avec une rédaction humaine normale plutôt
qu'avec du bourrage.

## 5. Corrections apportées

| # | Constat | Action |
|---|---|---|
| 1 | Aucune balise `<link rel="canonical">` nulle part sur le site (0/59 pages) | **Corrigé** : balise canonical absolue ajoutée sur les 59 pages indexables (voir commit dédié). Empêche tout risque de contenu dupliqué perçu en cas d'accès via une URL alternative (paramètres de requête, variantes de casse, etc.) |

## Priorisation de ce qui reste (rien de bloquant identifié)

1. *(Optionnel, cosmétique)* Raccourcir les 34 titres et 16 descriptions
   qui dépassent les seuils d'affichage Google, pour améliorer le taux
   de clic dans les résultats de recherche (pas un risque de pénalité).
2. *(Optionnel)* Étendre les traductions au-delà de l'accueil et de
   `soutenir.html` si l'audience internationale devient prioritaire :
   aucun risque actuellement, mais un site tout en français limite la
   portée dans les autres langues du sitemap `hreflang`.
