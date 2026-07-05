# BENCHMARK : tchadiaPdf face aux principaux concurrents

Ce document compare honnêtement tchadiaPdf aux outils PDF en ligne les plus
connus (iLovePDF, Smallpdf, Adobe Acrobat en ligne, PDF24). Objectif :
savoir précisément où tchadiaPdf est déjà compétitif, où il ne l'est pas
encore, et où concentrer les efforts futurs. Aucune affirmation ci-dessous
n'est faite sans l'avoir vérifiée dans ce dépôt (tests Playwright, lecture
du code, ou limite technique connue et documentée).

## Ce qui différencie structurellement tchadiaPdf

- **Confidentialité réelle et vérifiable** : tout le traitement se fait dans
  l'onglet du navigateur. Un concurrent qui traite côté serveur peut
  annoncer la suppression des fichiers après usage, mais cela reste une
  promesse contractuelle, pas une garantie technique. Chez tchadiaPdf, le
  fichier ne transite jamais sur le réseau (vérifiable avec l'onglet Réseau
  des outils de développement).
- **Gratuit sans compte ni limite de fichiers/mois**, y compris pour des
  fonctions que la plupart des concurrents réservent au payant : édition du
  texte existant, chiffrement AES-256, traitement par lots.
- **Open source (MIT)** : le code est auditable et modifiable par la
  communauté, contrairement aux outils propriétaires cités.

## Comparaison outil par outil

### Modifier PDF (édition du texte existant)

| Critère | tchadiaPdf | iLovePDF / Smallpdf | Adobe Acrobat |
|---|---|---|---|
| Modifier le texte existant | Oui, gratuit, illimité | Payant (offre Pro) | Payant (abonnement) |
| Correspondance de police | Substitution visuelle (Liberation Sans/Serif/Mono) | Souvent la police d'origine si standard, sinon substitution similaire | Meilleure, moteur de correspondance plus avancé |
| Formes, surlignage, images | Oui | Oui | Oui |
| Historique annuler/rétablir | Oui, illimité en session | Oui | Oui |
| Confidentialité | 100% local | Fichiers envoyés au serveur | Fichiers envoyés au serveur (sauf Acrobat de bureau) |

**Limite honnête** : notre correspondance de police est une approximation
visuelle (serif/sans-serif/monospace, gras, italique, taille), pas un clone
au pixel près de la police d'origine si celle-ci n'est pas une police
standard. Aucun concurrent testé ne résout ce problème parfaitement non
plus pour des polices exotiques non embarquées, mais Adobe Acrobat s'en
approche mieux grâce à des heuristiques plus sophistiquées et à des années
d'ingénierie dédiées. Notre approche masque l'ancien texte par un rectangle
de la couleur de fond échantillonnée : sur un fond à motif ou dégradé (rare
pour du texte de document), le masquage sera visible.

#### Correction post-lancement : granularité mot/ligne (juillet 2026)

Des tests sur un document administratif réel (lettre scannée en qualité
normale) ont révélé deux bugs bloquants dans la première version de
l'éditeur : un clic sélectionnait toute la ligne au lieu du mot visé, et
l'édition ne s'ouvrait pas de façon fiable (un clic réel a presque toujours
un micro-mouvement de souris, que l'ancienne logique interprétait à tort
comme un glissement pour déplacer la ligne, empêchant l'ouverture de la
zone de saisie). Cause racine identifiée par reproduction Playwright avant
correction, comme demandé.

Correction apportée :
- Modèle de texte entièrement reconstruit : caractère → mot → ligne (plus
  seulement ligne). Chaque caractère a sa position et sa largeur, calculées
  par répartition proportionnelle de la largeur totale connue de pdf.js
  (mesurée via `canvas measureText`, mise à l'échelle pour correspondre
  exactement à la largeur réelle).
- Un clic simple sélectionne désormais le mot exact sous le curseur
  (surbrillance bleue). Un clic-glissé sélectionne une plage de mots
  précise. Un double-clic ouvre l'édition de la ligne avec le curseur
  placé au caractère exact cliqué.
- Le double-clic est désormais détecté via l'événement natif `dblclick`
  du navigateur plutôt qu'une minuterie maison : plus fiable, et cela a
  révélé un second bug plus subtil (voir ci-dessous).
- **Bug additionnel trouvé et corrigé en cours de route** : reconstruire les
  éléments DOM de survol à chaque sélection de mot empêchait le navigateur
  de reconnaître un double-clic (les deux clics doivent viser le même
  élément DOM pour que `dblclick` se déclenche ; les recréer entre les deux
  clics casse la détection, y compris sur un vrai double-clic humain, pas
  seulement dans les tests automatisés). Corrigé en séparant clairement la
  reconstruction des zones cliquables (une fois par page affichée) du
  redessin du canevas de sélection (à chaque interaction).
