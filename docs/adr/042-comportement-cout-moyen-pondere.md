# ADR-042 — Le coût moyen pondéré se réinitialise sur stock nul ou négatif, et se pondère au moment de la saisie

Date : 2026-11-18

Statut : décision de Mamat du 2026-11-09 (questions `P01` et `P03`, validées dans
le bloc documentaire, §13 de `docs/audit-2026-11/04_QUESTIONS_CLARIFICATION.md`).
Texte rédigé le 2026-11-18 pour la tâche `S1-20` du master plan de finition.

## Décision

1. **Le coût moyen se réinitialise quand le stock de départ est nul ou
   négatif.** Il ne se pondère pas : il prend le coût unitaire de l'entrée qui
   arrive.

2. **Le coût moyen se pondère contre le stock au moment de la saisie, pas à la
   date de réception.** Une réception saisie en retard se pondère contre le
   stock et le coût moyen du moment où elle est enregistrée.

Ces deux comportements sont ceux du code. Ils deviennent la règle écrite.

## Ce qui ne change pas

- Un changement du coût moyen n'émet aucune écriture comptable de réévaluation
  (ADR-014).
- Le coût unitaire d'un mouvement s'exprime en unité de base.
- Le stock négatif reste autorisé à la vente selon le réglage global.

## Contexte

Aucun document ne disait ce que devient le coût moyen quand le stock de départ
est nul ou négatif, ni contre quel stock une réception saisie en retard se
pondère. Le coût moyen alimente le coût des ventes, les alertes de marge et la
valorisation du stock.

État du code au 2026-11-18, relevé sur les migrations : le coût moyen est
recalculé par un seul déclencheur, `tr_update_product_cost_on_purchase`, à
chaque mouvement d'achat ou d'entrée de production. Il lit le stock et le coût
moyen du produit avant le mouvement. Si le stock est nul ou négatif, il pose le
coût unitaire du mouvement ; sinon il pondère l'ancien coût par l'ancien stock
et le nouveau par la quantité reçue. Il ignore un mouvement de quantité ou de
coût unitaire nul ou négatif.

Le relevé du 2026-11-09 recommandait d'écrire la réinitialisation comme la règle
(une moyenne sur une quantité négative n'a pas de sens) et d'accepter la date de
saisie (repondérer à une date passée demande de rejouer l'historique). Au même
relevé, le stock négatif était autorisé en production et 6 produits étaient en
stock négatif.

## Conséquences

- Après une rupture, ou un stock vendu en négatif, le coût moyen d'un produit
  repart du prix de la livraison suivante. L'historique de coût antérieur n'y
  entre plus.
- Une réception saisie après que son stock a été vendu fait passer le coût
  moyen au prix de cette livraison. En boutique, la saisie en retard est le cas
  normal : le coût moyen dépend donc de l'ordre de saisie.
- Aucune repondération rétroactive n'est faite quand une réception est saisie
  après coup.
- Fait du code, non tranché par la décision : le déclencheur se réinitialise
  aussi quand le coût moyen de départ est absent ou nul.

## Réversibilité

Pondérer à la date de réception, ou pondérer un stock négatif, demande un nouvel
ADR et une nouvelle version du déclencheur. Les coûts passés ne se recalculent
pas d'eux-mêmes : il faudrait rejouer les mouvements dans l'ordre des dates de
réception. Le ledger, en ajout seul, conserve chaque mouvement avec son coût
unitaire, ce qui rend ce calcul possible.
