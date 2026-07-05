## Description

Décrivez brièvement ce que fait cette pull request et pourquoi.

## Type de changement

- [ ] Nouvel outil
- [ ] Correction de bug
- [ ] Amélioration d'un outil existant
- [ ] Documentation
- [ ] Autre (précisez) :

## Checklist

- [ ] Le traitement des fichiers reste entièrement dans le navigateur
      (aucun envoi vers un serveur ou une API tierce)
- [ ] Le design system est respecté : uniquement blanc (`#FFFFFF`) et
      bleu (`#2563EB`/`#1D4ED8`/`#EFF6FF`), pas d'autre couleur ni dégradé
- [ ] Les composants CSS existants ont été réutilisés (`css/style.css`)
      plutôt que dupliqués
- [ ] Aucun tiret cadratin ni demi-cadratin n'a été introduit, dans le
      code, les commentaires ou la documentation
- [ ] Tout le texte visible par l'utilisateur est en français
- [ ] Testé manuellement dans un navigateur (dropzone, responsive mobile,
      navigation au clavier)
- [ ] Testé avec `npx playwright test` si la suite de tests est présente
      dans le dépôt au moment de cette contribution
- [ ] Les erreurs (fichier corrompu, mauvais format, mot de passe, etc.)
      affichent un message clair via `showMsg()`, jamais une erreur brute
- [ ] `README.md` et `TODO.md` mis à jour si un outil a été ajouté ou
      modifié
- [ ] Aucun autre outil du site n'a été cassé par ce changement

## Captures d'écran (si pertinent)

Ajoutez une capture d'écran avant/après si le changement est visuel.

## Contexte additionnel

Toute autre information utile pour la relecture.
