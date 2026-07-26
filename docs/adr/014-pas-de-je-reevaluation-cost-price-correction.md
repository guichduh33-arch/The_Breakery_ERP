# ADR-014 — Pas de JE de réévaluation sur les changements de coût (`cost_price_correction` et WAC)

> **Date :** 2026-07-27 · **Statut : ACTÉ** (décision propriétaire, feu vert 2026-07-27 — audit stock, question Q2)

## Décision

Un changement de `products.cost_price` — qu'il vienne d'une **correction admin** (`update_cost_price_v1`, mouvement `cost_price_correction` qty=0) ou du **recalcul WAC automatique** (trigger `tr_update_product_cost_on_purchase` sur `purchase`/`production_in`) — **n'émet aucune écriture comptable de réévaluation** du stock on-hand. C'est une règle assumée, pas un trou.

Le grand livre inventaire (1141 et comptes sœurs) reste **basé transactions** : les entrées sont valorisées au coût réel du mouvement entrant, les sorties au coût du mouvement sortant. L'écart éventuel entre le solde GL et la valorisation instantanée (`current_stock × cost_price`) est **constaté et absorbé lors des inventaires physiques (opname)** via les JE `adjustment_*`/`opname_*` existants — et depuis la migration `20260727000246`, les ajustements manuels (`adjustment`) sont couverts aussi.

## Contexte

- L'audit stock 2026-07-27 a relevé 41 mouvements `cost_price_correction` en live sans JE, et posé la question : trou comptable ou règle ?
- Une réévaluation GL à chaque changement de coût correspondrait à un inventaire permanent strict avec revalorisation continue — lourd, et disproportionné pour une boulangerie NON-PKP (ADR-003/005) dont le besoin est le pilotage des marges, pas la conformité IFRS.
- `cost_price_correction` est un outil de **réparation admin** (erreur d'unité ×1000 du type ADR-008 D1, seed sans coût, produit entré via `incoming`) — pas un événement économique. Le mouvement qty=0 sert de trace ledger (`metadata.old_cost/new_cost`, `reason` obligatoire, gate `inventory.cost_correction`, idempotent) ; structurellement, le trigger JE ne pourrait d'ailleurs rien valoriser (`coût × |0| = 0`).
- Le recalcul WAC (achat/production) déplace `cost_price` en continu ; personne ne propose de le réévaluer au GL — la correction admin suit la même logique.

## Conséquences

1. **Ne jamais ajouter** `cost_price_correction` au CASE de `tr_stock_movement_je`. Il reste dans les types silencieux, au même titre que `transfer_*`.
2. Les rapports de **valorisation de stock** (`current_stock × cost_price`) et le **solde GL inventaire** sont deux mesures différentes qui peuvent diverger entre deux opnames. Tout rapport qui les compare doit le dire explicitement (pas un bug).
3. La résorption de l'écart passe par l'**opname** : c'est lui qui matérialise comptablement les corrections (JE adjustment/opname). Cadence des opnames = levier de fraîcheur du GL, décision opérationnelle.
4. L'audit ne re-signalera plus « `cost_price_correction` sans JE » comme finding (référencer ce ADR).

## Réversibilité

Si un besoin de réévaluation continue apparaît (exigence d'un comptable externe, passage PKP, audit fiscal), un nouvel ADR supersédant celui-ci devra spécifier : compte de contrepartie de réévaluation, traitement de l'historique, et bascule du trigger. L'infra (mouvement tracé avec old_cost/new_cost) rend ce calcul reconstructible a posteriori.
