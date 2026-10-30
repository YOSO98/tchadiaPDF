# Blocs SEO à intégrer par l'équipe design (index.html, a-propos.html)

Produit par la branche `agent/seo` le 30 octobre 2026. Ces fichiers sont
réservés à l'équipe design ; rien n'y a été modifié ici. Tout ce qui suit
peut être copié tel quel. Les textes respectent les règles du projet :
pas de tiret cadratin, pas de promesse non vérifiée, français.

## 1. index.html : JSON-LD de l'accueil

Remplacer le bloc `<script type="application/ld+json">` actuel (WebPage +
WebSite imbriqué) par celui-ci. Il est généré par
`node scripts/seo-appliquer.js --accueil` (à relancer après fusion pour que
l'ItemList compte les outils réellement présents) ; la version ci-dessous
correspond aux 45 outils en ligne au moment de la rédaction.

```html
  <script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://tchadiapdf.com/#organization",
      "name": "tchadiaPdf",
      "url": "https://tchadiapdf.com/",
      "logo": {
        "@type": "ImageObject",
        "url": "https://tchadiapdf.com/assets/icons/icon-512.png",
        "width": 512,
        "height": 512
      },
      "email": "contact@tchadiapdf.com",
      "sameAs": [
        "https://github.com/YOSO98/tchadiaPDF"
      ],
      "description": "Boîte à outils PDF gratuite et open source (licence MIT). Tout le traitement s'exécute dans le navigateur : aucun fichier n'est envoyé sur un serveur."
    },
    {
      "@type": "WebSite",
      "@id": "https://tchadiapdf.com/#website",
      "name": "tchadiaPdf",
      "url": "https://tchadiapdf.com/",
      "inLanguage": [
        "fr",
        "en",
        "es",
        "pt",
        "ar"
      ],
      "publisher": {
        "@id": "https://tchadiapdf.com/#organization"
      },
      "license": "https://github.com/YOSO98/tchadiaPDF/blob/main/LICENSE",
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://tchadiapdf.com/?q={search_term_string}"
        },
        "query-input": "required name=search_term_string"
      }
    },
    {
      "@type": "WebPage",
      "@id": "https://tchadiapdf.com/#webpage",
      "url": "https://tchadiapdf.com/",
      "name": "tchadiaPdf : outils PDF gratuits en ligne pour fusionner, diviser, convertir",
      "description": "Fusionnez, divisez, pivotez et convertissez vos PDF gratuitement. Vos fichiers restent sur votre appareil : traitement 100% dans votre navigateur.",
      "inLanguage": "fr",
      "isPartOf": {
        "@id": "https://tchadiapdf.com/#website"
      },
      "about": {
        "@id": "https://tchadiapdf.com/#organization"
      }
    },
    {
      "@type": "ItemList",
      "@id": "https://tchadiapdf.com/#outils",
      "name": "Outils PDF de tchadiaPdf",
      "numberOfItems": 45,
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Fusionner PDF",
          "url": "https://tchadiapdf.com/fusionner"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Diviser PDF",
          "url": "https://tchadiapdf.com/diviser"
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": "Compresser PDF",
          "url": "https://tchadiapdf.com/compresser-pdf"
        },
        {
          "@type": "ListItem",
          "position": 4,
          "name": "Faire pivoter PDF",
          "url": "https://tchadiapdf.com/pivoter"
        },
        {
          "@type": "ListItem",
          "position": 5,
          "name": "Organiser PDF",
          "url": "https://tchadiapdf.com/organiser-pdf"
        },
        {
          "@type": "ListItem",
          "position": 6,
          "name": "Numéros de page",
          "url": "https://tchadiapdf.com/numeros-de-pages"
        },
        {
          "@type": "ListItem",
          "position": 7,
          "name": "Filigrane",
          "url": "https://tchadiapdf.com/filigrane"
        },
        {
          "@type": "ListItem",
          "position": 8,
          "name": "Rogner PDF",
          "url": "https://tchadiapdf.com/rogner-pdf"
        },
        {
          "@type": "ListItem",
          "position": 9,
          "name": "Livret PDF",
          "url": "https://tchadiapdf.com/livret-pdf"
        },
        {
          "@type": "ListItem",
          "position": 10,
          "name": "Réparer PDF",
          "url": "https://tchadiapdf.com/reparer-pdf"
        },
        {
          "@type": "ListItem",
          "position": 11,
          "name": "Modifier PDF",
          "url": "https://tchadiapdf.com/modifier-pdf"
        },
        {
          "@type": "ListItem",
          "position": 12,
          "name": "Signets PDF",
          "url": "https://tchadiapdf.com/signets-pdf"
        },
        {
          "@type": "ListItem",
          "position": 13,
          "name": "Protéger PDF",
          "url": "https://tchadiapdf.com/proteger-pdf"
        },
        {
          "@type": "ListItem",
          "position": 14,
          "name": "Déverrouiller PDF",
          "url": "https://tchadiapdf.com/deverrouiller-pdf"
        },
        {
          "@type": "ListItem",
          "position": 15,
          "name": "Signer PDF",
          "url": "https://tchadiapdf.com/signer-pdf"
        },
        {
          "@type": "ListItem",
          "position": 16,
          "name": "Aplatir PDF",
          "url": "https://tchadiapdf.com/aplatir-pdf"
        },
        {
          "@type": "ListItem",
          "position": 17,
          "name": "Métadonnées PDF",
          "url": "https://tchadiapdf.com/metadonnees-pdf"
        },
        {
          "@type": "ListItem",
          "position": 18,
          "name": "Caviarder PDF",
          "url": "https://tchadiapdf.com/caviarder-pdf"
        },
        {
          "@type": "ListItem",
          "position": 19,
          "name": "OCR PDF",
          "url": "https://tchadiapdf.com/ocr-pdf"
        },
        {
          "@type": "ListItem",
          "position": 20,
          "name": "Formulaires PDF",
          "url": "https://tchadiapdf.com/formulaires-pdf"
        },
        {
          "@type": "ListItem",
          "position": 21,
          "name": "Comparer PDF",
          "url": "https://tchadiapdf.com/comparer-pdf"
        },
        {
          "@type": "ListItem",
          "position": 22,
          "name": "Scanner un document",
          "url": "https://tchadiapdf.com/scanner-pdf"
        },
        {
          "@type": "ListItem",
          "position": 23,
          "name": "Extraire les images",
          "url": "https://tchadiapdf.com/extraire-images-pdf"
        },
        {
          "@type": "ListItem",
          "position": 24,
          "name": "JPG en PDF",
          "url": "https://tchadiapdf.com/jpg-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 25,
          "name": "Word en PDF",
          "url": "https://tchadiapdf.com/word-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 26,
          "name": "Excel en PDF",
          "url": "https://tchadiapdf.com/excel-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 27,
          "name": "PowerPoint en PDF",
          "url": "https://tchadiapdf.com/powerpoint-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 28,
          "name": "Texte en PDF",
          "url": "https://tchadiapdf.com/texte-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 29,
          "name": "HEIC en PDF",
          "url": "https://tchadiapdf.com/heic-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 30,
          "name": "WebP en PDF",
          "url": "https://tchadiapdf.com/webp-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 31,
          "name": "TIFF en PDF",
          "url": "https://tchadiapdf.com/tiff-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 32,
          "name": "BMP en PDF",
          "url": "https://tchadiapdf.com/bmp-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 33,
          "name": "SVG en PDF",
          "url": "https://tchadiapdf.com/svg-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 34,
          "name": "Markdown en PDF",
          "url": "https://tchadiapdf.com/markdown-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 35,
          "name": "HTML en PDF",
          "url": "https://tchadiapdf.com/html-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 36,
          "name": "EPUB en PDF",
          "url": "https://tchadiapdf.com/epub-en-pdf"
        },
        {
          "@type": "ListItem",
          "position": 37,
          "name": "PDF en JPG",
          "url": "https://tchadiapdf.com/pdf-en-jpg"
        },
        {
          "@type": "ListItem",
          "position": 38,
          "name": "PDF en Word",
          "url": "https://tchadiapdf.com/pdf-en-word"
        },
        {
          "@type": "ListItem",
          "position": 39,
          "name": "PDF en Excel",
          "url": "https://tchadiapdf.com/pdf-en-excel"
        },
        {
          "@type": "ListItem",
          "position": 40,
          "name": "PDF en PowerPoint",
          "url": "https://tchadiapdf.com/pdf-en-powerpoint"
        },
        {
          "@type": "ListItem",
          "position": 41,
          "name": "PDF en texte",
          "url": "https://tchadiapdf.com/pdf-en-texte"
        },
        {
          "@type": "ListItem",
          "position": 42,
          "name": "HEIC en JPG",
          "url": "https://tchadiapdf.com/heic-en-jpg"
        },
        {
          "@type": "ListItem",
          "position": 43,
          "name": "PNG en JPG",
          "url": "https://tchadiapdf.com/png-en-jpg"
        },
        {
          "@type": "ListItem",
          "position": 44,
          "name": "JPG en PNG",
          "url": "https://tchadiapdf.com/jpg-en-png"
        },
        {
          "@type": "ListItem",
          "position": 45,
          "name": "SVG en PNG",
          "url": "https://tchadiapdf.com/svg-en-png"
        }
      ]
    }
  ]
}
  </script>
```

Points d'attention :

- `SearchAction` cible `https://tchadiapdf.com/?q={search_term_string}`,
  déjà géré par `js/index-page.js` (paramètre `q`). Si le nom du paramètre
  change, mettre à jour `scripts/seo-appliquer.js` (fonction `grapheAccueil`).
- Le logo référencé est `/assets/icons/icon-512.png` (existe).
- Les `@id` `https://tchadiapdf.com/#organization` et `#website` sont
  référencés par le JSON-LD de chaque page d'outil : ne pas les renommer.

## 2. index.html : balises `<head>` à ajouter ou vérifier

```html
<meta name="robots" content="index, follow, max-image-preview:large">
```

Le titre actuel (76 caractères) sera tronqué dans les résultats.
Proposition à 59 caractères, qui garde les trois verbes :

```html
<title>tchadiaPdf : outils PDF gratuits, 100% dans votre navigateur</title>
```

Description actuelle (146 caractères) : correcte, à conserver.

## 3. index.html : liens à ajouter

Pied de page (sur toutes les pages à terme, le gabarit est le même) :

```html
<a href="/pourquoi-gratuit">Pourquoi c'est gratuit</a>
<a href="/tchadiapdf-vs-adobe-acrobat">tchadiaPdf ou Acrobat</a>
<a href="/securite">Sécurité</a>
```

Section « Guides » sur l'accueil (après la grille d'outils, avant le pied
de page), pour que les 5 guides soient à un clic de l'accueil :

