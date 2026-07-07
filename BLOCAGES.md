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
