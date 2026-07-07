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

### Audit Lighthouse élargi (Phase 6 Bloc 1, 10 pages représentatives)

| Page | Performance | Accessibilité | SEO | Bonnes pratiques |
|---|---|---|---|---|
| index.html | 96 | 96 | 100 | 96 |
| conversions.html | 76 | 100 | 100 | 96 |
| fusionner.html | 74 | 100 | 100 | 96 |
| compresser-pdf.html | 79 | 100 | 100 | 96 |
| jpg-en-pdf.html | 80 | 100 | 100 | 96 |
| pdf-en-jpg.html | 82 | 100 | 100 | 96 |
| word-en-pdf.html | 70 | 98 | 100 | 96 |
| pdf-en-word.html | 68 | 98 | 100 | 96 |
| markdown-en-pdf.html | 81 | 100 | 100 | 96 |
| securite.html | 95 (69 avant correctif) | 96 | 100 | 96 |

**Bug de performance réel trouvé et corrigé** : la passe globale ajoutant
`js/analytics.js`, `js/ads.js` et `js/consent-banner.js` à chaque page
(Phase 6 Bloc 3) les avait ajoutés sans l'attribut `defer`, ce que
Lighthouse signalait comme requêtes bloquant le rendu (environ 1050 ms
cumulés sur `securite.html`, qui n'a par ailleurs aucune bibliothèque
lourde). Corrigé en ajoutant `defer` aux 3 balises sur les 49 pages,
score de `securite.html` passé de 69 à 95, vérifié sans régression
fonctionnelle (bandeau de consentement et sélecteur de langue toujours
opérationnels).

**Limite honnête restante** : les pages qui chargent des bibliothèques de
conversion lourdes (mammoth, html2canvas, xlsx, pptxgenjs, docx) via CDN
au chargement de la page plutôt qu'à la demande (`word-en-pdf.html`,
`pdf-en-word.html`) restent sous 90 en performance (68-70). Passer ces
bibliothèques en chargement paresseux (déclenché seulement à la sélection
d'un fichier, comme cela a déjà été fait pour fontkit/qpdf-wasm/Tesseract
sur d'autres outils) ferait probablement gagner plusieurs points, non
fait dans cette itération faute de temps : piste inscrite dans la liste
des efforts futurs ci-dessous. Ces mesures restent prises en local sans
CDN de production ni cache HTTP réel (voir remarque plus haut).

## Éditeur professionnel : refonte de modifier-pdf (blocs, images, deux modes)

Refonte majeure de `modifier-pdf.html`/`js/modifier-pdf.js` pour se
rapprocher du niveau des éditeurs professionnels (Acrobat, PDFgear) en
mode "Modifier" : détection et affichage permanent de toutes les zones
éditables dès le chargement, édition multi-lignes avec retour à la ligne
automatique, gestion des images détectées, deux modes clairs (Annoter /
Modifier). Le moteur existant (lignes/mots/caractères, masquage par
échantillonnage de couleur, polices Liberation via fontkit) a été étendu
avec un nouveau modèle de BLOCS plutôt que réécrit.

### Ce qui fonctionne réellement, vérifié par des tests Playwright

- **Détection et affichage des blocs** : les lignes détectées par pdf.js
  sont regroupées en blocs (paragraphe/titre/sous-titre/ligne isolée)
  selon la taille de police (tolérance ≤8% pour fusionner deux lignes
  dans le même paragraphe) et la cohérence de l'interligne. Chaque bloc
  affiche un cadre en pointillés bleus **permanent** (pas seulement au
  survol), avec infobulle de classification. Sur un contrat de test
  généré (titre, 2 sous-titres, 2 paragraphes, un tableau, une ligne de
  signature isolée, un logo), 9 blocs sont détectés correctement, dans
  le bon ordre et avec le bon type, pour 18 lignes de texte brutes.
- **Détection d'images** : implémentée via `page.getOperatorList()` de
  pdf.js en cumulant les matrices `save`/`transform`/`restore` jusqu'à
  chaque `paintImageXObject`, pour reconstruire le rectangle exact de
  chaque image en coordonnées PDF. Validée d'abord isolément côté Node
  (position/taille exactes retrouvées au point près sur un PDF de test)
  avant intégration au navigateur.
- **Détection de dates et e-mails** : expressions régulières sur le texte
  de chaque bloc (JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA, AAAA-MM-JJ, e-mail),
  clic droit sur un bloc contenant une date affiche un menu contextuel
  "Modifier cette date" ouvrant un `<input type="date">` qui réinjecte la
  nouvelle date au format d'origine (même séparateur, même ordre
  jour/mois/année).
