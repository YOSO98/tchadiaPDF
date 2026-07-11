# BLOCAGES

Ce fichier consigne les tâches abandonnées après 3 échecs consécutifs, ou les reculs (`git revert`) suite à une régression détectée par les tests Playwright. Convention : une entrée par blocage, avec la tâche concernée, ce qui a été essayé, et pourquoi c'est resté bloqué.

## Refonte de modifier-pdf.js : premier essai interrompu, fichier restaure (pas un abandon definitif)

Le sous-agent charge de la refonte professionnelle de l'editeur a ete
interrompu par une limite de session API avant d'avoir termine ni commite
la moindre sous-partie (il etait en train d'ecrire le nouveau moteur JS en
une seule fois plutot que par etapes commitees, malgre la consigne
contraire). Resultat : `js/modifier-pdf.js` a ete laisse dans un etat
casse (`ReferenceError: continues_below is not defined`, un marqueur de
troncature laisse dans le fichier). Detecte par un test de sanite
Playwright (guardrail : tester apres chaque modification), corrige
immediatement par `git checkout -- js/modifier-pdf.js` pour revenir au
dernier commit propre, reverifie fonctionnel (0 erreur).

Ce n'est pas un abandon de la tache : l'agent est relance avec une
consigne corrigee (committer reellement apres CHAQUE sous-partie, pas
seulement a la fin), pour qu'une interruption future ne perde jamais plus
qu'une sous-partie de travail.

## PDF/A (pdf-a.html) : non tente, risque de conformite non maitrisable dans le temps disponible

Contrairement aux blocages ci-dessus, il ne s'agit pas d'un echec apres 3
tentatives : la tache n'a volontairement pas ete commencee, pour ne pas
livrer un outil qui affiche "conforme PDF/A" sans l'etre reellement.

Ce qui rend la tache dure, au-dela d'une simple conversion :
- pdf-lib n'a aucun support PDF/A integre (pas d'ecriture du profil ICC
  de sortie, pas de generation du paquet XMP avec le schema
  `pdfaid:part`/`pdfaid:conformance` requis, pas de verification que les
  polices sont toutes reellement incorporees en sous-ensemble complet,
  pas de detection de transparence non autorisee selon la sous-norme
  visee (1b/2b/3b)).
- Un "convertisseur" qui se contente de re-enregistrer le PDF et
  d'ajouter des metadonnees XMP sans verifier ces contraintes produirait
  un fichier qui *pretend* etre PDF/A sans l'etre : pire qu'une absence
  d'outil pour un usage d'archivage legal, exactement le cas ou le
  cahier des charges demande un "rapport de verification de conformite"
  en plus de la conversion.
- Une verification de conformite serieuse necessiterait soit un moteur
  de validation type veraPDF (aucun equivalent JS/WASM leger identifie
  a la volee, licence/poids a valider), soit reimplementer un sous-
  ensemble non trivial des regles ISO 19005, hors de portee d'une
  passe unique sans risque de faux-positifs de conformite.

Recommandation pour une prochaine session dediee : commencer par une
recherche cibree (bibliotheque WASM de validation PDF/A existante,
licence MIT/Apache compatible) avant d'ecrire le moindre code, plutot
que de partir directement sur l'implementation.

## Traitement par lot (lot.html) : non tente, ordre de la mission respecte

Le cahier des charges demande un traitement Phase 3 "dans cet ordre, un
par un" : PDF/A est la tache precedente dans cet ordre et n'a pas ete
faite (voir ci-dessus). Traitement par lot n'a donc pas ete commence non
plus, pour ne pas sauter un element de la sequence demandee. Contrairement
a PDF/A, cette tache ne presente pas de difficulte de conformite/
correction similaire : le site a deja plusieurs exemples fonctionnels de
files d'attente multi-fichiers avec pause/annulation/export ZIP
(`js/compresser-pdf.js`, `js/rogner-pdf.js`) directement reutilisables
comme point de depart pour une prochaine session.

## OCR en arabe : non tente, explicitement conditionnel dans la mission

Le cahier des charges le place apres "si tout est termine", et PDF/A et
le traitement par lot ne le sont pas : non commence, conformement a la
consigne elle-meme plutot qu'a un blocage technique. Note pour plus
tard : Tesseract.js supporte "ara" nativement (meme mecanisme de
telechargement de donnees de langue que le francais/anglais deja geres
dans `js/ocr-pdf.js`) ; la detection automatique de langue demanderait
en plus soit `osd` (orientation and script detection) de Tesseract, soit
une heuristique simple sur les caracteres Unicode du texte deja extrait
par la premiere passe.
