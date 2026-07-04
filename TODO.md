# TODO : plan de développement de tchadiaPdf

Ce fichier suit l'avancement du projet. Il est mis à jour au fur et à mesure.
Convention : `[x]` fait, `[ ]` à faire.

## 0. Base du projet

- [x] Corriger tous les tirets longs/moyens (—, –) déjà présents dans le site
- [x] Créer TODO.md (ce fichier)
- [ ] Créer README.md (présentation, structure, lancement local, déploiement Cloudflare Pages)
- [ ] Créer LICENSE (MIT)
- [ ] Créer CONTRIBUTING.md (règles du design system, comment proposer un outil)
- [ ] Créer .gitignore

## 1. Outils existants (à ne jamais casser)

- [x] fusionner.html / js/fusionner.js
- [x] diviser.html / js/diviser.js
- [x] pivoter.html / js/pivoter.js
- [x] jpg-en-pdf.html / js/jpg-en-pdf.js

## 2. Nouveaux outils à développer

Chaque outil = page HTML dédiée + fichier JS dans js/, réutilise js/common.js,
respecte le design system (blanc/bleu uniquement), tout en français, pas de
tiret long, gestion d'erreurs (protégé/corrompu/mauvais format/trop gros).

- [ ] 1. compresser-pdf : recompression des images JPEG embarquées (qualité faible/moyenne/forte), taille avant/après
- [ ] 2. organiser-pdf : miniatures, glisser-déposer pour réordonner, supprimer, dupliquer
- [ ] 3. numeros-de-pages : position (6 choix), taille, format (1 / 1 sur n / Page 1)
- [ ] 4. pdf-en-jpg : chaque page en JPG, téléchargement en ZIP (JSZip)
- [ ] 5. filigrane : texte ou image, opacité, position, sur toutes les pages
- [ ] 6. rogner-pdf : sélection de zone sur aperçu, appliqué à tout le document
- [ ] 7. proteger-pdf : chiffrement par mot de passe (RC4 128 bits, norme PDF standard security handler)
- [ ] 8. deverrouiller-pdf : suppression du mot de passe (rendu via pdf.js + reconstruction pdf-lib)
- [ ] 9. signer-pdf : dessin de signature sur canvas, placement sur la page
- [ ] 10. ocr-pdf : Tesseract.js (français + anglais), avertissement de lenteur, PDF "sandwich" recherchable
- [ ] 11. formulaires-pdf : détection et remplissage des champs AcroForm existants
- [ ] 12. comparer-pdf : deux fichiers côte à côte, différences visuelles page à page
- [ ] 13. scanner-pdf : capture photo (caméra ou fichier), correction de perspective (4 coins),
      filtres type document scanné (noir et blanc, contraste, couleur), multi-pages, export PDF
- [ ] 14. modifier-pdf : éditeur simple par-dessus les pages (ajout de texte, surlignage,
      formes, dessin libre), aperçu de chaque page, export du PDF annoté

## 3. Après chaque outil terminé

- [ ] Ajouter la carte sur index.html (retirer la classe "soon" le cas échéant)
- [ ] Vérifier le responsive mobile (grille, dropzone, options)
- [ ] Vérifier l'accessibilité clavier (tabindex, aria, focus visible)
- [ ] Mettre à jour le README (liste des outils disponibles)

## 4. Vérification finale

- [ ] Revue de code de tous les nouveaux fichiers (design system, sécurité, cohérence)
- [ ] Vérifier qu'aucun tiret long/moyen ne subsiste
- [ ] Vérifier que les 4 outils historiques fonctionnent toujours
- [ ] Vérification syntaxique de tous les fichiers JS
- [ ] Mise à jour finale de index.html et README.md

## Notes techniques

- Stack : HTML/CSS/JS statique, pdf-lib (édition PDF), pdf.js (rendu/lecture),
  Tesseract.js (OCR), JSZip (export ZIP pour pdf-en-jpg).
- pdf-lib ne supporte pas nativement le chiffrement PDF. Pour proteger-pdf,
  un petit module autonome `js/pdf-crypt.js` implémente le standard security
  handler PDF (MD5 + RC4, révision 3, clé 128 bits) en post-traitement des
  octets produits par pdf-lib. C'est un chiffrement standard reconnu par tous
  les lecteurs PDF (pas le plus moderne, mais robuste et sans dépendance
  externe). Pour deverrouiller-pdf, on s'appuie sur pdf.js (qui sait déjà
  déchiffrer RC4/AES avec le mot de passe) pour ré-afficher chaque page, puis
  on reconstruit un PDF non protégé à partir de ces pages.
- Pour compresser-pdf, on cible les images embarquées encodées en JPEG
  (filtre DCTDecode) via l'API bas niveau de pdf-lib ; les images non-JPEG
  sont laissées telles quelles pour rester fiable sur tous les PDF.
