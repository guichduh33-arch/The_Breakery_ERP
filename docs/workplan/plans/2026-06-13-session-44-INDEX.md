# Session 44 — Money-Path Hardening — INDEX

> Branche `swarm/session-44` (base `master` @ `fc36f3e` post-spec/plan + Wave A D4). Spec : [`../specs/2026-06-13-session-44-money-path-hardening-spec.md`](../specs/2026-06-13-session-44-money-path-hardening-spec.md) · Plan : [`2026-06-13-session-44-money-path-hardening-plan.md`](2026-06-13-session-44-money-path-hardening-plan.md).

## 1. Statut par task

| Wave | Task | Statut | Tests |
|---|---|---|---|
| A | A1 — `get_loyalty_multiplier` (D4) | ✅ committé `fc36f3e` | domain `tiers-multipliers` 1/1 + pgTAP `s44_money_gates` T1-T5 |
| A | A2 — `create_sale_journal_entry` CASE enum réel + fallback observable (P0-A b) | ✅ | pgTAP `s44_je_by_method` 7/7 |
| B | B1 — `complete_order_with_payment_v12` (P0-A a + P0-C 1/2/4 + OPP-1) | ✅ | pgTAP `s44_money_gates` T6-T12 (12/12) |
| B | B2 — `pay_existing_order_v8` (P0-A a + P1-C + P0-C + OPP-1) | ✅ | pgTAP `s44_display_symmetry` T1-T7 |
| B | B3 — `fire_counter_order_v2` (P0-C 3) | ✅ | pgTAP `counter_fire` 15/15 |
| B | B4 — types regen + EF v12 + clients + classifier | ✅ | typecheck 6/6 + smokes POS |
| C | C1 — `useStationMap` variantes (P0-B) | ✅ | `station-map-variants` 3/3 + fire smokes |
| C | C2 — `pickedUpOrderId` + `clear()` hygiène (P1-A/B) | ✅ | `cartStore.context-hygiene` 3/3 |
| C | C3 — loyalty depuis l'enveloppe serveur (D4 front) | ✅ | `usePaymentFlowLogic` (S44 D4) |
| D | D1 — reversal RPCs restaurent `display_stock` (P1-C) | ✅ | `s44_display_symmetry` T8 (8/8) |
| E | E1 — E2E Playwright | ⏳ authored (run env-dépendant) |
| E | E2 — sweeps + revue + closeout | ✅ |

## 2. Migrations (NAME-block `20260628000010..017`)

Appliquées via MCP `apply_migration` (versions cloud clock-assignées, convention S36+) ; miroirs locaux = NAME-block exact. Base vérifiée `list_migrations` (prior max NAME `20260627000016`).

- `_010` `get_loyalty_multiplier(INT)` — miroir SQL de `packages/domain/src/loyalty/tiers.ts` (pin sync).
- `_011` corrective `create_sale_journal_entry` — CASE sur l'enum réel (`cash|card|qris|edc|transfer|store_credit`, `debit_card/credit_card` n'existent pas) + seed `SALE_PAYMENT_TRANSFER`→1112 + fallback cash observable (`audit_logs je.payment_fallback_cash`).
- `_012` `complete_order_with_payment_v12` + DROP v11. `_013` REVOKE pair (3 lignes, DEV-S43-P11-01).
- `_014` `pay_existing_order_v8` + DROP v7. `_015` REVOKE pair.
- `_016` `fire_counter_order_v2` + DROP v1 + REVOKE pair inline (gate remise ligne).
- `_017` corrective reversal — `void_order_rpc_v2` + `refund_order_rpc_v3` restaurent `display_stock` (pattern S38 `pg_get_functiondef`+replace, signatures inchangées).

Types regen committé après B4 (v12/v8/fire_v2 présents, v11/v7/v1 absents).

## 3. EF

`process-payment` v9→**v10** (redeploy MCP, `verify_jwt=false`) : appelle `complete_order_with_payment_v12`, mapping `23514` → `promo_amount_mismatch` / `invalid_change` (409). Le multiplier client n'est plus jamais forwardé (l'EF ne le passait déjà pas — v12 le résout server-side).

## 4. Tests

- pgTAP cloud MCP : `s44_money_gates` 12/12, `s44_je_by_method` 7/7, `s44_display_symmetry` 8/8, `counter_fire` 15/15. Non-régression bumpée v12/v8 : `order_discount_gate` 10/10, `pay_existing_discount_gate` 8/8, `loyalty_transactions_append_only` 5/5.
- Sweeps : domain ✅, ui ✅, pos ✅, backoffice ✅ ; typecheck 6/6.

## 5. Déviations

| ID | Sévérité | Description |
|---|---|---|
| DEV-S44-B1-01 | **medium** | v12/v8 promo recompute : le subtotal passé à `evaluate_promotions_v1` = somme non-gift `unit_price*qty` (mirroir exact du client `useEvaluatePromotions`), PAS `v_items_total` comme le plan le proposait (il inclut modifiers + déduit les remises ligne → aurait causé des faux rejets sur tout panier remisé/à modifiers). Le plan le signalait en ⚠️ Edit 4 ("aligner sur ce que le client envoie réellement"). |
| DEV-S44-B2-01 | low | v8 : le check de disponibilité stock est rendu **display-aware** (display_stock pour is_display_item, current_stock sinon) — symétrie v12, au-delà du seul décrément display du plan. Évite un faux "insufficient stock" sur un produit vitrine dont `current_stock` est 0. |
| DEV-S44-D-01 | informational | reversal display restore via `movement_type='adjustment'` (l'enum `display_movement_type` n'a pas de valeur reversal dédiée). `cancel_order_item_rpc_v2` NON affecté : annulation pré-paiement, aucune déduction stock à restaurer. |
| DEV-S44-D4-01 | informational | l'enveloppe `pay_existing_order_v8` renvoie `loyalty_points_earned` mais PAS `loyalty_balance_after` (pas ajouté pour éviter un bump). Le SuccessModal affiche les points sur le chemin pickup, le solde sur le chemin direct/EF (v12). |
| DEV-S44-E-01 | informational | les 3 pgTAP S37 (`order_discount_gate`/`pay_existing_discount_gate`/`loyalty_transactions_append_only`) ciblaient v11/v7 droppés → bumpés v12/v8 (maintenance non-régression hors plan). |
| DEV-S44-P11-01 | medium (fixée) | pattern-guardian (12/14) : les REVOKE pairs inline de `_010` et `_016` omettaient la 3ᵉ ligne `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE FROM PUBLIC`. Garanties fonctionnelles déjà satisfaites ; corrective `_018` ré-assertion unique (pattern S40 `_022`). |

## 6. Hors scope (cf. spec §3 / §7)

Backfill JE historiques, ledger store credit, KDS ventes directes, append post-pickup tablette, reçu honnête / split receipt / filets realtime / close-shift gardé / tables completed / persist tablette. `loyalty_balance_after` sur le chemin pickup (v8) déféré.