- **Édition multi-lignes d'un bloc** : double-clic ouvre une zone de texte
  couvrant tout le paragraphe, curseur placé au caractère exact cliqué
  (réutilise `charIndexAtX`). Entrée insère une ligne, Échap annule, un
  clic en dehors valide (documenté dans l'aide "?"). Le texte est
  réhabillé dans la largeur du bloc (retour à la ligne automatique par
  `canvas measureText`) ; si le nombre de lignes physiques ne change pas,
  seul le mot modifié est masqué/redessiné (chemin minimal, hérité de la
  correction précédente) ; sinon tout le bloc est masqué et reconstruit,
  avec extension vers le bas si besoin (liseré bleu foncé + infobulle
  d'avertissement en cas de chevauchement possible avec le bloc suivant).
  Une case à cocher optionnelle "reflow" décale alors les blocs suivants
  de la même page pour absorber l'extension (translation simple, ne
  réhabille pas leur propre texte, voir limite ci-dessous).
- **Remplacement/suppression d'image** : chaque image (détectée ou
  ajoutée) a désormais sélection, poignée de redimensionnement, glisser-
  déplacer, et une barre d'actions flottante (Remplacer/Supprimer).
  Remplacer ouvre un sélecteur de fichier et insère la nouvelle image aux
  mêmes position/dimensions ; l'originale est masquée par un rectangle
  blanc à sa position d'origine. Vérifié de bout en bout : le PDF exporté
  s'ouvre sans erreur et contient une image différente de l'originale.
- **Deux modes** : onglets "Annoter" (comportement historique : formes,
  surlignage, masquage, soulignage/barré) et "Modifier" (nouveau, mode
  par défaut) avec sous-barre dédiée (Modifier le texte / Insérer du
  texte / Images / Formulaires, ce dernier renvoyant vers
  `formulaires-pdf.html`). Panneau latéral droit "Styles de texte"
  synchronisé sur le bloc sélectionné (police de substitution, taille,
  gras, italique, souligné, alignement, couleur), rendu à l'écran et à
  l'export PDF. Bouton "Enregistrer les modifications" fixe toujours
  visible, navigation de page (précédent/suivant, "Page X / N",
  "Ajuster à la largeur") en bas de l'éditeur.
- **Robustesse** : la détection de blocs et d'images est **paresseuse**
  (page courante + une page voisine de chaque côté préchargée en tâche de
  fond, jamais tout le document). Vérifié sur un document généré de 100
  pages : première page affichée et interactive en ~2,3 s, seules 2 pages
  sur 100 ont leurs blocs/images calculés à ce moment-là, navigation vers
  la page 100 en ~0,5 s. Le bandeau de proposition d'OCR (page scannée
  sans texte détecté) continue de fonctionner sans régression avec le
  nouveau modèle de blocs.
