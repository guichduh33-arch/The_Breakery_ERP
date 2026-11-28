# ADR-050 — Correction guidée d'un bon de commande reçu et payé

Date : 2026-11-28

Statut : décision de Mamat du 2026-11-28. La section « Choix de méthode »
porte des choix techniques de l'agent, pris dans le mandat : ils ne sont pas
des décisions de Mamat.

## Contexte

Un bon de commande se modifie tant qu'il n'est ni reçu ni payé. Une fois la
marchandise reçue ou un paiement saisi, le bon est verrouillé. Une erreur de
saisie (prix unitaire, quantité, fournisseur) restait alors sans issue simple.

L'ADR-048 a livré la contre-passation d'un paiement fournisseur par le super
admin, et l'annulation d'une réception existait déjà. Mais même après ces deux
gestes, le bon restait verrouillé : la fonction de modification regardait
l'existence d'une réception ou d'un paiement, pas leur état. L'ADR-048 le notait
comme conséquence.

Mamat a demandé que le super admin puisse modifier un bon déjà reçu et payé, en
cas d'erreur, et a choisi une correction guidée plutôt qu'une modification sur
place.

## Décision

1. **Le super admin peut corriger un bon de commande déjà reçu, payé, ou les
   deux, en cas d'erreur.**
2. **La correction est guidée, en un seul geste** : le super admin saisit son
   propre PIN et un motif. Le geste contre-passe chaque paiement du bon
   (ADR-048) et annule chaque réception (stock, coût moyen et dette
   contre-passés). Le bon revient « à recevoir » et redevient modifiable.
3. **Rien n'est modifié ni effacé sur place.** Les paiements, réceptions et
   écritures d'origine restent visibles ; seules des contre-passations
   s'ajoutent (ADR-048, décision 3).
4. **Après correction, l'opérateur modifie le bon, puis refait la réception et
   le paiement** par les gestes habituels.

## Choix de méthode

- La correction est **atomique** : contre-passations et annulations passent dans
  une seule transaction. Un seul refus (période comptable fermée, stock déjà
  consommé, rapprochement bancaire finalisé) laisse tout en l'état.
- Elle réutilise les fonctions existantes, sans les copier : la contre-passation
  d'un paiement (famille `reverse_po_payment`) puis l'annulation de réception
  (famille `cancel_goods_receipt`). Les paiements passent d'abord : l'annulation
  d'une réception refuse un bon payé au-delà de ce qui reste reçu.
- Un paiement groupé se contre-passe en entier (ADR-048). La correction d'un bon
  contre-passe donc aussi ce paiement sur les autres bons du groupe ; la fenêtre
  le dit avant le PIN, et la réponse liste ces bons.
- La modification d'un bon (famille `update_purchase_order`) ne se verrouille
  plus que sur une réception **active** et un paiement **vivant** (ni
  contre-passé, ni contre-passation).
- Sont refusés : un bon annulé, un import historique, un bon sans réception ni
  paiement vivant (la modification simple suffit).
- Le rejeu d'une même demande renvoie le résultat de la première, lu dans le
  journal d'audit sous le verrou du bon.
- Une ligne d'audit `po.correction_started` porte le motif et la liste des
  paiements et réceptions touchés ; la section « Activity » du bon l'affiche.
- La liste des bons filtre le statut de paiement côté serveur par deux champs
  calculés (`po_paid_amount`, `po_payment_status`), sans changer le schéma.

## Conséquences

- La conséquence de l'ADR-048 « après une contre-passation, le bon reste
  verrouillé à l'édition » ne tient plus : un bon dont tous les paiements sont
  contre-passés et toutes les réceptions annulées redevient modifiable.
- La contre-passation d'un paiement est datée du jour du paiement d'origine
  (ADR-048) ; l'annulation d'une réception est datée du jour de l'annulation.
- Un stock déjà consommé empêche la correction : il faut d'abord régulariser le
  stock.

## Bilan factuel

Relevé du 2026-11-28, sur la base de développement seulement. Migration
`20261128000002_po_guided_correction.sql` appliquée sur le projet de
développement ; test pgTAP `po_guided_correction.test.sql` exécuté : 31 sur 31.
Back-office : action « Correct order » sur la fiche du bon, visible du super
admin. Rien n'est publié en production à cette date.
