# ADR-040 — La vente B2B n'est pas assujettie à la PB1

Date : 2026-11-18

Statut : décision de Mamat du 2026-11-09 (question `G04`, lot 2 du registre des
décisions rendues de `docs/audit-2026-11/04_QUESTIONS_CLARIFICATION.md`, réponse
**[B] Exonération confirmée, à écrire**). Elle confirme une décision du
propriétaire du 2026-07-17 qui ne vivait que dans un commentaire de fonction.
Texte rédigé le 2026-11-18 pour la tâche `S1-20` du master plan de finition.

## Décision

1. **La vente B2B n'est pas assujettie à la PB1 (PBJT).** La livraison B2B est
   hors du champ de la taxe locale sur la restauration. Une commande B2B ne
   porte pas de PB1.

2. **Cette exonération est une règle, pas un oubli.** Une taxe nulle sur une
   commande B2B ne se corrige pas en la branchant sur le calcul de PB1 des
   ventes de caisse.

## Ce qui ne change pas

- Le régime fiscal : NON-PKP, PBJT à 10 % incluse dans le prix sur les ventes de
  caisse, juridiction Lombok Tengah (ADR-003, ADR-005).
- Le compte de PB1 à payer reste le seul crédité par la PB1 des ventes de caisse.
- Le crédit B2B, ses factures, ses règlements et son encours : cette décision
  porte sur la taxe, pas sur le circuit de la créance.

## Contexte

L'ADR-005 ne prévoit aucune exonération de gros. La seule trace de la décision
du 2026-07-17 était le commentaire de la fonction interne qui porte la formule
de PB1 (famille `_pb1_split`) : il nomme la création de commande B2B comme une
écriture délibérée d'une taxe nulle, à ne pas brancher sur ce calcul. Un
commentaire de fonction est invisible à tout contrôle et se perd au premier
bump.

Le code est conforme. La création de commande B2B (famille `create_b2b_order`)
écrit une taxe nulle sur la commande, et son écriture comptable débite la
créance B2B et crédite le chiffre d'affaires B2B pour le même montant, sans
ligne de PB1. Vérifié sur la migration la plus récente de la famille au
2026-11-18.

Au relevé du 2026-11-09, le chiffre d'affaires B2B en production était de
63 534 500 IDR, dont 4 181 133 IDR de PB1 portés par des commandes B2B issues
de la reprise historique d'octobre.

## Conséquences

- Toute documentation qui fait créditer la PB1 par une vente B2B est fausse et
  se corrige contre cette décision.
- Une vente B2B nouvelle n'ajoute aucune PB1 à déclarer. La PB1 déjà portée par
  des commandes B2B de la reprise historique reste dans le compte de PB1, donc
  dans le calcul de la PB1 due, tant que son traitement n'est pas tranché (voir
  plus bas).
- Une nouvelle version de la création ou de l'édition de commande B2B garde la
  taxe à zéro. Le calcul de PB1 des ventes de caisse ne s'y applique pas.
- Fait du code, non tranché par la décision : l'édition de commande B2B (famille
  `edit_b2b_order`) refuse une commande dont la taxe n'est pas nulle. Les
  commandes B2B de la reprise historique qui portent une PB1 ne sont donc pas
  modifiables par ce chemin.
- Le traitement de la PB1 déjà portée par les commandes B2B de la reprise
  historique n'est pas tranché par cette décision.

## Réversibilité

Assujettir la vente B2B demande un nouvel ADR, après avis fiscal, puis une
nouvelle version de la création et de l'édition de commande B2B, et de leur
écriture comptable. Les commandes déjà créées gardent leur taxe nulle et leur
écriture d'origine : un assujettissement ne vaudrait que pour l'avenir, sauf
reprise décidée à part.
