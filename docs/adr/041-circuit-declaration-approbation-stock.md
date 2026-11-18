# ADR-041 — Les ajustements et pertes de stock passent par déclaration puis approbation

Date : 2026-11-18

Statut : décision de Mamat du 2026-11-09 (question `S06`, lot 10 du registre des
décisions rendues de `docs/audit-2026-11/04_QUESTIONS_CLARIFICATION.md`, réponse
**[A] Graver la règle dans un ADR**). Texte rédigé le 2026-11-18 pour la tâche
`S1-20` du master plan de finition.

## Décision

1. **Un ajustement ou une perte de stock est d'abord déclaré, puis approuvé.**
   La déclaration ne touche pas le stock général. Le stock ne bouge qu'à
   l'approbation.

2. **L'approbation revient au propriétaire, et à une personne différente du
   déclarant.** Le propriétaire approuve ou rejette. Personne n'approuve ni ne
   rejette sa propre déclaration.

3. **Pendant l'attente, le stock et la comptabilité surévaluent la
   marchandise.** Une perte déclarée et non encore approuvée reste comptée en
   stock et au grand livre. C'est la conséquence assumée du circuit.

4. **Pas d'alerte automatique** sur la file des déclarations en attente
   (cohérent avec la décision `X05`, qui retire la promesse d'envoi de
   notifications).

5. **La file se traite selon une cadence définie.** La décision `S06` demande de
   définir cette cadence. **Sa valeur n'est pas fixée** au 2026-11-18 : aucune
   source ne la donne. C'est un point ouvert, à trancher par Mamat ; cet ADR ne
   l'invente pas.

## Ce qui ne change pas

- **L'inventaire ne passe pas par ce circuit.** La finalisation d'un inventaire
  suit l'ADR-038 : le propriétaire peut finaliser ce qu'il a compté lui-même, la
  séparation des tâches n'y existe plus.
- Le geste d'approbation ou de rejet reste réservé au propriétaire : l'ADR-039
  délègue la **vue** du stock par permission, pas cette action.
- Le motif d'une perte vient de la liste fermée commune à la production, au
  stock et à la vitrine.
- Le stock est un ledger en ajout seul : une approbation écrit le mouvement qui
  correspond à la déclaration, s'il y en a un ; une erreur se corrige par un
  mouvement inverse.

## Contexte

Le circuit existe dans le code depuis le 2026-10-31 et n'était écrit dans aucun
document : la règle vivait dans un commentaire d'en-tête de migration. Elle
décide pourtant du moment où une perte réelle entre en comptabilité.

État du code au 2026-11-18, relevé sur les migrations :

- Les gestes d'ajustement et de perte du stock général soumettent une
  déclaration (famille `submit_stock_declaration`) au lieu d'écrire un mouvement.
  Déclarer exige la permission `inventory.adjust` pour un ajustement,
  `inventory.waste` pour une perte, `display.manage` pour la vitrine.
- L'approbation (famille `approve_stock_declaration`) et le rejet (famille
  `reject_stock_declaration`) exigent le rôle propriétaire et refusent un
  déclarant qui se valide lui-même. La table des déclarations porte aussi une
  contrainte qui interdit un approbateur égal au déclarant.
- Un ajustement est refusé à l'approbation si le stock a bougé depuis la
  déclaration : il faut le déclarer à nouveau.
- Vitrine : le recomptage de vitrine s'applique immédiatement, sans déclaration.
  Une perte de vitrine est retirée immédiatement de la vitrine ; son approbation
  écrit ensuite une perte sur le stock général. Ces deux comportements viennent
  de décisions de Mamat citées dans les en-têtes de migration du 2026-11-04 ;
  cette décision ne les tranche pas.

Au relevé du 2026-11-09, 3 déclarations étaient en attente en production, et un
seul compte pouvait les traiter.

## Conséquences

- Tant que la file n'est pas traitée, la valorisation du stock et les comptes de
  stock restent au-dessus de la marchandise réelle. Plus la file attend, plus
  l'écart grandit.
- La file se consulte sur la page des inventaires du back-office (relevé du
  2026-11-18), sans relance automatique.
- Le traitement des déclarations en attente est un geste du propriétaire. Il
  n'est pas fait par cette décision.
- Fait du code, non tranché par la décision : avec un seul compte propriétaire
  (relevé du 2026-11-09), une déclaration soumise par ce compte ne peut être
  approuvée ni rejetée par personne. L'ADR-038 a levé ce même blocage pour
  l'inventaire seulement. Le garder ou le lever ici est un point ouvert, à
  trancher par Mamat.

## Réversibilité

Écrire un ajustement ou une perte directement, déléguer l'approbation à une
permission, ou autoriser l'auto-approbation demande un nouvel ADR et une
nouvelle version des fonctions de déclaration. Les déclarations, leurs
approbations et leurs rejets restent tracés dans la table des déclarations et
dans `audit_logs` : l'historique du circuit reste reconstituable.
