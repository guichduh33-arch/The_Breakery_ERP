# Session 53 — INDEX : P1.4 « Unification de la déduction stock à la vente »

- **Date** : 2026-07-02
- **Branche** : `swarm/session-53`
- **Spec** : [`docs/superpowers/specs/2026-07-02-sale-stock-unification-design.md`](../../superpowers/specs/2026-07-02-sale-stock-unification-design.md)
- **Plan** : [`docs/superpowers/plans/2026-07-02-sale-stock-unification.md`](../../superpowers/plans/2026-07-02-sale-stock-unification.md)
- **Audit source** : §4 P1 — T2 de `docs/workplan/audits/2026-06-27-audit-integral-par-module.md`
- **Closeout S52** : PR #135 mergée (doublon no-op de #134, déjà mergé le 29/06) ; branche `swarm/session-52` supprimée.

## Objectif

Router **toute** la déduction stock à la vente par une procédure interne unique **`_record_sale_stock_v1`**, supprimant les **9 `INSERT INTO stock_movements` bruts** répartis sur 3 RPCs. Deux incohérences fermées au passage.

## Le helper

**`_record_sale_stock_v1(p_product_id, p_quantity, p_reference_id, p_created_by, p_reason, p_movement_type='sale', p_reference_type='orders', p_unit=NULL, p_allow_negative=false) RETURNS void`** — `SECURITY DEFINER`, `REVOKE` anon+authenticated+PUBLIC (interne). Possède, atomiquement : garde de suffisance (flag-aware), `INSERT stock_movements (-qty)`, `UPDATE products.current_stock`, et — si `is_display_item` — `INSERT display_movements` + `UPDATE display_stock`. Prend une **magnitude positive**, résout `unit` depuis `products.unit` si NULL.

Détails d'implémentation notables :
- `display_movements.movement_type` est un enum **distinct** (`display_movement_type`) → cast `p_movement_type::text::display_movement_type` (bug trouvé en revue Task 1).
- Asymétrie préservée : `stock_movements.reference_type='orders'` (pluriel) vs `display_movements.reference_type='order'` (singulier, lu par le BO `MovementHistoryDrawer`).
- `RAISE` si l'`UPDATE display_stock` ne touche aucune ligne (pas de divergence silencieuse cache↔ledger).
- Pas de clé d'idempotence : portée au niveau ordre.

## RPCs (versioning)

| RPC | Changement | Traitement |
|---|---|---|
| `complete_order_with_payment_v15` | refactor pur (comportement identique) | `CREATE OR REPLACE` **en place**, reste **v15** *(déviation P10 assumée — précédent #122, contrat inchangé)* |
| `create_b2b_order_v2 → v3` | **display-aware** (décrémente `display_stock` pour un article vitrine) | bump + `DROP v2` + REVOKE/GRANT |
| `pay_existing_order_v10 → v11` | **flag-aware** (respecte `allow_negative_stock` ; v10 rejetait inconditionnellement) | bump + `DROP v10` + REVOKE/GRANT |

Dans chaque RPC : l'expansion métier (boucle combo, `_resolve_recipe_consumption_v1`, `jsonb_to_recordset` des ingrédients) est conservée ; seuls les blocs d'écriture deviennent un appel helper. La validation amont de v15/v3 est **conservée** (byte-identique) ; les checks inline inconditionnels de v11 sont **retirés** (sinon ils défont le flag).

## Migrations

| # | Fichier |
|---|---|
| `20260710000073` | `record_sale_stock_v1` (+ fix enum-cast / NOT FOUND) |
| `20260710000074` | `complete_order_v15_use_sale_helper` (refactor in-place) |
| `20260710000075` | `create_b2b_order_v3` (display-aware, DROP v2) |
| `20260710000076` | `pay_existing_order_v11` (flag-aware, DROP v10) |

Types regénérés (`packages/supabase/src/types.generated.ts` : v3/v11 in, v2/v10 out).

## UI / call-sites repointés

`useCreateB2bOrder → create_b2b_order_v3` ; `useCheckout → pay_existing_order_v11`. pgTAP + Vitest + smokes repointés (0 résidu source).

## Tests

- **Nouvelles suites** : `sale_stock_unification` (helper 12/12), `b2b_display_aware_stock` (3/3), `pay_existing_flag_aware` (3/3).
- **Régression via nouvelles versions (vérifié contrôleur)** : `sale_flag_aware_deduction` 6/6, `combo_sale` 11/11, `s44_display_symmetry` 8/8 (v11), `combo_fire_pay` 6/6 (v11), `b2b_order_flag_aware_stock` A/B/C (v3), `modifier_ingredient_deduction` (points clés v15+v11, incl. replay + display-tracked) 7/7.
- **App** : typecheck 4/4, build 2/2, POS smokes 9/9, BO btob smokes 9/9.
- **CI (bloquant `pgtap-pr`)** : `b2b_foundation`, `b2b_settlement`, `pay_existing_discount_gate` repointés (signatures existantes vérifiées).

## Décisions / déviations

1. **P10 (v15 in-place)** : refactor comportement-identique via `CREATE OR REPLACE` sans bump — assumé (précédent #122), contrat inchangé, aucun call-site cassé.
2. **B2B display-aware** : correction d'une incohérence latente (v2 ne touchait pas `display_stock`).
3. **`pay_existing` flag-aware** : léger changement — les articles non-trackés (rares en commande persistée) sont désormais gardés par le helper quand le flag est off.
4. **Validation amont conservée** sur v15/v3 (dé-risque le money-path ; le helper reste le garde-fou unique pour v11).

## Suite

- **P1.3 (T6)** — correctness compta (TB cumulative as-of, dédup PB1 void+refund, garde fiscale fail-closed, clôture annuelle) : prochaine vague.
- **DEV-S52-03 (UI)** — liste-factures B2B BO (allocation ciblée + Cancel par facture) : toujours déféré.
