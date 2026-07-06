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

## Phase Conversions : 22 nouvelles conversions de fichiers

tchadiaPdf devient un centre de conversion complet : Office vers PDF (Word,
Excel, PowerPoint, texte), PDF vers Office (Word, Excel, PowerPoint, texte
déjà existant), et images/formats modernes (HEIC, WebP, TIFF, BMP, PNG,
JPG, SVG, Markdown, HTML, EPUB). Chaque outil a été testé de bout en bout
avec de vrais fichiers générés (DOCX avec tableau et images, XLSX
multi-feuilles, PPTX 5 diapositives, EPUB multi-chapitres, TIFF
multi-pages, etc.), fichier de sortie rouvert et vérifié par un script
indépendant (pas seulement visuellement). **Validation finale rejouée après
les correctifs de sécurité (voir plus bas) : 22/22 conversions passent, 0
erreur console, 9/9 tests de la suite Playwright committée.**

### Fidélité de conversion : ce qui est réellement acquis

- **texte-en-pdf** : le seul outil "vers PDF" de cette phase qui produit un
  texte réellement sélectionnable/cherchable dans le PDF (dessiné directement
  avec pdf-lib). Limite réelle : les caractères Unicode hors Latin-1
  (émojis, "œ", symboles rares) sont remplacés par "?" par la police
  standard WinAnsi.
- **word-en-pdf, excel-en-pdf, powerpoint-en-pdf, markdown-en-pdf,
  html-en-pdf, epub-en-pdf** : technique de rendu HTML puis rasterisation
  paginée (html2canvas + pdf-lib). Fidélité visuelle élevée (mise en page,
  tableaux, images, polices, en-têtes de tableau répétés sur saut de page),
  **mais le texte du PDF résultant n'est PAS sélectionnable ni cherchable**
  (image haute résolution par page) : documenté explicitement dans
  l'encadré "Fidélité de conversion" de chaque page, jamais caché.
