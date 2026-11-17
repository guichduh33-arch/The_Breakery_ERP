# ADR-038 — L'inventaire pose la quantité comptée, et le propriétaire finalise ce qu'il a compté

Date : 2026-11-17

Statut : décision de Mamat du 2026-11-09 (questions `S04` et `S05`, lot 3 du
registre des décisions rendues de `docs/audit-2026-11/04_QUESTIONS_CLARIFICATION.md`).
Texte rédigé le 2026-11-17 pour la tâche `S1-10` du master plan de finition.

## Décision

1. **La finalisation d'un inventaire pose le stock à la quantité comptée.**
   Le stock d'un produit compté vaut, après finalisation, exactement ce qui a
   été compté. La correction se calcule contre le stock du moment de la
   finalisation, et non contre le stock du moment où la ligne a été ajoutée.
   Une vente, une perte ou une production enregistrée pendant le comptage n'est
   donc plus comptée deux fois.

2. **L'écart du comptage reste visible.** L'écart entre l'attendu et le compté
   reste affiché sur la ligne et conservé avec le mouvement de stock. Il n'est
   plus ce qui est appliqué. Le mouvement applique la différence entre le compté
   et le stock lu à la finalisation ; c'est ce mouvement qui porte l'écriture
   comptable.

3. **Le propriétaire peut finaliser un inventaire qu'il a compté lui-même.**
   La séparation des tâches entre celui qui compte et celui qui finalise quitte
   l'inventaire. C'est un choix assumé : avec un seul compte propriétaire, la
   règle empêchait toute finalisation, et l'inventaire est le seul mécanisme qui
   résorbe l'écart entre le stock théorique et l'étagère.

## Ce qui ne change pas

- Seul le propriétaire finalise un inventaire.
- Le comptage à l'aveugle reste : un compteur qui n'est pas propriétaire ne voit
  ni l'attendu ni l'écart.
- La finalisation exige toujours la revue : un inventaire en cours de comptage ne
  se finalise pas.
- Chaque ligne doit être comptée, et l'auteur du comptage reste enregistré.

## Contexte

L'ADR-027 dit que la finalisation « corrige le stock qui fait autorité ». Le
code appliquait pourtant l'écart figé à l'ajout de la ligne au stock courant.
Exemple : attendu 4, compté 10, puis 3 reçus pendant le comptage. Le stock
finissait à 13 au lieu de 10.

La fonction de finalisation refusait aussi tout inventaire dont une ligne avait
été comptée par l'approbateur. En production, un seul compte a la qualité de
propriétaire. Aucun inventaire compté par ce compte ne pouvait donc être
finalisé.

## Conséquences

- La famille `finalize_opname` reçoit une nouvelle version, qui lit le stock de
  chaque produit sous verrou au moment de la finalisation.
- Une ligne sans écart au comptage peut émettre un mouvement, si le stock a bougé
  depuis. Une ligne avec écart peut n'en émettre aucun, si le stock égale déjà le
  compté.
- Les inventaires déjà finalisés gardent leurs mouvements d'origine.
- Les textes de l'écran d'inventaire ne parlent plus de revue « indépendante ».

## Réversibilité

Revenir à l'application de l'écart, ou rétablir la séparation des tâches,
demande un nouvel ADR et une nouvelle version de la fonction. Les mouvements
émis restent dans le ledger, qui est en ajout seul. Ils portent dans leurs
métadonnées l'attendu, le compté, l'écart du comptage et le stock lu à la
finalisation : l'effet de chaque finalisation reste reconstituable.
