# DEPENDENCIES : bibliothèques auto-hébergées dans `vendor/`

tchadiaPdf est un site 100% statique : aucune de ces librairies n'est
installée via npm pour le site lui-même (le `package.json` du dépôt ne sert
qu'à l'outillage de développement : tests Playwright, scripts de vérification).

Depuis la migration vers `vendor/` (vague 1 du plan de parité Acrobat), chaque
librairie est **servie par tchadiapdf.com lui-même** depuis le dossier
`vendor/`, plus jamais depuis un CDN tiers (cdnjs, jsdelivr). Conséquences :

- aucune requête vers un domaine tiers pendant l'usage d'un outil, ce que le
  test `tests/no-network-leak.spec.js` vérifie désormais strictement (la liste
  des hôtes autorisés, construite depuis les balises `<script src>` du site,
  est vide) ;
- le site et sa suite de tests fonctionnent sans accès à Internet (CI,
  réseaux d'entreprise filtrés, hors ligne via le service worker) ;
- plus d'attribut `integrity` : la SRI protège contre un CDN compromis, elle
  est sans objet sur la même origine, et l'incohérence jsdelivr constatée
  sur `docx@8.5.0` disparaît ;
- la version fait partie du nom de fichier (`pdf-lib-1.17.1.min.js`), ce qui
  autorise un cache HTTP long et immuable (`_headers`, règle `/vendor/*`).

Les fichiers de `vendor/` sont copiés tels quels depuis les paquets npm
officiels (`npm pack <paquet>@<version>`), sans modification ; leurs licences
sont dans `vendor/licenses/`. Le script `scripts/migrer-vers-vendor.js`
documente la correspondance exacte URL CDN d'origine vers fichier local.
Pour mettre à jour une librairie : télécharger la nouvelle version depuis
npm, la déposer sous un nouveau nom versionné, mettre à jour les références
(`grep -r "vendor/<lib>-" *.html js/`), relancer `npm test`.

Cas particuliers :

- **Tesseract.js** : le moteur (`tesseract.min.js`, `worker.min.js`), le
  cœur WebAssembly (`core/tesseract-core-simd-lstm.wasm.js` et sa variante
  sans SIMD) et les données de langue français et anglais
  (`lang/fra.traineddata.gz`, `lang/eng.traineddata.gz`, variante
  `best_int` du paquet `@tesseract.js-data`) sont tous locaux : l'OCR ne
  fait plus aucune requête externe.
- **qpdf** (`qpdf-0.3.0/qpdf.js` + `qpdf.wasm`) et **fontkit** sont chargés
  paresseusement par `js/qpdf-engine.js` et `js/modifier-pdf.js`.
- **Polices Liberation** (`vendor/fonts/liberation/*.ttf`, licence SIL OFL
  1.1) : polices de substitution de l'éditeur, auparavant chargées depuis un
  dépôt GitHub via jsdelivr.

Convention : version exacte figée partout (jamais de `@latest`), pour que le
comportement du site ne change jamais sans une mise à jour explicite et
testée de ce dépôt.

## Bibliothèques JavaScript

| Librairie | Version figée | Licence | Source officielle | Usage |
|---|---|---|---|---|
| pdf-lib | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib | Lecture/écriture/assemblage de PDF (quasi tous les outils) |
| pdf.js | 3.11.174 | Apache-2.0 | https://github.com/mozilla/pdf.js | Rendu et extraction de texte des PDF |
| JSZip | 3.10.1 | MIT / GPLv3 (au choix) | https://github.com/Stuk/jszip | Lecture/écriture d'archives ZIP (exports par lot, PPTX, DOCX, XLSX, EPUB) |
| mammoth.js | 1.7.2 | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js | Lecture des fichiers DOCX (word-en-pdf) |
| SheetJS (xlsx) | 0.18.5 | Apache-2.0 | https://github.com/SheetJS/sheetjs | Lecture/écriture XLSX/CSV (excel-en-pdf, pdf-en-excel) |
| docx | 8.5.0 | MIT | https://github.com/dolanmiu/docx | Génération de fichiers DOCX (pdf-en-word) |
| pptxgenjs | 3.12.0 | MIT | https://github.com/gitbrent/PptxGenJS | Génération de fichiers PPTX (pdf-en-powerpoint) |
| html2canvas | 1.4.1 | MIT | https://github.com/niklasvh/html2canvas | Rasterisation HTML vers image (word/excel/powerpoint/markdown/html/epub-en-pdf) |
| marked | 11.1.1 | MIT | https://github.com/markedjs/marked | Rendu Markdown vers HTML (markdown-en-pdf) |
| epub.js | 0.3.93 | BSD-2-Clause | https://github.com/futurepress/epub.js | Lecture de fichiers EPUB (epub-en-pdf) |
| UTIF.js | 3.1.0 | MIT | https://github.com/photopea/UTIF.js | Décodage TIFF multi-pages (tiff-en-pdf) |
| heic2any | 0.0.4 | MIT | https://github.com/alexcorvi/heic2any | Conversion HEIC vers JPEG (heic-en-jpg, heic-en-pdf) |
| Tesseract.js | 5.1.1 | Apache-2.0 | https://github.com/naptha/tesseract.js | OCR (ocr-pdf, repli OCR de pdf-en-texte et modifier-pdf) |
| @pdf-lib/fontkit | 1.1.1 | MIT | https://github.com/Hopding/fontkit | Sous-ensemble et embarquement de polices dans le PDF (modifier-pdf) |
| @neslinesli93/qpdf-wasm | 0.3.0 | ISC (wrapper) / Apache-2.0 (qpdf) | https://github.com/neslinesli93/qpdf-wasm | Chiffrement AES-256, réparation PDF (proteger/deverrouiller/reparer-pdf) |

## Paquet de signature PAdES (généré, dans vendor/)

Comme toutes les bibliothèques du site, celles de la signature numérique
PAdES de `signer-pdf` sont servies depuis notre domaine. Elles forment un
paquet unique
`vendor/pades-libs.min.js`, chargé à la demande (option cochée) avec un
attribut `integrity` SRI. Ce fichier est généré par
`npm run vendor-pades` (`scripts/build-vendor-pades.js`, esbuild), qui met
aussi à jour l'URL `?v=hash` et l'empreinte SRI dans `js/pades.js` et
regroupe les licences dans `vendor/LICENSES-pades.txt`. Le site lui-même
reste sans étape de build : ce script ne tourne qu'à la mise à jour
volontaire de ces dépendances (versions figées dans `package.json`).

| Librairie | Version figée | Licence | Source officielle | Usage |
|---|---|---|---|---|
| pkijs | 4.0.1 | BSD-3-Clause | https://github.com/PeculiarVentures/PKI.js | Lecture PKCS#12, construction et vérification CMS |
| asn1js | 4.0.0 | BSD-3-Clause | https://github.com/PeculiarVentures/ASN1.js | Encodage/décodage ASN.1 DER |
| @signpdf/signpdf | 4.0.0 | MIT | https://github.com/vbuch/node-signpdf | Calcul du `/ByteRange` et insertion de la signature |
| @signpdf/placeholder-pdf-lib | 4.0.0 | MIT | https://github.com/vbuch/node-signpdf | Champ et dictionnaire de signature avec pdf-lib |
| @signpdf/utils | 4.0.0 | MIT | https://github.com/vbuch/node-signpdf | Constantes et classe Signer |
| buffer | 6.0.3 | MIT | https://github.com/feross/buffer | Équivalent navigateur de `Buffer` (utilisé par @signpdf) |

Dépendances transitives embarquées : @noble/hashes, @peculiar/utils,
bytestreamjs, base64-js, ieee754 (licences complètes dans
`vendor/LICENSES-pades.txt`). pdf-lib n'est pas dupliqué : le paquet
réutilise le `PDFLib` déjà chargé par la page.

## Polices

| Police | Source | Licence | Usage |
|---|---|---|---|
| Inter | fonts.googleapis.com (Google Fonts) | SIL OFL 1.1 | Police d'interface du site |
| Liberation Sans/Serif/Mono | `cdn.jsdelivr.net/gh/shantigilbert/liberation-fonts-ttf@master/` (miroir TTF du projet officiel Liberation Fonts) | SIL OFL 1.1 | Police de substitution embarquée dans le PDF lors de l'édition de texte (modifier-pdf), métriques compatibles Arial/Times New Roman/Courier New |

## Exception SRI vérifiée : docx@8.5.0

`https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js` (utilisé
par `pdf-en-word.html`) n'a PAS d'attribut `integrity` (SRI), contrairement
à toutes les autres bibliothèques CDN de ce projet. Ce n'est pas un oubli :
vérifié en conditions réelles (rechargements successifs, requêtes HTTP
directes), ce fichier a été observé avec DEUX contenus différents (donc
deux hachages SHA-384 différents, `sha384-TcLTgu6f...` et
`sha384-Fycsog...`) selon le nœud périphérique jsdelivr qui répond, alors
que la version est pourtant figée (`@8.5.0`, cense être immuable par
principe chez jsdelivr). Un attribut `integrity` fixe ferait donc échouer
le chargement de façon aléatoire selon le nœud CDN qui répond à chaque
visiteur, ce qui serait pire que l'absence de SRI. À revérifier
périodiquement (l'incohérence peut se résorber avec le temps côté
jsdelivr) ; en attendant, ce fichier reste sans SRI en connaissance de
cause.

## Note sur les fallbacks locaux

Chaque librairie ci-dessus est un candidat au fallback local (copie du
fichier minifié servie directement par tchadiaPdf si le CDN est
injoignable), prévu au Bloc 2 de la Phase Sécurité. Voir `SECURITY.md` et
`_headers` pour l'état d'avancement réel de cette protection au moment de
la lecture de ce document : elle n'est pas nécessairement complète pour
toutes les librairies listées ici, ne présumez pas qu'un fallback existe
sans le vérifier.

## Mise à jour de ce fichier

Toute nouvelle librairie CDN ajoutée à une page du site doit être ajoutée
ici dans le même commit, avec sa version exacte, sa licence et sa source
officielle vérifiée.
