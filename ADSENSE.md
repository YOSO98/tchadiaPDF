# Monétisation AdSense : guide d'activation

Ce document explique comment activer concrètement la publicité Google AdSense
sur tchadiaPdf, une fois le site déployé et public. Rien de ce qui est décrit
ici n'est activé par défaut : tant que les étapes ci-dessous ne sont pas
suivies, aucun code publicitaire réel ne se charge (voir `js/ads.js`).

## 1. Créer un compte Google AdSense et obtenir l'approbation

1. Le site doit d'abord être déployé et accessible publiquement (voir le
   déploiement Cloudflare Pages géré séparément). AdSense n'accepte pas les
   sites en développement local ou non indexables.
2. Créer un compte sur https://www.google.com/adsense/ avec l'adresse email
   du propriétaire du site.
3. Déclarer le nom de domaine exact du site (ex. `tchadiapdf.com` ou le
   sous-domaine Cloudflare Pages utilisé en attendant un domaine propre).
4. Conditions à remplir avant que Google n'approuve le compte :
   - Contenu original et substantiel (les pages d'outils, `a-propos.html`,
     la documentation, etc. comptent comme contenu).
   - Une politique de confidentialité accessible et à jour : voir
     `confidentialite.html`, qui doit mentionner explicitement l'usage de
     cookies publicitaires AdSense une fois celui-ci activé.
   - Navigation claire, site fonctionnel, pas de contenu interdit par les
     règles du programme AdSense (contenu illégal, trompeur, etc.).
   - Un volume de trafic minimal réel est recommandé (non garanti par Google
     comme critère officiel, mais un site tout juste mis en ligne sans aucun
     visiteur est plus susceptible d'être rejeté).
5. Google fournit ensuite un extrait de code de vérification (souvent une
   balise `<meta name="google-adsense-account" content="ca-pub-XXXX">` ou un
   script à coller sur toutes les pages) le temps de la revue. Cette étape de
   vérification est distincte de l'intégration finale décrite plus bas.
6. La revue peut prendre de quelques jours à plusieurs semaines. **Ne pas**
   activer `ADSENSE_CLIENT_ID` dans `js/ads.js` avant validation officielle du
   compte : un compte non approuvé qui sert déjà des annonces (ou tente de le
   faire) est un motif classique de rejet ou de suspension.

## 2. Ajouter le fichier `ads.txt` à la racine du site

Une fois le compte AdSense créé, Google fournit un identifiant éditeur au
format `pub-XXXXXXXXXXXXXXXX` (visible dans Compte > Informations sur le
compte). Il faut créer, à la racine du site (au même niveau que `index.html`),
un fichier texte brut nommé exactement `ads.txt` avec le contenu suivant :

```
google.com, pub-[À COMPLÉTER : identifiant éditeur AdSense], DIRECT, f08c47fec0942fa0
```

Remarques :
- `pub-[À COMPLÉTER : identifiant éditeur AdSense]` doit être remplacé par le
  vrai identifiant éditeur (ex. `pub-1234567890123456`), connu uniquement du
  propriétaire du compte AdSense. Ce document ne peut pas l'inventer.
- `f08c47fec0942fa0` est l'identifiant de certification Google standard pour
  AdSense (constant, ne pas modifier).
- Ce fichier doit être servi tel quel en `https://votre-domaine/ads.txt`
  (fichier statique à la racine, comme `index.html` ; sur Cloudflare Pages il
  suffit de le déposer dans le dossier publié).
- Sans `ads.txt` correct, Google peut afficher moins d'annonces ou refuser
  d'en servir du tout (protection anti-fraude "Authorized Digital Sellers").

## 3. Où coller le code du bloc publicitaire

Le site contient déjà, sur de nombreuses pages, des emplacements réservés :

```html
<div class="ad-slot" aria-hidden="true">Espace publicitaire</div>
```

Deux approches possibles :

### Approche déconseillée : éditer chaque page à la main

Remplacer manuellement le contenu de chaque `<div class="ad-slot">` par le
bloc `<ins class="adsbygoogle">...</ins>` fourni par Google. Fonctionne, mais
oblige à modifier des dizaines de fichiers HTML à chaque changement de code
publicitaire (nouveau slot, changement de format, etc.).

### Approche retenue : script centralisé `js/ads.js`

`js/ads.js` (déjà créé dans ce dépôt) fait ce travail automatiquement, sans
toucher au HTML de chaque page :

1. Au chargement d'une page, il vérifie si l'utilisateur a donné son
   consentement publicitaire (bandeau `js/consent-banner.js`, choix stocké
   dans `localStorage` sous la clé `tchadiapdf_ad_consent`).
2. Si le consentement n'a **pas** été donné : le script ne fait rien du tout.
   Aucune requête réseau vers Google, le placeholder "Espace publicitaire"
   reste affiché tel quel.
3. Si le consentement a été donné : le script charge dynamiquement
   `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js` avec le
   `client` configuré, puis transforme chaque `.ad-slot` de la page en un
   vrai bloc `<ins class="adsbygoogle" data-ad-client="..." data-ad-slot="..."
   data-ad-format="auto" data-full-width-responsive="true">`, et appelle
   `(adsbygoogle = window.adsbygoogle || []).push({})` pour chacun.

Pour activer réellement les annonces, il suffit donc de modifier **deux
constantes** en haut de `js/ads.js` (aucune autre page à toucher) :

```js
const ADSENSE_CLIENT_ID = "[À COMPLÉTER : ca-pub-XXXXXXXXXXXXXXXX]";
const ADSENSE_SLOT_ID = "[À COMPLÉTER : ID de bloc AdSense]";
```

- `ADSENSE_CLIENT_ID` : l'identifiant client complet fourni par AdSense
  (format `ca-pub-` suivi de chiffres), visible dans le code d'intégration
  que Google génère depuis le tableau de bord (Annonces > Par emplacement
  d'annonce, ou Aperçu du code du site).
- `ADSENSE_SLOT_ID` : l'identifiant du bloc d'annonce ("ad unit"). Un seul
  bloc responsive/automatique peut suffire pour tous les emplacements
  `.ad-slot` du site ; il est aussi possible de créer plusieurs blocs si l'on
  veut différencier les formats selon l'emplacement (à adapter dans
  `js/ads.js` si besoin, en passant un slot différent par appel).

## 4. Ordre des opérations avant mise en production

1. Déployer le site publiquement (sans publicités actives).
2. Créer le compte AdSense et attendre la validation officielle.
3. Une fois validé : renseigner l'identifiant éditeur dans `ads.txt` et les
   constantes `ADSENSE_CLIENT_ID` / `ADSENSE_SLOT_ID` dans `js/ads.js`.
4. Vérifier que le bandeau de consentement (`js/consent-banner.js`) et le
   chargement conditionnel fonctionnent (voir la procédure de test décrite
   dans le rapport de livraison de ce bloc).
5. Ne jamais activer le chargement réel des annonces avant l'étape 2 : un
   compte non validé qui sert déjà des annonces (même de test) est un motif
   fréquent de rejet ou de suspension AdSense pour trafic insuffisant ou
   contenu jugé non conforme lors de la revue.

## Rappel vie privée

Les publicités AdSense utilisent des cookies et un identifiant publicitaire
pour personnaliser le contenu montré. C'est la seule brique du site qui
introduit un traitement de données à caractère potentiellement personnel
(côté navigateur uniquement, jamais lié aux fichiers traités par les outils
PDF). C'est pourquoi son activation est strictement subordonnée au
consentement de l'utilisateur via le bandeau, conformément au RGPD. Voir
`confidentialite.html` pour le détail exposé aux visiteurs.