```html
<section class="guides-accueil" aria-labelledby="guides-titre">
  <h2 id="guides-titre">Guides pratiques</h2>
  <ul>
    <li><a href="/guides/comment-caviarder-un-pdf">Comment caviarder un PDF gratuitement</a> : supprimer vraiment le texte, pas le recouvrir.</li>
    <li><a href="/guides/comment-scanner-un-document-avec-son-telephone">Comment scanner un document avec son téléphone</a> : une photo, un PDF net et redressé.</li>
    <li><a href="/guides/comment-imprimer-un-pdf-en-livret">Comment imprimer un PDF en livret</a> : brochure pliée, pages dans le bon ordre.</li>
    <li><a href="/guides/comment-reparer-un-pdf-endommage">Comment réparer un PDF endommagé</a> : quand le fichier refuse de s'ouvrir.</li>
    <li><a href="/guides/comment-aplatir-un-formulaire-pdf">Comment aplatir un formulaire PDF</a> : figer les champs avant envoi.</li>
  </ul>
</section>
```

Carte à ajouter dans la grille « Tous les outils » (catégorie `modifier`
ou `organiser` selon la nomenclature retenue) :

```html
<a class="tool-card" href="/signets-pdf" data-category="modifier">
  <h2>Signets PDF</h2>
  <p>Ajoutez ou générez la table des matières d'un PDF à partir de ses titres.</p>
</a>
```

