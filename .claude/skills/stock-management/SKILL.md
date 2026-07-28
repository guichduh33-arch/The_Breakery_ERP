---
name: stock-management
description: >-
  Stock flow expert — raw materials → semi-finished → finished products, entry → exit.
  Audits the inventory flow for precision/automation/security/traceability gaps AND guides
  future changes. Use this skill whenever the task mentions stock, inventory / inventaire,
  stock movement / mouvement de stock, WAC / coût moyen pondéré, recipe / recette,
  production, opname, lot / péremption, FIFO, matière première, semi-fini, spoilage /
  wastage / perte / gaspillage, transfer / transfert, receive / réception, purchase order /
  bon de commande / achat, current_stock / display_stock — or touches apps/backoffice
  inventory|recipes features, POS stock, packages/domain inventory|production, or any
  supabase migration/test with stock/inventory/recipe/production in the name. Invoke it
  BEFORE editing any stock-writing RPC — stock_movements is an append-only ledger.
  Il répond aussi « péremption / FIFO » : c'est un sujet CLOS par l'ADR-004, ne pas
  re-proposer de chantier.
pathPatterns:
  - 'apps/backoffice/src/features/inventory*/**'
  - 'apps/backoffice/src/features/recipes/**'
  - 'apps/pos/src/features/stock/**'
  - 'supabase/migrations/*stock*.sql'
  - 'supabase/migrations/*inventory*.sql'
  - 'supabase/migrations/*recipe*.sql'
  - 'supabase/migrations/*production*.sql'
  - 'supabase/tests/inventory*.test.sql'
  - 'supabase/tests/recipe*.test.sql'
  - 'supabase/tests/*production*.test.sql'
  - 'packages/domain/src/inventory/**'
  - 'packages/domain/src/production/**'
promptSignals:
  phrases:
    - 'stock movement'
    - 'inventory'
    - 'WAC'
    - 'recipe'
    - 'production'
    - 'opname'
    - 'lot'
    - 'FIFO'
    - 'matiere premiere'
    - 'semi-fini'
    - 'spoilage'
    - 'wastage'
    - 'transfer_stock'
---

# Stock Management — The Breakery ERP

