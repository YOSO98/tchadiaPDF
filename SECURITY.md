# Politique de sécurité

tchadiaPdf est un site 100% statique, sans serveur applicatif ni base de
données : la surface d'attaque côté serveur est donc, par construction,
extrêmement réduite. Cela ne veut pas dire qu'elle est nulle : ce document
explique comment signaler un problème de sécurité, ce que le projet fait
déjà pour s'en prémunir, et où se situent honnêtement les limites de ces
mesures.

## Signaler une vulnérabilité

Merci de ne jamais divulguer publiquement une faille de sécurité potentielle
(par exemple via une issue GitHub classique) avant qu'elle ait pu être
corrigée. Deux façons de nous la signaler en privé :

1. **GitHub Security Advisories** (méthode préférée) : ouvrez un signalement
   privé directement depuis GitHub, visible uniquement par les mainteneurs
   du dépôt jusqu'à ce qu'ils décident de le publier.
   [github.com/YOSO98/tchadiaPDF/security/advisories/new](https://github.com/YOSO98/tchadiaPDF/security/advisories/new)
2. **Email** : [à compléter] (adresse de contact sécurité dédiée à mettre en
   place). En attendant, vous pouvez utiliser l'adresse générale
   contact@tchadiapdf.com en indiquant clairement "SECURITE" dans l'objet.

Merci d'inclure autant de détails que possible : les étapes pour reproduire
le problème, l'outil concerné, et l'impact potentiel selon vous.

### Délai de réponse

tchadiaPdf est un projet communautaire maintenu bénévolement : nous ne
pouvons pas garantir un support 24/7. Notre objectif, sans engagement
contractuel, est :

- un premier accusé de réception sous **7 jours ouvrés** ;
- une évaluation initiale de la gravité et un plan de correction communiqué
  dans les meilleurs délais raisonnables une fois la faille confirmée.

## Ce qui est déjà en place

La sécurité parfaite n'existe pas. Voici les mesures concrètes déjà prises
sur ce projet :

- **Architecture 100% locale** : il n'existe pas de serveur applicatif à qui
  envoyer les fichiers des utilisateurs ni de base de données à compromettre.
  Cela élimine par construction des classes entières de vulnérabilités
  côté serveur (injection, fuite de base de données, etc.).
- **Content-Security-Policy (CSP)** : des en-têtes de sécurité stricts
  (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`) sont appliqués à toutes les pages du site (voir le
  fichier `_headers`), limitant notamment les origines autorisées à charger
  du script ou du style.
- **Sous-ressource Integrity (SRI)** : le déploiement de l'attribut
  `integrity` sur les balises `<script>` chargées depuis des CDN externes
  est en cours (une passe finale dédiée), afin que le navigateur refuse
  d'exécuter une librairie dont le contenu ne correspondrait plus exactement
  à celui attendu.
- **Validation des fichiers en entrée** : les outils valident le type et,
  quand c'est possible, la structure des fichiers déposés avant de les
  traiter, afin de limiter les risques liés à des fichiers malformés ou
  conçus pour exploiter une librairie de traitement.
- **Tests automatisés de non-fuite réseau** : `tests/no-network-leak.spec.js`
  vérifie, en intégration continue, qu'aucun outil ne fait transiter le
  contenu d'un fichier traité vers le réseau. Voir aussi `securite.html`.
- **Audit des dépendances en continu** : `npm audit --audit-level=high` est
  exécuté à chaque intégration continue et fait échouer le pipeline en cas
  de vulnérabilité de sévérité haute ou critique dans les dépendances de
  développement. Dependabot (`.github/dependabot.yml`) surveille aussi
  chaque semaine les mises à jour disponibles pour ces dépendances et pour
  les actions GitHub utilisées dans la CI.

## Surface d'attaque résiduelle

Par honnêteté, voici ce que ces mesures ne couvrent pas entièrement :

- **Dépendances CDN tierces** : les outils chargent des librairies
  JavaScript (pdf-lib, pdf.js, JSZip, mammoth, etc.) depuis des CDN publics
  (cdnjs.cloudflare.com, cdn.jsdelivr.net). Un de ces CDN pourrait en théorie
  être compromis ; le SRI en cours de déploiement réduit ce risque sans
  l'éliminer complètement tant que son déploiement n'est pas terminé sur
  tous les outils.
- **Sécurité du navigateur de l'utilisateur** : tchadiaPdf ne peut rien
  garantir au-delà de ce qui se passe dans l'onglet du navigateur. Un
  navigateur ou un système compromis reste hors du contrôle du site.
- **Qualité du code des outils eux-mêmes** : le projet grandit rapidement
  (nouveaux outils ajoutés régulièrement). Un bug dans un outil futur reste
  possible malgré la revue de code et les tests automatisés existants.
  C'est précisément pour cette raison que le code reste ouvert à l'audit de
  quiconque, et que la suite de tests (notamment `no-network-leak.spec.js`)
  tourne en continu plutôt qu'une seule fois.

## État du scan de secrets (dernière vérification : juillet 2026)

Une recherche de motifs habituels de secrets (clés API, jetons, mots de
passe en dur, formats connus type `AKIA...`, `sk-...`, `ghp_...`, clés
privées PEM) a été effectuée sur l'ensemble de l'arborescence du dépôt ainsi
que sur tout l'historique Git (`git log -p --all`). Aucun secret n'a été
trouvé. Les seules occurrences des mots "password"/"secret"/"token"
détectées dans le code concernent des fonctionnalités légitimes des outils
(champs de mot de passe pour protéger/déverrouiller un PDF,
`PasswordException` de la librairie pdf.js, permission `id-token` standard
d'un workflow GitHub Actions) et ne constituent pas des secrets.

## État de `npm audit` (dernière vérification : juillet 2026)

`npm audit --audit-level=high` ne rapportait, au moment de la mise en place
de cette vérification en CI, **aucune vulnérabilité** dans les dépendances
de développement du projet (`@playwright/test`, `http-server`, `pdf-lib`).
Ce résultat évoluera avec le temps ; c'est justement pour le suivre en
continu que cette commande est désormais exécutée automatiquement à chaque
intégration continue et que Dependabot surveille les mises à jour
disponibles chaque semaine.

## Périmètre

Cette politique couvre le code source du dépôt
[tchadiaPDF](https://github.com/YOSO98/tchadiaPDF). Le site étant déployé en
continu depuis la branche principale, seule la dernière version publiée en
ligne est prise en charge : il n'existe pas d'anciennes versions à corriger
séparément.