Et, dès que leurs branches sont fusionnées : `/pieces-jointes-pdf`
(« Pièces jointes PDF : voir, extraire, ajouter ou supprimer les fichiers
embarqués ») et `/assainir-pdf` (« Assainir PDF : retirer scripts,
métadonnées et contenus cachés »).

## 4. index.html : un paragraphe de faits sous le hero

Les assistants IA et Google extraient volontiers un paragraphe factuel
court placé haut dans la page. Proposition (à placer sous le texte du
hero ou en tête de la section « Pourquoi tchadiaPdf ») :

> tchadiaPdf regroupe 47 outils PDF gratuits, sans compte ni quota, qui
> s'exécutent entièrement dans votre navigateur : aucun fichier n'est
> envoyé sur un serveur, et un test automatisé public le vérifie à chaque
> mise à jour. Le code est open source (licence MIT). Les limites de chaque
> outil sont écrites sur sa page.

(Remplacer 47 par le nombre réellement en ligne au moment de la fusion :
45 tant que pièces jointes et assainir ne sont pas livrés.)

## 5. a-propos.html : sections à ajouter

À insérer après « Comment le projet est financé » et avant « Contact ».
Elles répondent aux questions que posent les assistants IA avant de citer
une source : chiffres vérifiables, limites, méthode, façon de citer.