> **ADR applicables — corps lus le 2026-07-28, pas leurs titres.** Les ADR priment sur tout
> le reste de ce fichier. Un ADR ne se modifie jamais : un changement d'avis = nouvel ADR
> qui supersede.
>
> **ADR-004** (2026-07-04, ACTÉ) — **ni dates de péremption, ni expiration automatique, ni
> consommation FIFO.** Le modèle retenu, définitif, est le suivi en **quantité globale par
> produit** ; la péremption se gère par **déclaration de perte** (`waste_stock`, raison
> `Expired`). Chantier **abandonné : aucune spec, aucun développement, ne pas re-proposer**
> (conséq. 1). Décommissionnement acté (conséq. 2) : le cron `mark_expired_lots_hourly` est
> **`active = false`**, la page `/inventory/expiring` et le rapport perishable-turnover ont
> quitté la navigation ; l'infra reste **dormante, pas droppée** — `stock_lots`,
> `_resolve_fifo_lot`, `get_expiring_lots`, `create_stock_lot` existent encore, pour
> l'historique et la réversibilité. Partout ci-dessous, une mention de lot / `lot_id` / FIFO
> décrit une **infra dormante**, jamais une consigne à appliquer ni un défaut à corriger.
> → **Ne JAMAIS proposer de spec FIFO/FEFO, ni traiter « `lot_id` NULL » ou « FIFO non
> câblé » comme un gap.** Un `lot_id` renseigné est un résidu, pas une garantie de
> traçabilité. **Hors périmètre — homonymes** (conséq. 5) : le FIFO d'allocation des
> paiements B2B et l'expiration des points de fidélité.
>
> **ADR-008** (2026-07-17, accepté) — arbitrages Production & Recettes. **D4 est livrée** :
> la production **BLOQUE par défaut** en matière insuffisante ; elle ne lit plus
> `business_config.allow_negative_stock` (ce réglage ne gouverne plus QUE la vente). Seule
> échappatoire : `p_force_negative` (unitaire) / `p_batch.force_negative` (lot), gaté par la
> permission `inventory.production.force_negative` (ADMIN+), tracé dans `audit_logs` avec la
> liste des manquants. **D1-D3 et D5-D9 sont actées mais NON livrées** — unité de stockage
> imposée aux lignes de sous-recette (la classe d'erreur ×1000), coût des ratés en charge
> dédiée, enum `waste_reason`, `recipe_depth_exceeded` franc à la profondeur maximale, refus
> de produire un fini `deduct_stock = false`, revert refusé si le lot a bougé + retour au
> helper standard. → **Les re-signaler comme des trous est faux** : ce sont des décisions
> prises, pas encore implémentées. L'ADR constate lui-même que **les corps production en
> base ont divergé des fichiers de migration** : tout `_vN+1` se construit sur le corps live.
>
> **ADR-014** (2026-07-27, ACTÉ) — **aucune écriture comptable de réévaluation** sur un
> changement de coût, ni par `update_cost_price` (mouvement `cost_price_correction`,
> quantity=0) ni par le recalcul WAC automatique. Le grand livre inventaire reste **basé
> transactions** ; l'écart avec la valorisation instantanée `current_stock × cost_price` est
> **normal entre deux opnames** et s'y résorbe. → **Ne jamais ajouter
> `cost_price_correction` au CASE du trigger JE** (conséq. 1) et **ne plus signaler
> « `cost_price_correction` sans JE » comme un finding** (conséq. 4).

Expert on the stock flow from raw materials through semi-finished to finished products. Two use cases:

1. **Audit** the existing flow against 4 dimensions: precision, automation, security, traceability.
2. **Guide** future changes (new movement types, new RPCs, trigger edits, constraint changes, RPC bumps).

**`CLAUDE.md` is the source of truth** for project-wide patterns, and `docs/adr/` carries the decisions that govern this domain. This skill adds stock-specific mental model, audit checklists, and preventive guidance that neither carries.

## Mental model — The Breakery stock flow

Noms vérifiés en live (V3 dev, 2026-07-27). **On cite la famille, jamais la version : les
RPC bumpent souvent — la version vivante se vérifie dans `supabase/migrations/` et au
call-site, jamais ici.**

```
ENTRY                             INTERNAL                          EXIT
─────                             ────────                          ────
receive_purchase_order (PO→GRN)   record_production                 complete_order_with_payment
 ↓ stock_movements                 ↓ cascade _resolve_recipe_        pay_existing_order
 ↓ (movement_type=purchase)        ↓ consumption (depth 5)           create_b2b_order
 ↓ → WAC update (trigger)          ↓ stock_movements                  ↓ tous via _record_sale_stock
 ↓ → JE via le flux achat (GRN)    ↓ (production_in/out)              ↓ stock_movements (sale)
                                   ↓ → JE trigger                     ↓ → JE via le flux commande
record_incoming_stock             record_batch_production
 ↓ (incoming) — PAS de WAC,         ↓ wrapper canonique sur          refund/void RPCs
 ↓ PAS de JE, PAS de lot            ↓ l'impl interne, non exposée      ↓ stock_movements (sale_void)
                                                                      _record_cancel_waste_stock
adjust_stock                      create_internal_transfer            ↓ (waste sur annulation)
 ↓ (adjustment) → JE (audit Q1)    receive_internal_transfer
                                   ↓ (transfer_in/out, 2 sections)
waste_stock                       finalize_opname
 ↓ (waste) → JE                    ↓ (opname_in/out) → JE
```

`update_cost_price` écrit un mouvement `cost_price_correction` (quantity=0) — voir
ADR-014 : pas de JE.

### ⚠️ Schema reality (re-vérifié V3 dev 2026-07-27 — les noms de colonnes trompent l'intuition)

- **Quantity column is `quantity`** (DECIMAL(10,3), **signed** — negative for sale/waste, positive for purchase/incoming/production_in). There is NO `quantity_delta` column. Opname/WAC queries must use `quantity`.
- **Ledger actor is `created_by`** (FK user_profiles). There is NO `actor_id` on `stock_movements` (`actor_id` is the `audit_logs` column).
- **Free-text reason column is `reason`** (TEXT, ≥3 chars except sale/sale_void via CHECK `chk_stock_movements_reason_required`). There is NO `reason_code`.
- **`audit_logs` porte DEUX colonnes distinctes** : `metadata` (contexte) et `payload` (diff). Ne jamais les fusionner. La vue `audit_log` (singulier) est **droppée**.
- **JE trigger is `tr_20_je_emit`** (the trigger name); the *function* it calls is `tr_stock_movement_je`. Query `pg_trigger` by `tr_20_je_emit`.
- **WAC trigger is `tr_update_product_cost_on_purchase`** — `AFTER INSERT … WHEN (movement_type IN ('purchase','production_in'))` since the 2026-06-12 audit fix (`20260626000015`). WAC lives in a trigger, NOT inside the receive RPC, and it does **NOT** fire on `movement_type='incoming'` (voir « Cost backbone » ci-dessous).

### Traceability backbone

- `stock_movements` append-only ledger (RLS revokes UPDATE/DELETE for `authenticated`)
- `reason`, `from_section_id`, `to_section_id` (see schema-reality note above)
- `p_idempotency_key` UUID → `stock_movements.idempotency_key UUID UNIQUE` (replay-safe)
- trigger `tr_20_je_emit` (function `tr_stock_movement_je`) → `journal_entries` automatic,
  **uniquement** pour `waste`, `adjustment`, `adjustment_in/out`, `opname_in/out`,
  `production_in/out` (liste vérifiée dans le corps live ; `adjustment` a été ajouté par
  l'audit Q1, migration `20260727000246`). `incoming` / `purchase` / `sale` / `transfer_*` /
  `reservation_*` / `cost_price_correction` n'émettent RIEN ici — les JE de vente et
  d'achat viennent des flux commande / GRN.
- `audit_logs` row per RPC call (cols canoniques : actor_id / action / entity_type /
  entity_id / metadata **+ payload**)
- `lot_id` : **résiduel, hors doctrine** (ADR-004). Il n'atteste plus rien — ne pas
  bâtir de contrôle de traçabilité dessus.

### Cost backbone

- `movement_type='purchase'` (réception de PO via `receive_purchase_order`) AND `movement_type='production_in'` (since `20260626000015`) update `products.cost_price` (WAC) via trigger `tr_update_product_cost_on_purchase`
- `production_in` is valued at the **actual consumed cost** (`SUM(total_consumed × material_cost)` from the BOM walk ÷ actual yield), NOT at stale `products.cost_price` (audit 2026-06-12 M5, `20260626000015`) — the production JE pair (DR 1135 finished goods / CR 5110) is balanced against the `production_out` legs by construction
- `movement_type='incoming'` (`record_incoming_stock`, BackOffice uniquement) does **NOT** touch `cost_price` — a product received only this way stays at its prior cost (often 0). Chemin de correction : `update_cost_price` (movement_type=`cost_price_correction`, quantity=0) — **sans JE**, cf. ADR-014. Pour une réception qui doit être valorisée, passer par le flux achat compté (`create_purchase_order` → `receive_purchase_order`) : c'est la conclusion de l'audit Q3, qui a fait DROP `receive_stock_v1` (fait historique — l'objet n'existe plus).
- A `cost_price` change fires `tr_snapshot_on_product_cost_change` → re-snapshots ancestor `recipe_versions.snapshot`
- Full cascade resolved via `recipe_bom_full` (S17, depth-5)
- `product_cost_at_version` carries the per-version cost

### POS display-stock vs BO stock — RESOLVED (isolation shipped, re-verified 2026-05-31)

**Business intent (owner, 2026-05-30):** the POS `stock` module is a *display-case counter* ONLY. It records finished goods brought from the kitchen into the front display and decrements them on direct sales, purely to avoid selling out-of-stock items. It is meant to be **independent** of the BO stock module and is NOT a procurement/costing flow — a finished good is already costed upstream via its recipe/production, so putting it in the display is not an acquisition (no lot / no WAC / no JE is correct by design). Do NOT "fix" this by adding WAC/lots to the POS path.

**Implementation status — ISOLATION DELIVERED (S33 display-stock, on `master`).** The 2026-05-30 "gap" described below is now CLOSED. Verified state on V3 dev `ikcyvlovptebroadgtvd` (2026-05-31):
- **Dedicated tables** exist, fully separate from the global ledger: `display_stock` (`product_id`, `quantity`, `updated_at` — the front-counter), `display_movements` (append-only ledger: `movement_type`, `quantity`, `reason`, `reference_type/id`, `created_by`, `idempotency_key`). RLS on both = **SELECT-only** (`display.read`) → writes only via SECURITY DEFINER RPCs.
- **3 dedicated RPCs** (perm-gated, `anon` revoked): `add_display_stock` / `adjust_display_stock` / `waste_display_stock`.
- **POS rewired**: `usePOSReceiveStock` now wraps **`add_display_stock`** ("mise en vitrine"), NOT `record_incoming_stock`. `record_incoming_stock` is now called **only from the BackOffice** (`useRecordIncomingStock`) — POS is fully isolated.
- **Sale path**: `complete_order_with_payment` decrements BOTH `display_stock` (+ writes `display_movements`) AND `products.current_stock` — the documented double-deduction. This is the only place both are touched.

> Historical note: prior to S33 the POS receive routed through `record_incoming_stock` into the **shared** `stock_movements` ledger + global `products.current_stock`, causing BO/POS cross-interference. The `Front Display` section approach was superseded by the dedicated `display_stock`/`display_movements` tables. If an audit still finds POS writing `incoming` rows, that is a regression — flag it.

## Audit 2026-06-12 — fixes shipped + ledger conventions

Migrations `20260626000010..016`. Le résumé ci-dessous est **la seule trace exploitable** de
cet audit : il n'a plus de document source vivant, et il fait foi tel quel.

**Fixes shipped (don't re-flag these as gaps):**
- **C2 réparé** (`_010`) — `record_stock_movement` accepte le contexte cron : profil SYSTEM `00000000-0000-0000-0000-000000000999` (`SYS-CRON`, pin_hash non-bcrypt, is_active=false) utilisé quand `auth.uid() IS NULL AND session_user = 'postgres'`. ⚠️ Si le pooler / l'utilisateur d'exécution des crons change, re-vérifier la condition `session_user='postgres'`.
- **C3 réparé** (`_011`) — `margin_alerts.{expected_margin_pct, target_margin_pct, delta_pct}` élargis en NUMERIC(7,2) (le calcul est en 7,2 ; un produit cost élevé / prix faible donne des marges < -999.99 %).
- **C4 réparé** (`_012`) — les RPC de production raisent `section_required` (P0001) au lieu de violer le CHECK 23514 ; le front exige la section (single + batch). Comportement conservé dans les versions actuelles.
- **M2 réparé** (`_013`) — gate de solde par section dans `create_internal_transfer` (branche `send_directly`) et `receive_internal_transfer` : `insufficient_section_stock` (P0001, DETAIL JSON) avant émission des mouvements. 7 lignes `section_stock` négatives remises à 0 (trace `audit_logs` action `section_stock.negative_reset`). **Pas de CHECK `quantity >= 0`** — décision actée : les flux production_out/waste/adjustment légitimes décrémentent des sections jamais seedées (cache, pas ledger).
- **M1 côté DB** (`_014`) — `create_internal_transfer` valide les items sur `track_inventory` (plus `is_active`) : les ingrédients sont transférables. Doctrine : `is_active` = vendable au POS ; le gate stock est `track_inventory`.
- **M5 réparé** (`_015`) — voir Cost backbone ci-dessus (production_in au coût réel + WAC).
- **m1 réparé** (`_016`) — REVOKE TRUNCATE/TRIGGER/REFERENCES sur les 5 tables stock (`stock_movements`, `stock_lots`, `section_stock`, `display_stock`, `display_movements`) FROM authenticated, anon.

**Statut M3 — CLOS SANS SUITE par ADR-004 (2026-07-04).** Le constat « FIFO non câblé »
était exact, mais la réponse n'est pas de le câbler : le propriétaire a abandonné le
chantier lots/FIFO/péremption. Le cron `mark_expired_lots_hourly` est désactivé, l'infra
reste dormante. **Aucune spec FIFO ne doit être écrite.** Si un audit re-signale ce point,
la réponse est l'ADR-004, pas un ticket.

**Conventions ledger (actées, pas des bugs) :**
- **m9** — l'audit `stock.movement` a pour `subject_id` l'**id du mouvement** ; le produit est dans `payload`/metadata. Ne pas "corriger" vers product_id.
- **m10** — toute mise en production d'un site migré doit **entrer le stock initial via le ledger** (mouvements `incoming`/`adjustment_in` par section), sinon les caches `section_stock` partent de 0 et les consommations sectionnées créent des négatifs.
- **m11** — les lignes `transfer_in` ET `transfer_out` portent toutes deux `from_section_id` + `to_section_id` (le CHECK l'exige) ; le sens est porté par le signe de `quantity` et le `movement_type`.
- **m2 (ouvert)** — parents de variantes stockables : décision produit requise (un parent porte-t-il du stock ?). Pas de code tant que non tranché.

## Critical patterns (always verify before shipping)

1. **`stock_movements` append-only** — RLS revokes UPDATE/DELETE for `authenticated`. Never INSERT directly from app/test/RPC. Always go through `record_stock_movement` or its family : `adjust_stock`, `record_incoming_stock`, `waste_stock`, `create_internal_transfer` / `receive_internal_transfer`, `record_production`, `record_batch_production`, `finalize_opname`, `receive_purchase_order`. **La déduction de stock de VENTE passe par l'unique helper `_record_sale_stock`** — jamais en direct.
2. **Primitive auto-resolves `unit`** — passing `unit = NULL` to `record_stock_movement` makes it read `products.unit`. For NEW RPCs, populate `unit` explicitly — don't rely on auto-resolve (see migration `20260516000019_fix_record_stock_movement_v1_unit.sql`).
3. **Section constraint movement-type-aware** (S16 `_020`, relaxed again S22 `_026000012`) — `transfer_in/out` require BOTH `from_section_id` AND `to_section_id`. The exempt list (section optional) is `purchase`, `incoming`, `sale`, `sale_void`, `purchase_return`, `adjustment`, `waste`, `cost_price_correction`; everything else (`adjustment_*`, `opname_*`, `production_*`) requires AT LEAST ONE.
4. **`p_idempotency_key UUID`** on every retry-safe flow — replay returns the existing row instead of doubling. Always pass one from the client on retryable mutations. The primitive resolves it via a UNIQUE constraint and catches `unique_violation` to re-read.
5. **WAC garbage-in if `current_stock` is stale** (DEV-S17-1.C-02, informational). Manual `UPDATE products.cost_price` bypasses WAC AND emits no `stock_movements` audit row (DEV-S17-1.B-01). If the audit finds drift between recomputed WAC and stored cost_price, look for manual UPDATEs in git history.
6. **RPC versioning monotonic** — never edit a published `_vN` signature. Create `_vN+1` and `DROP FUNCTION ... vN(<old args>)` in the same migration. See `20260516000019` (drop original `record_stock_movement_v1` then recreate with `unit`).
7. **REVOKE pair S25 canonical** on every new RPC:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM anon;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```
   `REVOKE FROM anon` alone is insufficient — anon inherits via PUBLIC.
8. **`tr_20_je_emit` trigger** (S17 `_022/_023`, function `tr_stock_movement_je`) emits a `journal_entry` on INSERT — but ONLY for `waste`, `adjustment`, `adjustment_in/out`, `opname_in/out`, `production_in/out` (it early-returns for incoming/purchase/sale/transfer/reservation/cost_price_correction, and skips zero-value postings). It is idempotent (UNIQUE index `journal_entries_je_idempotency_uniq`) and fiscal-guarded (`check_fiscal_period_open`). If you add a new `movement_type` that needs accounting impact, add its DR/CR mapping in the CASE block or it silently emits nothing (no P0002 unless you add it to the handled set without a mapping key).
9. **Production bloquante par défaut (ADR-008 D4)** — une nouvelle RPC qui consomme des
   matières ne doit PAS dériver son autorisation de dépassement d'un réglage global.
   Le forçage se demande explicitement et se gate sur une permission dédiée.
   `_record_sale_stock` garde son `p_allow_negative` piloté par
   `business_config.allow_negative_stock` : c'est le chemin de VENTE, distinct.
10. **Recipe cascade immutable** (S15 + S17) — `recipe_versions.snapshot` is append-only. No retroactive mutation. La RPC de production lit la version au temps T pour le calcul de coût (pas la version courante). When changing a recipe, the trigger creates a new `recipe_versions` row — never UPDATE existing snapshots.

## Audit checklist (combo: précision / automatisation / sécurité / traçabilité)

Run a section when you suspect a gap. Each check is a discrete SQL/code query you can execute via MCP `execute_sql` or grep.

### A. Précision (computed matches stored)

- [ ] **Opname diff** — for every product, `current_stock - SUM(quantity) FROM stock_movements GROUP BY product_id` must equal 0 (column is `quantity`, signed — NOT `quantity_delta`). Caveat: only holds if ALL initial stock entered via the ledger; on a seeded dev DB most products have `current_stock` set without movements, so restrict to products that HAVE movements (`JOIN stock_movements`).
- [ ] **WAC validity** — recompute weighted average cost from `stock_movements` `purchase` rows carrying a `unit_cost` (NOT `incoming` — those rarely have unit_cost and don't feed WAC) and compare to `products.cost_price`. Drift > 0.01 IDR = audit (likely manual UPDATE or `update_cost_price`, see Pattern #5).
- [ ] **Recipe yield** — for every `production_records` row, compare `quantity_produced` to `recipes.yield_quantity * batch_count`. Recurring discrepancy = recipe definition drift or production input was approximated.
- [ ] **Negative stock** — `SELECT * FROM products WHERE current_stock < 0`. ⚠️ Ce n'est PAS forcément un bug : la vente autorise le négatif tant que `business_config.allow_negative_stock` vaut true, et la production peut avoir été **forcée** (ADR-008 D4). Croiser avec `audit_logs` (`metadata->>'force_negative' = 'true'`) avant de conclure ; un négatif sans trace de forçage ni réglage permissif, lui, est un vrai trou.
- [ ] **Orphan lot_id** — `stock_movements.lot_id NOT NULL AND lot_id NOT IN (SELECT id FROM stock_lots)` should be empty. If not, the FK was relaxed somewhere (check `supabase/migrations/`). ⚠️ Contrôle d'intégrité référentielle **uniquement** — un `lot_id` NULL n'est pas un défaut (ADR-004).

### B. Automatisation (triggers + crons active)

- [ ] **JE trigger attached** — `SELECT * FROM pg_trigger WHERE tgname = 'tr_20_je_emit'` confirms attachment (S17 `_023`). (Also expect `tr_update_product_cost_on_purchase` = the WAC trigger.)
- [ ] **Spoilage cron** — `mark_expired_lots_hourly` doit être **`active = false`** (décommissionnement ADR-004). `SELECT jobname, active FROM cron.job`. S'il repasse à `true`, c'est une **régression** : il auto-wasterait du stock déjà vendu. Crons stock légitimes : `recompute-recipe-costs-daily`, `recompute-recipe-margins-daily`, `refresh-mv-stock-variance`, `release-expired-reservations`.
- [ ] **WAC cascade on receive** — only `purchase` (PO) and `production_in` feed WAC → fires `tr_snapshot_on_product_cost_change` → ancestor `recipe_versions` re-snapshot. `incoming` does NOT (voir « Cost backbone »). Run pgTAP `recipe_cascade_snapshot.test.sql`.
- [ ] **Low_stock alerts cron** — ❌ confirmed ABSENT (2026-05-30). Only on-demand RPC `get_low_stock` exists; no proactive cron. Alerts are reactive only.
- [ ] **Recipe re-snapshot trigger** — `AFTER UPDATE ON recipes` creates a new `recipe_versions` row? Manual snapshots = drift risk.

### C. Sécurité

- [ ] **RLS on stock_movements** — UPDATE and DELETE policies for `authenticated` are revoked (S16 `_003`). Verify with `pg_policies`.
- [ ] **REVOKE pair on every stock RPC** — for each function in `supabase/migrations/*stock*` and `*inventory*`, confirm the 3-line REVOKE block. Missing ALTER DEFAULT PRIVILEGES = anon may inherit EXECUTE via PUBLIC.
- [ ] **Perm gate** — every stock RPC checks `has_permission(auth.uid(), 'inventory.<scope>.<action>')`. Grep for any `SECURITY DEFINER` function without a `has_permission` call.
- [ ] **audit_logs row** — every mutation produces an audit_log row with canonical cols `actor_id / action / entity_type / entity_id / metadata`. Missing rows = silent operations.
- [ ] **Idempotency key validation** — UUID v4 enforced via regex or CHECK? Cross-RPC replay tracked in audit_logs as `*.replay` action?
- [ ] **CHECK constraints intact** — `unit IS NOT NULL` (post-S16 `_016`), `reason ≥ 3` except sale/sale_void (`chk_stock_movements_reason_required`), `unit_cost >= 0`, `idempotency_key UNIQUE`, section constraint (S16 `_020` / S22 `_026000012`), `lot_id` FK (post-S17 `_042`). Note: nonzero-quantity is enforced by the `record_stock_movement` primitive (`quantity_must_be_nonzero`), NOT a table CHECK — `cost_price_correction` legitimately writes `quantity=0` by bypassing the primitive.

### D. Traçabilité

- [ ] **Ledger continuity** — no gap in `stock_movements` sequence integrity. If the sequence is bumped without inserts, investigate.
- [ ] ~~**Lot_id on consumption**~~ — **contrôle SUPPRIMÉ (ADR-004)**. Un `lot_id IS NULL` sur une consommation est le fonctionnement nominal, pas un trou de traçabilité. La traçabilité repose sur `reason`, `metadata`, `reference_type/id` et `audit_logs`.
- [ ] **`reason` populated** — for `adjustment*`, `waste`, never NULL/blank (column is `reason`, NOT `reason_code`). Use `SELECT * FROM stock_movements WHERE movement_type IN ('adjustment','adjustment_in','adjustment_out','waste') AND (reason IS NULL OR length(trim(reason)) < 3)`.
- [ ] **Idempotency replay distinguished** — audit_logs distinguishes `*.created` vs `*.replay` to spot retries. If the same action appears N times without `.replay` suffix, the idempotency layer was bypassed.
- [ ] **Chain entry → exit** — for any product, you can trace at least one row of type `purchase`/`incoming` → `production_in/out` → `sale`, en chaînant sur `product_id` + `metadata->>'production_id'` / `reference_id` (**pas** sur `lot_id`, cf. ADR-004). Une chaîne rompue = lignes forcées par INSERT direct, ou stock initial jamais entré par le ledger (cf. m10).

## Preventive checklists (5 concrete cases)

### 5.A — Before adding a value to the `movement_type` enum
- [ ] Does `tr_stock_movement_je` (S17 `_022/_023`) know how to map the new type to a COA account? If not, the trigger raises P0002 on the first insert.
- [ ] Does the section constraint (S16 `_020`) cover the new type? Otherwise CHECK violation 23514.
- [ ] Is there a perm gate `inventory.<action>` for this new type? Seed the permission in the same migration block.
- [ ] New pgTAP coverage in `supabase/tests/inventory_movements.test.sql` for the happy path + REVOKE + audit_logs row.

### 5.B — Before creating a new stock RPC
- [ ] `SECURITY DEFINER` with explicit `has_permission(auth.uid(), 'inventory.<scope>.<action>')` gate.
- [ ] `p_idempotency_key UUID` arg if retry-safe (it usually is).
- [ ] Calls the `record_stock_movement` primitive — never direct `INSERT INTO stock_movements`.
- [ ] `audit_logs` insert with canonical cols.
- [ ] REVOKE pair S25 (3 lines, see Pattern #7).
- [ ] pgTAP coverage: happy path + perm denied + replay returns existing + edge cases (idempotent FK violation re-read).
- [ ] Types regen via MCP `generate_typescript_types` → write to `packages/supabase/src/types.generated.ts` + commit.

### 5.C — Before touching a trigger (JE, WAC cascade)
- [ ] Identify every RPC that depends on the trigger. JE trigger is depended on by la RPC de production, `adjust_stock` / `waste_stock`, `finalize_opname`. (Les mouvements de vente n'émettent PAS de JE via ce trigger — le JE de vente vient du flux commande.)
- [ ] Write an integration pgTAP test that exercises the full chain entry → production → sale, asserting the trigger fired the expected `journal_entries` row.
- [ ] Cross-check historical correctives (S15-S17) for known regressions: DEV-S15-2.B-01 (recipe_versions cost reconstruction), DEV-S17-2.A-01 (`expandRecipeCascade` has no consumer in apps).
- [ ] Additive migration first (new trigger function, attach), then drop the old in the next migration once production is stable.

### 5.D — Before modifying a CHECK / FK / RLS on stock tables
- [ ] Identify the invariant the constraint protects (see S25 `_014` / `_015` correctives — relaxing `orders.session_id NOT NULL` and the `refund_order_rpc` RECORD bug surfaced once another change exercised the path).
- [ ] Check existing rows that would violate the new constraint — data migration must run first if any.
- [ ] Regression test suite: `inventory*.test.sql` + `recipe_*.test.sql` + `*production*.test.sql` via MCP `execute_sql` BEGIN/ROLLBACK envelope.
- [ ] RLS on `stock_movements` UPDATE/DELETE is non-negotiable — never relax. Find another mechanism if you need correction (a new void RPC, never UPDATE).

### 5.E — Before bumping an existing RPC `_vN` → `_vN+1`
- [ ] New signature lives in a new migration file with a forward timestamp.
- [ ] `DROP FUNCTION ... vN(<exact old args>)` in the SAME migration as the new function definition.
- [ ] REVOKE pair on `_vN+1` (the new function is anon-callable by default, even if `_vN` wasn't).
- [ ] Hooks in BO / POS calling `_vN`: locate via `Grep` on the function name, bump all callers to `_vN+1`.
- [ ] Types regen + commit.
- [ ] pgTAP covers the new signature and at least one case that wasn't covered in `_vN`.

## Sources de vérité (pointers)

Hiérarchie de vérité (CLAUDE.md) : **le code et le schéma DB** d'abord, puis `docs/adr/`,
puis `docs/objectifs/`, puis `docs/product/` + `docs/runbooks/`.

```
Décisions qui gouvernent ce domaine (immuables)
  docs/adr/004-pas-de-peremption-ni-fifo-stock.md        # ni FIFO ni péremption — CLOS
  docs/adr/008-production-recettes-arbitrages.md         # D4 livré ; D1-D3, D5-D9 non livrés
  docs/adr/014-pas-de-je-reevaluation-cost-price-correction.md
  docs/adr/007 / 011 / 012                               # domaine produits (track_inventory, variantes)

Documentation vivante — les seules arborescences à consulter
  docs/adr/                                              # décisions actées, immuables
  docs/objectifs/                                        # intention métier (dont INVENTORY, PRODUCTION)
  docs/product/ · docs/runbooks/                         # opérationnel

Vérité live (à préférer à tout fichier)
  MCP execute_sql : pg_get_functiondef, pg_trigger, cron.job, information_schema
  supabase/migrations/                                   # historique, mais peut avoir dérivé du live

Tests (vérité comportementale — les lancer pour vérifier un changement)
  supabase/tests/inventory*.test.sql                     # dont inventory_allow_negative, inventory_movements, inventory_opname
  supabase/tests/inventory_phase1_complete.test.sql      # acceptance T1-T15+
  supabase/tests/recipe_*.test.sql                       # cascade snapshot, bom full, cost history, version cost
  supabase/tests/*production*.test.sql                   # batch, schedule, regular, + les 2 flag_negative (ADR-008 D4)
  supabase/tests/display_stock*.test.sql                 # isolation vitrine POS
  supabase/tests/stock_reservations.test.sql
  supabase/tests/sale_stock_unification.test.sql         # helper de déduction de vente

Domain (pure TS — mental model + validators, IO-free)
  packages/domain/src/inventory/                         # validations, computeStockDelta
  packages/domain/src/production/                        # bomResolver, expandRecipeCascade
```

## Verification before claiming an audit or fix is complete

Les filtres vitest matchent le **NOM DE FICHIER**, pas le `describe`.

```bash
# Type & lint (cheap, run first) — le lint-ratchet CI bloque aussi sur les erreurs
# PRÉEXISTANTES des fichiers touchés par la PR : lint ce que tu as touché.
pnpm typecheck
pnpm --filter @breakery/domain test inventory
pnpm --filter @breakery/domain test production

# RPC-level : pgTAP via MCP execute_sql, enveloppe BEGIN … ROLLBACK.
# Pas de runner local (Docker retiré). Pour voir TOUTES les assertions d'un coup,
# agréger les is() en un seul SELECT … UNION ALL — sinon le MCP ne renvoie que
# le dernier result set.

# Backoffice smoke (le paquet est @breakery/app-backoffice, PAS @breakery/backoffice)
pnpm --filter @breakery/app-backoffice test inventory
pnpm --filter @breakery/app-backoffice test recipes

# POS smoke — la suite POS complète part en timeout en local ; la CI est le seul
# filet full-suite.
pnpm --filter @breakery/app-pos test stock
```

Après tout changement de schéma : **régénérer les types** (`generate_typescript_types` →
`packages/supabase/src/types.generated.ts`) et les commiter. C'est la cause n°1 de CI cassée.

If you're auditing prod data, work against V3 dev cloud `ikcyvlovptebroadgtvd` via the Supabase MCP, never against prod (V2 monolith `abjabuniwkqpfsenxljp` is incompatible with V3 migration lineage).

## When to escalate

- About to relax a RLS policy / CHECK / FK on stock tables → flag, almost always covers a latent bug elsewhere.
- About to add a `movement_type` value → flag, JE mapping is silent if missing.
- About to write directly to `stock_movements` from a new RPC → don't. Always use the primitive.
- Audit finds drift between WAC and recomputed cost > 0.01 IDR on more than 3 products → flag, likely manual UPDATE in production history.
- Audit finds orphan `lot_id` rows → flag, FK was relaxed somewhere.
- `mark_expired_lots_hourly` repassé à `active = true` → flag immédiat, régression ADR-004.
- Envie de « réparer » le FIFO, la péremption, ou la vitrine POS (lui ajouter WAC/lots/JE)
  → **ne pas coder**. Les trois sont des décisions actées, pas des trous.
- Un nouveau besoin de dépassement de stock → il se gate sur une permission dédiée,
  jamais sur un réglage global (ADR-008 D4).

## Ce que ce skill ne couvre pas (déférer)

- Mécanique de migration / versioning / REVOKE / regen des types → skill `db-migrations`.
- Écritures comptables, mapping COA, période fiscale, clôture → skill `accounting`.
- RBAC, conception d'un gate de permission, RLS → skill `security-auth`.
- Cycle de vie des commandes, void/refund côté métier commande → skill `orders`.
- Catalogue produit, variantes, `is_display_item` → skill `products-catalog`.