- **word-en-pdf** ne gère que le format .docx moderne (pas l'ancien .doc) ;
  mises en page complexes (colonnes multiples, zones flottantes), macros,
  objets OLE et SmartArt ne sont pas restitués.
- **excel-en-pdf** : sans l'option "ajuster à la largeur", un tableau à
  colonnes nombreuses (testé avec 19 colonnes) est coupé à droite en mode
  portrait (comportement démontré et documenté, pas une supposition).
  Mises en forme conditionnelles, graphiques natifs et formules ne sont pas
  recalculés.
- **powerpoint-en-pdf** : limite la plus significative du groupe : les
  positions des placeholders (titre/contenu) hérités du modèle de
  diapositive sans coordonnées explicites dans le XML sont approximées par
  des zones fixes, car résoudre la chaîne d'héritage complète
  slide→layout→master aurait représenté un travail bien plus important.
  Tableaux natifs, graphiques natifs, SmartArt et formes décoratives sans
  texte sont détectés et signalés après conversion (message listant les
  diapositives concernées), mais ne sont pas dessinés.
- **pdf-en-word** : détection des titres par taille de police relative
  (>1.3x la médiane du document), listes par motif de préfixe, tableaux
  simples par alignement de colonnes récurrent. Sur une mise en page
  atypique (colonnes de journal, PDF sans hiérarchie de taille claire), la
  détection peut se limiter à des paragraphes plats plutôt qu'une structure
  fidèle : comportement voulu (ne jamais forcer une fausse structure) plutôt
  qu'un bug, mais un vrai compromis de fidélité à connaître.
- **pdf-en-excel** : même détection de colonnes par alignement récurrent
  (tolérance de quelques points, seuil de 60% des lignes). Un aperçu HTML
  du résultat est affiché avant téléchargement précisément parce que cette
  détection est heuristique et peut se tromper sur un PDF au layout
  inhabituel : c'est une aide honnête, pas une garantie.
- **pdf-en-powerpoint** : une image haute résolution par page + texte de la
  page en note ; pas d'extraction de texte modifiable sur la diapositive
  elle-même (fidèle à la nature "capture visuelle" de cette conversion).
- **HEIC/TIFF/WebP/BMP/SVG** : décodage réel testé (heic2any avec un vrai
  fichier HEIC généré via pillow-heif, UTIF.js avec un TIFF réel à 3 pages
  et à une page, décodage natif du navigateur pour WebP/BMP vérifié en
  conditions réelles plutôt que supposé). SVG avec polices externes ou
  scripts embarqués : rendu non garanti (documenté, cas non testé).
- **html-en-pdf** : n'effectue jamais de récupération d'URL distante (message
  explicite à l'utilisateur, qui doit enregistrer la page depuis son
  navigateur d'abord) ; rendu dans une iframe sandboxée sans `allow-scripts`,
  vérifié par un test avec un fichier piégé contenant une balise `<script>`
  qui ne s'exécute jamais.
- **epub-en-pdf** : ne prend pas en charge les EPUB protégés par DRM ; mise
  en page fortement simplifiée par rapport à un lecteur EPUB natif ; un bug
  réel a été trouvé et corrigé pendant les tests (images en URL `blob:`
  invisibles à la capture html2canvas, corrigé en les reconvertissant en
  URL `data:` avant rasterisation).

### Traitement par lots

Tous les outils de conversion acceptent un lot de 20 fichiers maximum avec
export ZIP (limite volontairement plus basse que les 50 fichiers des outils
PDF historiques, ces conversions étant individuellement plus coûteuses en
calcul : parsing DOCX/PPTX, rasterisation HTML).

### Sécurité (Phase Sécurité, appliquée pendant cette même session)

- **Deux failles XSS réelles trouvées et corrigées**, avec preuve avant/après
  par test Playwright automatisé (pas une simple relecture) :
  - `markdown-en-pdf` : `marked.parse()` ne neutralise aucun HTML brut par
    conception ; un Markdown piégé avec une image `onerror=` exécutait du
    JavaScript arbitraire dans la page dès l'aperçu en direct. Corrigé par
    assainissement (`js/security-utils.js`, fonction `sanitizeHtmlForDisplay`)
    aux deux points d'insertion (aperçu visible et conteneur de rendu).
  - `word-en-pdf` : un lien `href="javascript:..."` généré par mammoth.js à
    partir d'un DOCX piégé était préservé tel quel dans le conteneur de
    rasterisation. Corrigé par le même assainisseur.
  - Vérifié sans faille (pas de correctif nécessaire) : `excel-en-pdf` et
    `pdf-en-excel` insèrent déjà le texte des cellules via `textContent` ;
    `powerpoint-en-pdf`/`pdf-en-word`/`pdf-en-powerpoint` n'injectent jamais
    de HTML dérivé du fichier utilisateur ; `html-en-pdf` utilise déjà une
    iframe sandboxée sans `allow-scripts`.
- **Validation par octets magiques** (signature binaire réelle, pas
  seulement l'extension du fichier) ajoutée sur 8 outils parmi les plus
  exposés : word-en-pdf, excel-en-pdf, powerpoint-en-pdf, pdf-en-word,
  pdf-en-excel, pdf-en-powerpoint, heic-en-jpg, heic-en-pdf, tiff-en-pdf.
  **Limite honnête** : les ~35 autres outils du site (fusionner, diviser,
  compresser, rogner, filigrane, jpg/png/webp/bmp/svg-en-pdf, etc.) n'ont
  pas reçu cette validation dans cette itération.
- **Limites de pages/diapositives** ajoutées sur les mêmes 8 outils (ex :
  3000 pages max pour pdf-en-word/excel, 800 diapositives générées max pour
  excel-en-pdf/powerpoint-en-pdf) pour éviter qu'un fichier "bombe" gèle
  l'onglet. Non testé en conditions réelles (fixture d'une telle taille
  jugée trop coûteuse à générer dans le temps disponible) : seule la
  fonction de garde-fou elle-même est unit-testée.
- **Isolation Web Worker** : faite sur un seul outil (word-en-pdf, parsing
  mammoth avec timeout de 30 secondes et repli sur le thread principal si
  `Worker` est indisponible), à titre de preuve de faisabilité. **Non
  généralisée** aux 9 autres outils modifiés ni au reste du site : effort
  restant estimé à 30-60 minutes par outil.
- **Preuve automatisée de confidentialité** : `tests/no-network-leak.spec.js`
  intercepte tout le trafic réseau pendant une conversion réelle (fusionner,
  compresser-pdf, modifier-pdf, pdf-en-word) et échoue si une requête
  contient le contenu du fichier utilisateur ou vise un domaine hors des
  CDN de librairies légitimement utilisés par la page. 9/9 tests passent.
- Scan de secrets sur le dépôt et l'historique Git complet : rien trouvé.
  `npm audit --audit-level=high` : 0 vulnérabilité au moment de l'audit.

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
6. Étendre la validation par octets magiques, les limites de pages et
   l'isolation Web Worker aux ~35 outils du site qui ne l'ont pas encore
   reçue (voir la section Phase Conversions ci-dessus pour le détail exact
   de ce qui est déjà fait sur les 8 outils les plus exposés).
7. SRI (`integrity`/`crossorigin`) sur chaque balise CDN de chaque page,
   fallback local hashé pour chaque librairie, CSP durcie (nonces/hash,
   HSTS preload, Permissions-Policy, COOP/COEP) : prévu au round final de
   la Phase Sécurité, voir TODO.md et SECURITY.md pour l'état d'avancement
   réel au moment de la lecture.