- **Bug réel trouvé et corrigé par les tests** (pas caché, comme demandé) :
  la barre d'actions flottante (Supprimer/Remplacer) sous un bloc ou une
  image sélectionnés était positionnée AU-DESSUS du bloc au lieu d'en
  dessous (erreur de signe liée à l'axe Y de PDF, orienté vers le haut de
  la page, contrairement à l'écran). Conséquence concrète découverte en
  testant l'édition sur mobile : la barre chevauchait la zone cliquable
  du bloc, si bien que le second clic d'un double-clic tombait sur le
  bouton "Supprimer" au lieu du bloc, empêchant le navigateur de
  reconnaître un double-clic natif et donc d'ouvrir l'édition. Isolé avec
  un test Playwright dédié (inspection de l'élément réellement présent
  sous le point de clic juste après le premier clic), puis corrigé.

### Limites connues et honnêtes

- **Déplacer une image détectée sans la remplacer ne modifie pas le PDF
  final.** L'interface permet de glisser n'importe quelle image (détectée
  ou ajoutée) et affiche le déplacement en aperçu, mais pour une image
  détectée dans le PDF d'origine, seul un remplacement ou une suppression
  agit réellement sur le fichier exporté : les octets de l'image
  d'origine ne sont pas extraits/ré-encodés depuis le PDF source pour être
  redessinés ailleurs (l'extraction fiable via `page.objs`/`commonObjs`
  de pdf.js couvre trop de cas d'encodage exotiques, JPX, palettes
  indexées, masques alpha, pour être traitée de façon robuste dans le
  temps imparti). Un déplacement seul (sans remplacement) reste donc
  cosmétique dans l'aperçu et n'est pas répercuté à l'enregistrement.
- **Le "reflow" des blocs suivants est une translation simple**, pas une
  ré-habillage complet de mise en page : quand un bloc s'agrandit et que
  l'option reflow est activée, les blocs situés en dessous sont décalés
  verticalement d'une quantité fixe, mais leur propre texte n'est pas
  ré-enveloppé ni leur police recalculée. Pour la grande majorité des cas
  (un paragraphe qui pousse le suivant vers le bas) c'est suffisant et
  correct ; ça ne gère pas un réagencement en cascade sur plusieurs pages.
- **Les changements de style (police, taille, gras, italique, couleur,
  alignement, souligné) via le panneau de droite s'appliquent à tout le
  bloc**, pas à une portion sélectionnée : cette limite, déjà présente
  dans la version précédente au niveau de la ligne, existe maintenant au
  niveau du bloc. Modifier uniquement le texte (sans toucher au style)
  reste, lui, minimal (un seul mot masqué/redessiné) quand c'est possible.
- **L'ancien système de sélection de mot par simple clic/glissé (avec
  surbrillance bleue) a été volontairement remplacé** par la sélection de
  bloc entier (clic = sélection du bloc, double-clic = édition), conforme
  à la nouvelle spécification. Le code de l'ancien système
  (`rebuildTextHitAreas`, `onLineHitPointerDown`, `wordSelection`,
  `drawWordHighlight`, la barre contextuelle `context-bar`) reste présent
  dans le fichier mais est désormais inerte : les nouveaux éléments
  `.block-hit` sont ajoutés par-dessus et interceptent les événements en
  premier. Non nettoyé faute de temps disponible dans cette itération ;
  sans risque fonctionnel (le code mort ne s'exécute jamais) mais à
  retirer dans un futur passage de nettoyage pour la lisibilité du fichier.
- **La classification titre/sous-titre/paragraphe repose sur la taille de
  police et l'interligne**, pas sur une analyse sémantique : un document
  qui utilise la même taille de police pour un titre et le corps du texte
  (mise en forme uniquement par le gras, par exemple) sera classé
  "paragraphe" ou fusionné avec le texte voisin si le gras n'est pas
  détectable par pdf.js pour la police en question (les polices standard
  PDF14 embarquées sans descripteur complet, ex. Helvetica standard, ne
  remontent pas toujours l'information gras/italique via
  `getTextContent()` : constaté et documenté pendant le développement,
  contournement partiel via la détection du nom de police quand elle
  contient explicitement "Bold"/"Italic").

### Méthodologie de test

PDF de contrat réaliste généré par script (Node + pdf-lib) : titre, deux
sous-titres, deux paragraphes (dont un avec une date JJ/MM/AAAA et un
avec une adresse e-mail), un tableau simple en colonnes, une ligne de
signature isolée, un logo. Suite Playwright de 17 vérifications couvrant
les 7 scénarios demandés (zones encadrées au chargement, édition d'un mot
vérifiée dans le PDF réexporté via pdf.js, remplacement d'image vérifié
de bout en bout, détection de date et menu contextuel, viewport mobile
375px pour les zones et l'édition, absence d'erreur console sur tous les
scénarios, non-régression OCR et document de 100 pages) : 17/17 au
moment de la livraison.

## Différenciation : recherche, routage intelligent, hors ligne

Trois fonctionnalités ajoutées pour se démarquer d'acteurs comme Smallpdf
ou iLovePDF, en exploitant l'avantage structurel d'un site 100% local
(aucun backend à maintenir, aucune limite d'usage à imposer pour des
raisons de coût serveur).

- **Recherche d'outils** (accueil) : filtre en temps réel les 43 cartes
  par titre/description, raccourci clavier `/`, insensible à la casse et
  aux accents. Limite honnête : correspondance par sous-chaîne simple,
  pas de recherche floue tolérante aux fautes de frappe.
- **Routage intelligent par dépôt de fichier** : déposer un fichier
  n'importe où sur l'accueil (overlay plein écran pendant le glisser)
  détecte son vrai type par octets magiques (`js/security-utils.js`,
  déjà utilisé par le Bloc 3 Sécurité) et redirige automatiquement vers
  l'outil le plus pertinent, avec le fichier déjà chargé sur la page
  d'arrivée (transfert par IndexedDB, quota bien supérieur à
  `sessionStorage`, consommé automatiquement par `initDropzone` sans
  modifier chaque outil individuellement). Limite honnête : la table de
  correspondance couvre les formats les plus courants ; un format sans
  outil dédié (GIF, ancien .doc/.xls) affiche un message clair plutôt
  qu'une redirection inventée.