- Validation par le nouveau texte : seul le ou les mots réellement modifiés
  sont masqués et redessinés (par comparaison du texte avant/après, préfixe
  et suffixe communs conservés intacts), la baseline d'origine est
  respectée.
- Tests de non-régression Playwright obligatoires, tous vérifiés : clic sur
  un mot au milieu d'un paragraphe (surbrillance étroite, ~420 pixels,
  contre ~5300 pixels pour une plage de plusieurs mots glissée) ; double-clic
  + frappe + validation avec vérification du texte réellement présent dans
  le PDF exporté (extraction via pdf.js, pas seulement visuelle) ; édition
  en début, milieu et fin de ligne ; PDF sans texte détecté déclenchant le
  bandeau de proposition d'OCR ; le tout reproduit à l'identique en viewport
  mobile 375px.

**Limites connues restantes après cette correction :**
- Les changements de style (gras, italique, taille, couleur) via la barre
  contextuelle s'appliquent à toute la ligne, pas seulement au mot en cours
  d'édition : un changement de style seul (sans modification de texte)
  redessine donc toute la ligne avec la police de substitution, perdant le
  rendu d'origine du reste de la ligne. Modifier uniquement le texte (sans
  toucher au style) reste, lui, minimal.
- Insérer un mot supplémentaire au milieu d'une ligne (sans remplacer un mot
  existant) peut chevaucher visuellement la suite du texte non modifié : il
  n'y a pas de réagencement automatique des mots suivants (pas de mise en
  page dynamique complète de la ligne). Remplacer un mot par un autre, en
  revanche, fonctionne correctement quelle que soit sa position.
- Modifier une même ligne une seconde fois recompare le nouveau texte au
  texte détecté à l'origine (pas à la version précédemment modifiée) : la
  zone masquée peut alors être légèrement plus large que le strict minimum
  en cas d'éditions répétées de la même ligne.
- La sélection de mot(s) par simple clic ou glissement est uniquement
  visuelle pour l'instant (surbrillance) : elle ne permet pas encore de
  supprimer ou remplacer directement la sélection au clavier sans passer
  par le double-clic pour ouvrir l'édition de la ligne.
- Le texte issu de l'OCR (pages scannées) répartit les caractères d'un mot
  de façon uniforme dans son rectangle englobant plutôt que par une mesure
  précise : suffisant pour l'édition, mais moins exact que le texte
  vectoriel d'origine.

### Protéger / Déverrouiller / Réparer PDF

| Critère | tchadiaPdf | Concurrents |
|---|---|---|
| Algorithme de chiffrement | AES-256 réel (qpdf) | Généralement AES-128 ou 256 selon l'outil |
| Réparation de PDF corrompu | Oui (qpdf, reconstruction de xref) | Variable selon l'outil |
| Confidentialité | 100% local (WASM) | Fichiers envoyés au serveur |

**Limite honnête** : notre chiffrement n'expose pas encore de permissions
fines (impression/copie/modification désactivables séparément) : toutes les
permissions sont accordées par défaut au titulaire du mot de passe
utilisateur. Le mot de passe propriétaire est actuellement identique au mot
de passe utilisateur (pas de mot de passe "administrateur" distinct).
La réparation ne peut rien pour un fichier tronqué au point de n'avoir plus
aucune structure PDF exploitable (aucun outil ne le peut).

### Compresser PDF

| Critère | tchadiaPdf | Concurrents |
|---|---|---|
| Recompression JPEG | Oui, qualité réglable (3 niveaux) | Oui |
| Ré-échantillonnage DPI cible | Non (implicite via la qualité JPEG, pas de contrôle DPI explicite) | Souvent oui (72/150/300 DPI) |
| Suppression objets/polices inutilisés | Non | Souvent oui |
| Traitement | Web Worker, ne bloque pas l'interface | Variable |

