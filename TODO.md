# TODO : plan de développement de tchadiaPdf

Ce fichier suit l'avancement du projet. Il est mis à jour au fur et à mesure.
Convention : `[x]` fait, `[ ]` à faire.

**État : tous les outils prévus sont livrés et vérifiés (18 outils actifs).**

## 0. Base du projet

- [x] Corriger tous les tirets longs/moyens (—, –) déjà présents dans le site
- [x] Créer TODO.md (ce fichier)
- [x] Créer README.md (présentation, structure, lancement local, déploiement Cloudflare Pages)
- [x] Créer LICENSE (MIT)
- [x] Créer CONTRIBUTING.md (règles du design system, comment proposer un outil)
- [x] Créer .gitignore

## 1. Outils existants (à ne jamais casser)

- [x] fusionner.html / js/fusionner.js
- [x] diviser.html / js/diviser.js
- [x] pivoter.html / js/pivoter.js
- [x] jpg-en-pdf.html / js/jpg-en-pdf.js

## 2. Nouveaux outils développés

Chaque outil = page HTML dédiée + fichier JS dans js/, réutilise js/common.js,
respecte le design system (blanc/bleu uniquement), tout en français, pas de
tiret long, gestion d'erreurs (protégé/corrompu/mauvais format/trop gros).

- [x] 1. compresser-pdf : recompression des images JPEG embarquées (qualité faible/moyenne/forte), taille avant/après, Web Worker + Annuler
- [x] 2. organiser-pdf : miniatures, glisser-déposer pour réordonner, supprimer, dupliquer
- [x] 3. numeros-de-pages : position (6 choix), taille, format (1 / 1 sur n / Page 1)
- [x] 4. pdf-en-jpg : chaque page en JPG, téléchargement en ZIP (JSZip)
- [x] 5. filigrane : texte ou image, opacité, position, sur toutes les pages
- [x] 6. rogner-pdf : sélection de zone sur aperçu, appliqué à tout le document
- [x] 7. proteger-pdf : chiffrement par mot de passe (RC4 128 bits, norme PDF standard security handler)
- [x] 8. deverrouiller-pdf : suppression du mot de passe (rendu via pdf.js + reconstruction pdf-lib)
- [x] 9. signer-pdf : dessin de signature sur canvas, placement sur la page
- [x] 10. ocr-pdf : Tesseract.js (français + anglais), avertissement de lenteur, PDF "sandwich" recherchable
- [x] 11. formulaires-pdf : détection et remplissage des champs AcroForm existants
- [x] 12. comparer-pdf : deux fichiers côte à côte, différences visuelles page à page
- [x] 13. scanner-pdf : capture photo (caméra ou fichier), correction de perspective (4 coins,
      homographie calculée à la main), filtres type document scanné, multi-pages, export PDF
- [x] 14. modifier-pdf : éditeur par-dessus les pages (texte, surlignage, formes, dessin libre),
      export du PDF annoté avec les pages d'origine restées vectorielles

## 3. Après chaque outil terminé

- [x] Ajouter la carte sur index.html (18 cartes actives, plus aucune classe "soon")
- [x] Vérifier le responsive mobile (grille, dropzone, options) : validé par capture d'écran à 375px
- [x] Vérifier l'accessibilité clavier (tabindex, aria, focus visible)
- [x] Mettre à jour le README (liste des outils disponibles)

## 4. Vérification finale

- [x] Revue de code de tous les nouveaux fichiers (design system, sécurité, cohérence) : revue
      dédiée effectuée, deux bugs corrigés (voir Journal ci-dessous)
- [x] Vérifier qu'aucun tiret long/moyen ne subsiste (recherche automatisée sur tout le dépôt)
- [x] Vérifier que les 4 outils historiques fonctionnent toujours (testé dans un vrai navigateur
      avec Playwright : fusion, division, rotation, conversion JPG en PDF)
- [x] Vérification syntaxique de tous les fichiers JS (node --check)
- [x] Test de bout en bout dans un vrai navigateur (Playwright + Chromium headless) pour les 18
      outils : chargement, interaction, génération de fichier, absence d'erreur console
- [x] Mise à jour finale de index.html et README.md

## Journal des corrections issues de la revue de code

- `js/compresser-pdf.worker.js` : les images JPEG recompressées (CMJN ou niveaux de gris à
  l'origine) n'avaient pas leur `/ColorSpace` remise à `/DeviceRGB`, ce qui pouvait produire des
  couleurs incorrectes à la lecture. Corrigé : `/ColorSpace`, `/BitsPerComponent` et `/Decode`
  sont normalisés après recompression.
- `js/ocr-pdf.js` : une annulation déclenchée pendant l'initialisation du worker Tesseract ne
  l'arrêtait pas (fuite de Web Worker). Corrigé : le worker est explicitement terminé si
  l'annulation a eu lieu pendant son initialisation.
- `js/signer-pdf.js` : le calcul d'échelle pixels vers points PDF utilisait la résolution interne
  du canvas au lieu de sa taille CSS affichée, source d'un décalage possible sur très petit écran.
  Corrigé pour utiliser `getBoundingClientRect()`, cohérent avec les autres outils.
- `js/scanner-pdf.js` : nettoyage d'un résidu de code sans effet (ternaire dont les deux branches
  étaient identiques).

## Notes techniques

- Stack : HTML/CSS/JS statique, pdf-lib (édition PDF), pdf.js (rendu/lecture),
  Tesseract.js (OCR), JSZip (export ZIP pour pdf-en-jpg et pdf-en-jpg).
- pdf-lib ne supporte pas nativement le chiffrement PDF. Pour proteger-pdf,
  un petit module autonome `js/pdf-crypt.js` implémente le standard security
  handler PDF (MD5 + RC4, révision 3, clé 128 bits) en post-traitement des
  octets produits par pdf-lib. C'est un chiffrement standard reconnu par tous
  les lecteurs PDF (pas le plus moderne, mais robuste et sans dépendance
  externe). Validé avec pikepdf (ouverture refusée sans mot de passe, acceptée
  avec le bon mot de passe, y compris accentué). Pour deverrouiller-pdf, on
  s'appuie sur pdf.js (qui sait déjà déchiffrer RC4/AES avec le mot de passe)
  pour ré-afficher chaque page, puis on reconstruit un PDF non protégé à
  partir de ces pages.
- Pour compresser-pdf, on cible les images embarquées encodées en JPEG
  (filtre DCTDecode) via l'API bas niveau de pdf-lib ; les images non-JPEG
  sont laissées telles quelles pour rester fiable sur tous les PDF.
- Pour scanner-pdf, la correction de perspective (transformation projective à
  partir de 4 points) est implémentée à la main (élimination de Gauss-Jordan
  pour résoudre l'homographie), sans bibliothèque de vision par ordinateur.

## Pistes d'amélioration futures (non bloquantes)

- Détection automatique des bords dans scanner-pdf (actuellement l'utilisateur
  positionne les 4 coins manuellement).
- Interpolation bilinéaire pour le redressement de perspective (actuellement
  plus proche voisin).
- Permissions PDF détaillées pour proteger-pdf (actuellement toutes les
  permissions sont accordées par défaut, pas de restriction d'impression/copie
  configurable).