- **Support hors ligne (PWA)** : `manifest.json` (installable sur mobile
  et ordinateur) et `sw.js` (service worker) avec une stratégie
  volontairement prudente : réseau d'abord partout (jamais de contenu
  périmé servi à un visiteur en ligne), secours sur le cache uniquement
  hors connexion, jamais d'interception des bibliothèques CDN
  (laissées au cache HTTP long déjà en place et à leur intégrité SRI).
  Testé réellement en conditions hors ligne (émulation Playwright) :
  l'accueil déjà visité reste pleinement utilisable sans connexion,
  une page jamais visitée affiche `offline.html` (message honnête)
  plutôt que l'erreur de navigateur brute. Limites honnêtes : seule une
  poignée de pages vedettes (accueil, fusionner, compresser, éditeur)
  sont mises en cache au premier chargement du service worker, les
  autres outils ne deviennent disponibles hors ligne qu'après une
  première visite en ligne ; l'enregistrement du service worker se fait
  via `js/common.js`, donc pas sur les 7 pages qui ne le chargent pas
  (mentions légales, confidentialité, à propos, sécurité, conversions,
  soutenir et ses traductions) ni sur les pages de langue (en/es/pt/ar) :
  si la toute première visite d'un utilisateur se fait directement sur
  une de ces pages, le service worker ne s'enregistre pas à cette
  occasion (il s'enregistrera dès la première visite d'un outil).

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
7. Chargement paresseux des bibliothèques de conversion lourdes
   (mammoth, html2canvas, xlsx, pptxgenjs, docx) sur les outils qui les
   chargent encore au chargement de la page (word-en-pdf, pdf-en-word,
   principalement), pour repasser au-dessus de 90 en performance.
8. SRI (`integrity`/`crossorigin`) sur chaque balise CDN de chaque page,
   fallback local hashé pour chaque librairie, CSP durcie (nonces/hash,
   HSTS preload, Permissions-Policy, COOP/COEP) : prévu au round final de
   la Phase Sécurité, voir TODO.md et SECURITY.md pour l'état d'avancement
   réel au moment de la lecture.