**Limite honnête** : contrairement à l'objectif initial, tchadiaPdf ne
propose pas encore de ré-échantillonnage DPI explicite ni de suppression
des objets/polices inutilisés : seule la recompression JPEG des images
déjà au format DCTDecode est prise en charge (les images non-JPEG ne sont
pas retraitées, pour rester fiable sur tous les PDF). Sur un PDF
principalement composé de texte (pas d'images), le gain de compression
sera minime, ce qui est honnête à annoncer plutôt que de prétendre un taux
de compression universel.

### OCR PDF

| Critère | tchadiaPdf | Concurrents |
|---|---|---|
| Moteur | Tesseract.js (WebAssembly, local) | Souvent un moteur cloud propriétaire (généralement plus précis) |
| Langues | Français + anglais | Souvent large éventail configurable |
| Vitesse | Plus lent (traitement local, pas de GPU serveur dédié) | Généralement plus rapide (infrastructure serveur) |
| Confidentialité | 100% local | Fichier envoyé au serveur |

**Limite honnête** : Tesseract.js est reconnu pour être moins précis qu'un
moteur OCR cloud propriétaire sur des documents de mauvaise qualité
(scans penchés, écriture manuscrite, mauvais contraste). C'est le prix de
la confidentialité totale : aucun compromis n'a été fait pour envoyer le
document à un service tiers plus précis.

### Scanner un document

| Critère | tchadiaPdf | Applications mobiles dédiées (Adobe Scan, CamScanner) |
|---|---|---|
| Correction de perspective | Oui, manuelle (4 coins) | Oui, souvent automatique |
| Détection automatique des bords | Non | Oui généralement |
| Filtres | Couleur, contraste, noir et blanc | Souvent plus de préréglages |

**Limite honnête** : pas de détection automatique des bords du document
(l'utilisateur positionne les 4 coins), et l'échantillonnage lors du
redressement de perspective est au plus proche voisin, pas bilinéaire (une
légère perte de netteté sur les bords est possible).

### Traitement par lots

Les outils compresser-pdf, rogner-pdf, pdf-en-jpg, pivoter,
numeros-de-pages et filigrane acceptent désormais jusqu'à 50 fichiers en
file d'attente avec progression individuelle et globale, pause, reprise et
export ZIP : une fonctionnalité que la plupart des concurrents réservent à
leurs offres payantes ou limitent en nombre de fichiers gratuits par jour.
tchadiaPdf ne fixe aucune limite de ce type.

## Fiabilité (vérifiée dans ce dépôt)

- Testé avec un PDF de 300 pages : organiser-pdf, numeros-de-pages et
  modifier-pdf restent utilisables (modifier-pdf ne rend en pleine
  résolution que la page courante, chargement en moins de 3,5 secondes).
- Testé avec une image embarquée de 3000x2000 pixels (PDF de 4,2 Mo) :
  compresser-pdf traite le fichier sans geler l'interface.
- Testé avec un formulaire AcroForm réel (champ texte + case à cocher) :
  formulaires-pdf et aplatir-pdf détectent et traitent les champs
  correctement.
- Testé le chiffrement AES-256 de bout en bout avec pikepdf (bibliothèque
  Python indépendante) : ouverture refusée sans mot de passe, acceptée avec
  le bon mot de passe (y compris accentué), rejetée avec un mauvais mot de
  passe.
- Testé la réparation d'un PDF avec une table de références croisées
  corrompue : qpdf la reconstruit correctement.
- Non testé dans ce cycle, à prévoir : PDF/A, formulaires XFA (non standard,
  rarement rencontrés hors de certaines administrations), polices
  exotiques embarquées en CFF/Type3.

## Performance

Audit Lighthouse réel exécuté en local (Chromium headless, réseau local
sans CDN de production ni cache HTTP réel : les scores en production avec
un vrai CDN devraient être égaux ou meilleurs, jamais pires) :

| Page | Performance | Accessibilité | SEO |
|---|---|---|---|
| index.html (accueil) | 91 | 95 | 100 |
| fusionner.html | 85 | 100 | 100 |
| modifier-pdf.html (éditeur complet) | 78 (après optimisation, 65 avant) | 100 | 100 |

**Limite honnête** : la page de l'éditeur (modifier-pdf.html) reste la plus
lourde du site car elle charge pdf-lib et pdf.js dès l'arrivée (le glue JS
de fontkit a été mis en chargement paresseux durant cette itération même,
déclenché uniquement au moment de cliquer sur "Télécharger le PDF modifié",
ce qui a fait passer le score de performance de 65 à 78 ; les polices
Liberation et le moteur qpdf restent eux aussi paresseux). Ces mesures ont
été prises en local sans CDN de production ; un audit sur le déploiement
Cloudflare Pages réel donnerait des chiffres définitifs, probablement
meilleurs grâce au cache HTTP et à la répartition géographique du CDN
(à refaire après mise en production, voir TODO.md).

## Où concentrer les efforts futurs (priorisé)

1. Audit Lighthouse réel une fois le site déployé en production.
2. Ré-échantillonnage DPI explicite et nettoyage des objets inutilisés pour
   compresser-pdf, pour se rapprocher des taux de compression annoncés par
   les concurrents sur des PDF non composés d'images JPEG.
3. Détection automatique des bords pour scanner-pdf (nécessiterait un
   algorithme de détection de contours, actuellement hors périmètre pour
   rester 100% client sans bibliothèque de vision par ordinateur lourde).
4. Étendre l'internationalisation aux pages d'outils individuelles
   (actuellement seule la page d'accueil est traduite en anglais, espagnol,
   portugais et arabe).
5. Permissions de chiffrement PDF plus fines (impression/copie/modification
   désactivables séparément) pour proteger-pdf.
