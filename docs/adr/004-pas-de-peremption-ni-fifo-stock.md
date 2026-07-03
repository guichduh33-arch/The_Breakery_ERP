# ADR-004 — Pas de gestion de péremption/expiration ni de FIFO stock

> **Date :** 2026-07-04 · **Statut : ACTÉ** (décision propriétaire, session remise à plat)

## Décision
The Breakery n'utilisera **ni dates de péremption, ni expiration automatique, ni consommation FIFO du stock**. Le modèle retenu — définitif, pas transitoire — est le **suivi en quantité globale par produit**, la péremption étant gérée opérationnellement par **déclaration de perte** (`waste_stock_v1`, raison `Expired`).

## Contexte
- La Description v1.2 et la roadmap P3 de l'audit 2026-06-27 présentaient « lots datés + FEFO » comme *le prochain grand chantier*.
- L'analyse remise à plat (fiche `06-inventory-stock.md`) a révélé qu'une infrastructure existait déjà aux ¾ (table `stock_lots` avec `expires_at`, cron `mark_expired_lots_hourly`, FIFO sur pertes/transferts/production, page `/inventory/expiring`), seul le décompte à la vente manquant.
- Le propriétaire a tranché le 2026-07-04 : ce système ne sera pas utilisé.

## Conséquences
1. **Chantier P3 « FIFO/lots/péremption » : abandonné.** Aucune spec, aucun développement — ne pas re-proposer.
2. **Décommissionnement léger** (Vague 2 de la remise à plat) : désactiver le cron `mark_expired_lots_hourly`, retirer la page `/inventory/expiring` et le rapport perishable-turnover de la navigation ; **conserver `stock_lots` dormante** (pas de DROP — historique et réversibilité).
3. **Snapshot COGS (coût figé à la vente) : découplé** — reste un chantier voulu, source = WAC au moment de la vente (pas de coût par lot).
4. **Description v1.3** : retirer lots/FEFO des « À venir » et du glossaire ; reformuler le « risque assumé » en fonctionnement retenu (cf. `workplan/remise-a-plat/00-AMENDEMENTS-V13.md`, section Transverse).
5. **Non concernés** (sujets homonymes distincts) : le FIFO d'allocation des **paiements B2B** (`record_b2b_payment_v2`) et l'expiration des **points de fidélité**.

## Réversibilité
L'infra dormante (`stock_lots` + code des RPCs dans l'historique git) permet de rouvrir le sujet par un nouvel ADR si le contexte métier change (ex. obligation réglementaire de traçabilité).