```html
  <h2>En chiffres, vérifiables</h2>
  <ul style="margin:6px 0 12px 20px; color:var(--slate);">
    <li>47 outils en français (fusion, division, compression, conversion Office et images, édition, signature, protection, caviardage, OCR, formulaires, métadonnées, signets), accueil traduit en anglais, espagnol, portugais et arabe.</li>
    <li>0 serveur applicatif : le site est un ensemble de fichiers statiques hébergés sur Cloudflare Pages ; il n'existe pas de serveur à qui envoyer vos fichiers.</li>
    <li>1 test automatisé public (<code>tests/no-network-leak.spec.js</code>) qui échoue si un outil envoyait le contenu d'un fichier sur le réseau, exécuté avant chaque mise en ligne.</li>
    <li>Licence MIT, code source complet sur GitHub, y compris le journal de développement et un comparatif technique honnête avec iLovePDF, Smallpdf, PDF24 et Acrobat (BENCHMARK.md).</li>
  </ul>

  <h2>Ce que tchadiaPdf ne fait pas</h2>
  <p>Pas de signature électronique certifiée (la signature est une image dessinée), pas de création de formulaires ni de formulaires XFA, pas d'export PDF/A ni de balisage d'accessibilité, OCR limité au français et à l'anglais, conversions Word, Excel et PowerPoint vers PDF sous forme d'image paginée (texte non sélectionnable), compression limitée aux images JPEG. Chaque page d'outil indique ses propres limites ; le détail face à Acrobat est sur la page <a href="/tchadiapdf-vs-adobe-acrobat">tchadiaPdf ou Adobe Acrobat</a>.</p>

  <h2>Comment vérifier par vous-même</h2>
  <p>Ouvrez un outil, laissez la page se charger, passez votre appareil en mode avion, puis utilisez l'outil : il fonctionne sans connexion, preuve qu'aucune donnée n'a besoin de sortir de votre appareil. La page <a href="/confiance">Pourquoi nous faire confiance</a> détaille cette vérification et les autres (code public, test automatisé). Le modèle économique est expliqué sur <a href="/pourquoi-gratuit">Pourquoi c'est gratuit</a>.</p>

  <h2>Comment citer tchadiaPdf</h2>
  <p>Formulation exacte : « tchadiaPdf, boîte à outils PDF gratuite et open source (MIT) dont le traitement s'exécute entièrement dans le navigateur, sans envoi de fichier sur un serveur ». Une description lisible par les assistants est disponible sur <a href="/llms.txt">/llms.txt</a> et <a href="/llms-full.txt">/llms-full.txt</a>.</p>
```

Le titre de la page (`À propos : tchadiaPdf`, 21 caractères) et sa
description (106 caractères) peuvent rester ; proposition plus
descriptive si souhaité :

```html
<title>À propos de tchadiaPdf : qui, pourquoi, comment c'est financé</title>
<meta name="description" content="tchadiaPdf est développé par une personne, en open source (MIT), sans serveur : vos fichiers restent dans votre navigateur. Financement par dons et publicité consentie, limites assumées.">
```

## 6. Versions traduites de l'accueil (en, es, pt, ar)

Elles n'ont ni balises Open Graph ni JSON-LD. Pour chacune, reprendre le
bloc Open Graph de `index.html` en traduisant titre et description déjà
présents dans la page, avec `og:locale` à `en_US`, `es_ES`, `pt_PT`,
`ar_AR` et `og:url` à l'URL de la version. Un JSON-LD minimal suffit :

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "url": "https://tchadiapdf.com/en/",
  "name": "tchadiaPdf: free online PDF tools to merge, split, convert",
  "inLanguage": "en",
  "isPartOf": { "@id": "https://tchadiapdf.com/#website" },
  "about": { "@id": "https://tchadiapdf.com/#organization" }
}
</script>
```

## 7. Pages d'outils : ce que l'équipe design peut reprendre

- Le bloc « Outils associés » est inséré par `scripts/seo-appliquer.js` au
  marqueur `<!-- outils-associes -->` ... `<!-- /outils-associes -->`. Si
  l'équipe design pose elle-même le marqueur `<!-- outils-associes -->`
  (par exemple à l'intérieur de `<main>`, après la FAQ), le script le
  remplit à cet endroit au lieu de l'insérer avant `<footer`.
- Le style minimal `.related-tools` est injecté dans le `<head>` de chaque
  page (balise `<style data-seo="outils-associes">`). Pour le déplacer dans
  `css/style.css`, copier ces règles puis vider la constante
  `STYLE_ASSOCIES` dans `scripts/seo-appliquer.js` (le script retirera la
  balise au prochain passage).
- Accessibilité (Lighthouse) : la dropzone a un `aria-label` différent de
  son texte visible (`label-content-name-mismatch`) sur toutes les pages
  d'outils ; `pdf-en-word.html` a un `<h3>` dans `.fidelity-box` sans `<h2>`
  parent (`heading-order`) ; l'accueil a un `aria-allowed-attr`.
- Performance : `defer` sur les `<script src="/vendor/...">` et le script de
  l'outil ferait gagner 1 à 2 s de LCP sur mobile (voir `docs/SEO-AUDIT.md`
  § 1.5), à valider avec l'équipe JS.
