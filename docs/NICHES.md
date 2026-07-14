# Stratégie de niches : les 15 portes d'entrée les plus réalistes

Date : 2026-07-14. Méthode : recherche réelle (Google, requêtes en
français) sur un échantillon de candidats avant de figer la liste,
plutôt qu'une supposition a priori.

## Constat honnête avant la liste

La prémisse initiale de ce document ("des outils avec le MOINS de
concurrence directe") ne résiste pas à la vérification : **aucune**
requête PDF en français n'est réellement sans concurrence. Recherche
faite sur 8 candidats, y compris les plus nichés a priori (aplatir un
formulaire, HEIC en PDF, EPUB en PDF, caviarder un PDF, Markdown en
PDF...) : dans chaque cas, les 10 premiers résultats sont occupés par
les mêmes poids lourds multi-outils (Smallpdf, iLovePDF, PDF24,
Adobe Acrobat, PDF2Go, Convertio, FreePDFConvert, PDFgear...). Ces
plateformes proposent des centaines d'outils chacune et cumulent une
autorité de domaine que tchadiaPdf ne peut pas rattraper à court terme,
quel que soit l'outil choisi.

**Conclusion stratégique** : la vraie opportunité n'est pas de trouver
une requête sans concurrent, mais de gagner sur ce que ces plateformes
génériques négligent structurellement :

1. **Le volume plus faible protège autant que l'absence de
   concurrence.** Les pages "Fusionner PDF" ou "Compresser PDF" des
   géants sont soignées et poussées (fort volume de recherche, gros
   enjeu). Leurs pages "EPUB en PDF" ou "aplatir un formulaire" sont
   souvent des pages génériques, peu différenciées, avec un contenu
   minimal, produites à la chaîne pour couvrir un maximum d'outils :
   c'est là que du contenu réellement soigné peut faire la différence,
   même sans autorité de domaine comparable.
2. **La longue traîne et les cas d'usage précis** ne sont couverts par
   aucun de ces sites (vérifié : la recherche "fusionner PDF pour
   dossier visa taille limite" ne retourne que des pages génériques de
   fusion, aucune page dédiée au cas d'usage). C'est le terrain le plus
   réaliste pour tchadiaPdf : des questions précises, avec une intention
   claire, que personne d'autre ne traite spécifiquement en français.
3. **L'honnêteté du contenu** (limites réelles documentées, FAQ
   précises plutôt que génériques) est un signal de qualité que Google
   valorise et qu'un site produit en masse ne peut pas reproduire
   facilement à l'échelle de centaines d'outils.

C'est la stratégie du judoka annoncée par la mission : ne pas chercher à
déplacer un poids que nous ne pouvons pas déplacer (l'autorité de
domaine sur les requêtes à fort volume), mais utiliser la spécificité
et la précision comme levier sur les requêtes à plus faible volume et
sur la longue traîne.

## Les 15 pages retenues

| # | Outil | Pourquoi celui-ci |
|---|---|---|
| 1 | `livret-pdf.html` | Intention très spécifique (impression pliée), utile aux associations et écoles, peu de pages dédiées à ce cas précis (la plupart des concurrents la noient dans "imposition PDF" générique) |
| 2 | `caviarder-pdf.html` | Intention à fort enjeu (confidentialité), où l'honnêteté sur la méthode (voir `caviarder-pdf.html` : suppression réelle du texte, pas un cache visuel) est un vrai différenciateur face à des pages génériques |
| 3 | `markdown-en-pdf.html` | Audience technique (développeurs, rédacteurs), peu servie par les gros généralistes qui traitent le Markdown comme un format mineur parmi cent autres |
| 4 | `pdf-en-powerpoint.html` | Cas d'usage concret (réutiliser un PDF pour une présentation), moins couvert que la conversion inverse (PowerPoint → PDF, elle très disputée) |
| 5 | `epub-en-pdf.html` | Audience de niche (lecteurs, associations culturelles), faible volume mais intention très claire |
| 6 | `comparer-pdf.html` | Utile à un public précis (juristes, relecteurs, enseignants comparant des versions), déjà identifié par la recherche comme traité de façon générique par les concurrents |
| 7 | `extraire-images-pdf.html` | Cas d'usage concret et récurrent (récupérer des photos d'un PDF scanné ou d'un rapport), peu mis en avant par les généralistes |
| 8 | `aplatir-pdf.html` | Terme technique peu connu du grand public : bonne opportunité de vulgarisation (expliquer ce que "aplatir" veut dire concrètement) |
| 9 | `heic-en-pdf.html` | Usage grand public direct (photos iPhone), volume correct mais intention très concrète et bien identifiable |
| 10 | `heic-en-jpg.html` | Même logique que ci-dessus, complémentaire (tout le monde ne veut pas un PDF, certains veulent juste un JPG lisible partout) |
| 11 | `scanner-pdf.html` | Cas d'usage administratif fort (numériser une pièce justificative au téléphone), différenciateur réel : correction de perspective 4 coins, peu courante chez les concurrents gratuits |
| 12 | `reparer-pdf.html` | Intention de dépannage précise et anxiogène ("mon PDF ne s'ouvre plus") : contenu rassurant et clair a un vrai impact ici |
| 13 | `numeros-de-pages.html` | Fonction précise recherchée telle quelle (mémoires, thèses, dossiers administratifs), indépendamment des outils de fusion/édition plus généraux |
| 14 | `tiff-en-pdf.html` | Audience de niche (archivage, numérisation professionnelle), très peu de contenu dédié en français |
| 15 | `svg-en-pdf.html` | Audience technique (designers, développeurs), quasiment absente des discours des généralistes grand public |

## Ce qui a été fait pour ces 15 pages

Voir le commit dédié : enrichissement du contenu (FAQ précises,
intention de recherche affinée, cas d'usage concrets francophones et
administratifs où c'est naturel) sur les 15 pages. 5 d'entre elles
reçoivent en plus un mini-guide dédié dans `guides/`, ciblant une
requête "comment + tâche" précise (voir la liste dans le rapport final).
