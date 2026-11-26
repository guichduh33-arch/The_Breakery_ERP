# ADR-049 — Une vente B2B entre dans les rapports de ventes à sa date de commande

Date : 2026-11-26

Statut : décision de Mamat du 2026-11-26, prise pendant la vérification d'une
critique du journal de caisse.

## Contexte

Les rapports de ventes du back-office partagent une seule règle de date de
vente, portée par la projection privée `reporting_private.recognized_sales_v2` :

- une ardoise de caisse compte le jour de l'ardoise (`outstanding_at`) ;
- une vente de caisse payée compte le jour du paiement ;
- une commande B2B ne comptait qu'une fois soldée, le jour du dernier règlement.

Une commande B2B livrée mais impayée (`b2b_pending`) n'apparaissait donc dans
aucun rapport de ventes. Au relevé du 2026-11-26 en production : 100 commandes
B2B dans ce cas, pour 19 979 000 IDR. Sur les 175 commandes B2B soldées de la
reprise historique, 158 l'ont été un autre jour que leur commande : elles
comptaient au jour de leur règlement.

La comptabilité passe pourtant l'écriture de vente B2B (`b2b_order`) au jour de
la commande : 298 des 299 écritures B2B relevées le 2026-11-26 portent la date
de création de la commande. Le rapport des ventes et le grand livre ne
plaçaient pas la même vente le même jour.

## Décision

1. **Une vente B2B entre dans les rapports de ventes à sa date de commande**,
   qu'elle soit impayée ou soldée. Le règlement ultérieur ne déplace pas la vente.
2. **Une commande B2B annulée n'entre dans aucun rapport de ventes.**
3. La règle des ventes de caisse ne change pas : ardoise au jour de l'ardoise,
   vente payée au jour du paiement.

## Conséquences

- Tous les rapports qui lisent la règle partagée suivent ensemble : ventes du
  jour, dashboard, ventes par catégorie, par produit, par client, marges et
  autres. Une commande B2B impayée y figure désormais, dans la part « à crédit »
  du rapport des ventes du jour.
- Les jours passés changent : une commande B2B impayée y apparaît, une commande
  B2B soldée plus tard revient à son jour de commande. C'est l'effet voulu.
- **Le rapport PB1 n'applique pas cette règle.** La vente B2B est hors PB1
  (ADR-040) et un mois déjà déclaré ne doit pas bouger. Le rapport PB1 garde la
  règle antérieure, figée dans `reporting_private.pb1_recognized_sales_v1` ;
  la famille `get_pb1_report` passe en v8 pour la lire, sans autre changement.
- Écart constaté et non traité ici : le rapport PB1 inclut déjà dans sa base
  taxable le sous-total des commandes B2B soldées, alors que l'ADR-040 les met
  hors PB1. Le corriger est une décision fiscale distincte.
- Le journal de caisse ne montre pas le B2B ; il n'est pas concerné.

## Mise en œuvre

Migration `20261126000020_b2b_sales_recognized_at_order_date.sql` : la
projection partagée est remplacée en place, avec la même liste de colonnes. Une
v3 aurait obligé à republier une trentaine de fonctions de rapport pour une
règle unique, et aurait laissé des rapports en désaccord pendant la transition.
Preuve : `supabase/tests/b2b_sales_recognized_at_order_date.test.sql`.

## Réversibilité

Revenir à la règle antérieure demande un nouvel ADR, puis une migration qui
redonne à la projection partagée la définition figée dans
`reporting_private.pb1_recognized_sales_v1`. Aucune donnée n'est modifiée par
cette décision : seules les lectures changent.
