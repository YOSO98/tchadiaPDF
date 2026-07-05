# Où présenter tchadiaPdf

Ce fichier liste des communautés et plateformes pertinentes pour faire
connaître tchadiaPdf une fois le projet stabilisé (Phase Conversions et
Phase 6 terminées), avec pour chacune un texte de présentation prêt à
copier-coller. Les textes restent factuels : ils décrivent ce que fait le
site (outils PDF gratuits, traitement 100% dans le navigateur, code
source ouvert) sans superlatif ni promesse invérifiable. À adapter selon
les règles propres à chaque plateforme au moment de la publication (elles
changent avec le temps).

Avant de publier partout, relire le site avec un regard extérieur : liens
qui fonctionnent, description à jour, licence visible, capture d'écran
récente.

## Forums de développeurs génériques

### Hacker News (Show HN)

Hacker News a des règles précises pour les posts « Show HN » : le lien
doit pointer vers le projet lui-même (pas un article qui en parle), le
titre doit commencer par « Show HN: », et l'auteur est censé participer
activement aux commentaires après publication plutôt que se contenter de
poster puis disparaître.

Titre suggéré :

```
Show HN: tchadiaPdf, des outils PDF gratuits qui tournent entièrement dans le navigateur
```

Texte de présentation :

> tchadiaPdf est une boîte à outils PDF (fusionner, compresser, modifier
> le texte existant, convertir depuis/vers Word, Excel, PowerPoint,
> images, etc.) qui traite tous les fichiers directement dans le
> navigateur, sans jamais les envoyer sur un serveur. Le site est
> statique (HTML/CSS/JS sans backend), gratuit et le code source est
> publié sous licence MIT. Je suis preneur de retours, en particulier sur
> les limites actuelles (documentées dans BENCHMARK.md) et sur les cas
> d'usage qui ne fonctionnent pas encore bien.

### Reddit : r/opensource

Sous-reddit consacré aux projets open source. Bien préciser la licence et
le lien vers le dépôt dès le premier paragraphe ; éviter tout ton
publicitaire, ce sous-reddit est sensible à l'auto-promotion perçue comme
excessive.

> Je partage tchadiaPdf, un projet open source (licence MIT) : une boîte
> à outils PDF qui s'exécute entièrement dans le navigateur, sans
> backend et sans envoi de fichier vers un serveur. Le dépôt contient le
> code complet, un journal de développement (TODO.md) et une comparaison
> honnête avec les principaux concurrents, y compris les limites connues
> (BENCHMARK.md). Les contributions sont bienvenues, le guide est dans
> CONTRIBUTING.md.

### Reddit : r/webdev

Communauté plus large de développeurs web. Un angle technique (choix
d'architecture, bibliothèques utilisées côté client) est généralement
mieux reçu qu'un simple lien vers le produit.

> tchadiaPdf est un site 100% statique (aucun backend) qui propose des
> outils PDF (fusion, compression, édition de texte existant, conversion
> vers/depuis Office et images) en s'appuyant sur des bibliothèques qui
> s'exécutent côté client : pdf-lib, pdf.js, qpdf compilé en
> WebAssembly, Tesseract.js pour l'OCR. Le code est open source (MIT),
> je suis intéressé par des retours sur l'architecture ou des suggestions
> d'améliorations.

### Reddit : r/france

Communauté généraliste francophone. Poster dans un fil approprié
(discussion libre ou fil dédié aux projets perso selon les règles du
subreddit au moment de la publication) plutôt qu'en post principal si les
règles locales limitent l'auto-promotion.

> Je développe tchadiaPdf, un site français gratuit d'outils PDF
> (fusionner, compresser, modifier le texte d'un PDF existant, convertir
> vers Word/Excel/PowerPoint et inversement, etc.). Tout se passe dans le
> navigateur, aucun fichier n'est envoyé à un serveur. Le projet est open
> source (licence MIT), les retours et contributions sont les bienvenus.

## Communautés open source et découvrabilité

### dev.to

Plateforme d'articles techniques. Plutôt qu'un simple lien, un article
qui explique un choix technique précis (par exemple l'intégration de
qpdf en WebAssembly, ou la correspondance de police dans l'éditeur PDF)
fonctionne mieux qu'une annonce brute et donne un contexte utile aux
lecteurs.

> Titre d'article suggéré : « Comment j'ai implémenté un éditeur de texte
> PDF côté navigateur avec pdf.js et pdf-lib (et ses limites) ».
> Présentation courte à placer en introduction de l'article : tchadiaPdf
> est un site open source (MIT) d'outils PDF qui s'exécutent entièrement
> dans le navigateur. Cet article revient sur [choix technique précis],
> y compris ce qui ne fonctionne pas encore parfaitement.

### Product Hunt

Plateforme de lancement de produits. Nécessite des visuels soignés
(capture d'écran ou courte vidéo) et une description concise en anglais
(la majorité de l'audience est anglophone), même si le produit lui-même
est en français.

> tchadiaPdf is a free, open source (MIT licensed) PDF toolkit that runs
> entirely in the browser: merge, compress, edit existing text, convert
> to and from Word/Excel/PowerPoint and images, and more. No file is ever
> uploaded to a server. The interface is in French, with a partial
> English/Spanish/Portuguese/Arabic homepage.

### GitHub Explore / topics

Ajouter des topics pertinents sur le dépôt GitHub (par exemple : `pdf`,
`pdf-editor`, `open-source`, `javascript`, `webassembly`, `static-site`,
`privacy`) augmente la découvrabilité via la recherche et les pages
d'exploration de GitHub. Une description de dépôt claire et courte (une
phrase) et un fichier README soigné comptent aussi pour l'apparition dans
les listes GitHub Trending.

> Description de dépôt suggérée : « Boîte à outils PDF gratuite et open
> source, 100% côté navigateur, sans backend. »

## Communautés tech francophones et africaines

Plutôt que des liens précis (susceptibles de changer ou d'être erronés),
voici des types de communautés réelles à identifier au moment de la
publication, en cherchant les groupes actifs les plus pertinents pour ce
projet (développeurs web, JavaScript, outils gratuits/open source) :

- **Groupes Slack ou Discord francophones de développeurs** : de
  nombreuses communautés francophones de développeurs web et JavaScript
  ont des canaux dédiés au partage de projets personnels ou open source.
  Rechercher celles actives au moment de la publication et vérifier
  leurs règles de partage avant de poster.
- **Communautés et meetups tech africains** : plusieurs pays
  francophones d'Afrique ont des communautés de développeurs actives
  (meetups locaux, groupes d'utilisateurs, associations tech
  étudiantes ou professionnelles). Un outil gratuit, francophone, dont
  les fichiers ne sont jamais envoyés à un serveur (le traitement se
  fait localement dans le navigateur) peut avoir un intérêt particulier
  dans des contextes où la confidentialité des documents ou le coût de
  la bande passante sont des préoccupations importantes.
- **Groupes LinkedIn ou forums professionnels francophones** dédiés au
  développement web ou aux outils bureautiques gratuits.

Texte de présentation générique pour ces communautés (à adapter au ton de
chaque groupe) :

> tchadiaPdf est un site gratuit et open source (licence MIT) d'outils
> PDF : fusionner, compresser, modifier le texte d'un PDF existant,
> convertir vers ou depuis Word/Excel/PowerPoint et des formats d'image,
> et plus. Tout le traitement se fait directement dans le navigateur,
> aucun fichier n'est envoyé à un serveur. L'interface est en français.
> Le code source et les contributions sont sur GitHub.

## Après publication

- Répondre aux commentaires et questions dans les premières heures, en
  particulier sur Hacker News et Reddit où la fenêtre de visibilité est
  courte.
- Noter les retours récurrents (bugs, limites signalées) dans TODO.md ou
  sous forme d'issues GitHub plutôt que de les laisser se perdre dans les
  commentaires.
- Éviter de publier la même annonce identique sur toutes les plateformes
  le même jour : espacer les publications et adapter le texte au public
  de chaque plateforme, comme illustré ci-dessus.
