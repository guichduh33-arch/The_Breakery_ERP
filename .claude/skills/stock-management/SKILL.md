---
name: stock-management
description: Stock flow expert — raw materials → semi-finished → finished products, entry → exit. Audit the existing inventory flow for precision/automation/security/traceability gaps AND guide future changes. Triggers on inventory/recipe/production/opname/transfer/WAC/lot work across apps/backoffice, apps/pos, packages/domain, and supabase migrations/tests.
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

Expert on the stock flow from raw materials through semi-finished to finished products. Two use cases:

1. **Audit** the existing flow against 4 dimensions: precision, automation, security, traceability.
2. **Guide** future changes (new movement types, new RPCs, trigger edits, constraint changes, RPC bumps).

**`CLAUDE.md` is the source of truth** for project-wide patterns and active workplan. This skill adds stock-specific mental model, audit checklists, and preventive guidance that CLAUDE.md doesn't carry.

## Mental model — The Breakery stock flow

```
ENTRY                        INTERNAL                       EXIT
─────                        ────────                       ────
receive_stock_v1 (PO)        record_production_v1           complete_order_v9
 ↓ stock_movements             ↓ cascade via                  ↓ stock_movements
 ↓ (movement_type=purchase)    ↓ recipe_bom_full_v1           ↓ (movement_type=sale)
 ↓ → WAC update                ↓ (S17 depth-5 walk)           ↓ → JE trigger
 ↓ → JE trigger                ↓ stock_movements             
 ↓ → recipe cascade            ↓ (production_in/out)          refund_order_rpc_v2
                               ↓ → JE trigger                  ↓ stock_movements (sale_void/sale_refund)
record_incoming_stock_v1       transfer_stock_v1
 ↓ (incoming)                  ↓ (from_section_id, to_section_id)
                               ↓ stock_movements (transfer_in/out)
adjust_stock_v1
 ↓ (adjustment)                waste_stock_v1 / spoilage trigger
                               ↓ stock_movements (waste / spoilage)
```

### Traceability backbone

- `stock_movements` append-only ledger (RLS revokes UPDATE/DELETE for `authenticated`)
- `lot_id` (S17 FIFO) propagated on every consumption
- `reason_code`, `from_section_id`, `to_section_id`
- `p_idempotency_key` UUID (replay-safe)
- `tr_stock_movement_je` trigger → `journal_entries` automatic
- `audit_logs` row per RPC call (canonical cols: actor_id / action / entity_type / entity_id / metadata)

### Cost backbone

- `receive_stock_v1` updates `products.cost_price` (WAC weighted)
- Cascade through `WITH RECURSIVE` walk into ancestor `recipe_versions.snapshot`
- Full cascade resolved via `recipe_bom_full_v1` (S17, depth-5)
- `product_cost_at_version` carries the per-version cost

## Critical patterns (always verify before shipping)

1. **`stock_movements` append-only** — RLS revokes UPDATE/DELETE for `authenticated`. Never INSERT directly from app/test/RPC. Always go through `record_stock_movement_v1` or its family (`adjust_stock_v1`, `receive_stock_v1`, `record_incoming_stock_v1`, `waste_stock_v1`, `transfer_stock_v1`, `record_production_v1`, `finalize_opname_v1`).
2. **Primitive auto-resolves `unit`** — passing `unit = NULL` to `record_stock_movement_v1` makes it read `products.unit`. For NEW RPCs, populate `unit` explicitly — don't rely on auto-resolve (see migration `20260516000019_fix_record_stock_movement_v1_unit.sql`).
3. **Section constraint movement-type-aware** (S16 `_020`) — `transfer_in/out` require BOTH `from_section_id` AND `to_section_id`; `adjustment*`, `waste`, `incoming`, `purchase`, `sale*`, `production*`, `opname*` require AT LEAST ONE.
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
8. **`tr_stock_movement_je` trigger** (S17 `_022/_023`) emits a `journal_entry` automatically on every `stock_movements` INSERT. If you add a new `movement_type` enum value, the trigger must know how to map it to a COA account or it raises P0002.
9. **Lot_id propagation (S17)** — FIFO on `stock_lots`. Every RPC that consumes stock (sale, production_out, waste, transfer_out) MUST respect FIFO or opt out with a documented business reason.
10. **Recipe cascade immutable** (S15 + S17) — `recipe_versions.snapshot` is append-only. No retroactive mutation. `record_production_v1` reads the version at time T for cost calculation (not the current version). When changing a recipe, the trigger creates a new `recipe_versions` row — never UPDATE existing snapshots.

## Audit checklist (combo: précision / automatisation / sécurité / traçabilité)

Run a section when you suspect a gap. Each check is a discrete SQL/code query you can execute via MCP `execute_sql` or grep.

### A. Précision (computed matches stored)

- [ ] **Opname diff** — for every product, `current_stock - SUM(quantity_delta) FROM stock_movements GROUP BY product_id` must equal 0. Any delta ≠ 0 means the ledger is broken or a manual UPDATE bypassed the chain.
- [ ] **WAC validity** — recompute weighted average cost from `stock_movements` (purchase/incoming rows with cost_price snapshot) and compare to `products.cost_price`. Drift > 0.01 IDR = audit (likely manual UPDATE, see Pattern #5).
- [ ] **Recipe yield** — for every `production_records` row, compare `quantity_produced` to `recipes.yield_quantity * batch_count`. Recurring discrepancy = recipe definition drift or production input was approximated.
- [ ] **Negative stock** — `SELECT * FROM products WHERE current_stock < 0` should return zero rows. Anything else means a sale was allowed without a stock gate, OR a non-sequenced movement.
- [ ] **Orphan lot_id** — `stock_movements.lot_id NOT NULL AND lot_id NOT IN (SELECT id FROM stock_lots)` should be empty. If not, the FK was relaxed somewhere (check `supabase/migrations/`).

### B. Automatisation (triggers + crons active)

- [ ] **JE trigger attached** — `SELECT * FROM pg_trigger WHERE tgname = 'tr_stock_movement_je'` confirms attachment (S17 `_023`).
- [ ] **Spoilage trigger / cron** — `stock_lots.expired` either auto-decrements via trigger or via cron. If neither, manual `waste_stock_v1` calls are required and easily skipped. Check `pg_cron.job` for stock-related schedules.
- [ ] **WAC cascade on receive** — `receive_stock_v1` and `record_incoming_stock_v1` must trigger the recipe_versions snapshot cascade (S17 `WITH RECURSIVE`). Run the pgTAP integration test `recipe_cascade_snapshot.test.sql` to confirm.
- [ ] **Low_stock alerts cron** — does a job notify when `current_stock < products.min_stock` (S16 `_005`)? Otherwise alerts are reactive only.
- [ ] **Recipe re-snapshot trigger** — `AFTER UPDATE ON recipes` creates a new `recipe_versions` row? Manual snapshots = drift risk.

### C. Sécurité

- [ ] **RLS on stock_movements** — UPDATE and DELETE policies for `authenticated` are revoked (S16 `_003`). Verify with `pg_policies`.
- [ ] **REVOKE pair on every stock RPC** — for each function in `supabase/migrations/*stock*` and `*inventory*`, confirm the 3-line REVOKE block. Missing ALTER DEFAULT PRIVILEGES = anon may inherit EXECUTE via PUBLIC.
- [ ] **Perm gate** — every stock RPC checks `has_permission(auth.uid(), 'inventory.<scope>.<action>')`. Grep for any `SECURITY DEFINER` function without a `has_permission` call.
- [ ] **audit_logs row** — every mutation produces an audit_log row with canonical cols `actor_id / action / entity_type / entity_id / metadata`. Missing rows = silent operations.
- [ ] **Idempotency key validation** — UUID v4 enforced via regex or CHECK? Cross-RPC replay tracked in audit_logs as `*.replay` action?
- [ ] **CHECK constraints intact** — `quantity_delta != 0`, `unit IS NOT NULL` (post-S16 `_019`), section constraint (post-S16 `_020`), `lot_id` FK (post-S17 `_042`).

### D. Traçabilité

- [ ] **Ledger continuity** — no gap in `stock_movements` sequence integrity. If the sequence is bumped without inserts, investigate.
- [ ] **Lot_id on consumption** — `sale`, `production_out`, `waste`, `transfer_out` movements must always reference a specific `lot_id`. Rows with `lot_id IS NULL` for these types = traceability gap.
- [ ] **`reason_code` populated** — for `adjustment*`, `waste`, never NULL. Use `SELECT * FROM stock_movements WHERE movement_type IN ('adjustment_in','adjustment_out','waste') AND reason_code IS NULL`.
- [ ] **Idempotency replay distinguished** — audit_logs distinguishes `*.created` vs `*.replay` to spot retries. If the same action appears N times without `.replay` suffix, the idempotency layer was bypassed.
- [ ] **Chain entry → exit** — for any product, you can trace at least one row of type `purchase`/`incoming` → `production_in/out` → `sale` via `lot_id` propagation. If chains break, FIFO was bypassed or rows were forced via direct INSERT.

## Preventive checklists (5 concrete cases)

### 5.A — Before adding a value to the `movement_type` enum
- [ ] Does `tr_stock_movement_je` (S17 `_022/_023`) know how to map the new type to a COA account? If not, the trigger raises P0002 on the first insert.
- [ ] Does the section constraint (S16 `_020`) cover the new type? Otherwise CHECK violation 23514.
- [ ] Is there a perm gate `inventory.<action>` for this new type? Seed the permission in the same migration block.
- [ ] New pgTAP coverage in `supabase/tests/inventory_movements.test.sql` for the happy path + REVOKE + audit_logs row.

### 5.B — Before creating a new stock RPC
- [ ] `SECURITY DEFINER` with explicit `has_permission(auth.uid(), 'inventory.<scope>.<action>')` gate.
- [ ] `p_idempotency_key UUID` arg if retry-safe (it usually is).
- [ ] Calls `record_stock_movement_v1` primitive — never direct `INSERT INTO stock_movements`.
- [ ] `audit_logs` insert with canonical cols.
- [ ] REVOKE pair S25 (3 lines, see Pattern #7).
- [ ] pgTAP coverage: happy path + perm denied + replay returns existing + edge cases (idempotent FK violation re-read).
- [ ] Types regen via MCP `generate_typescript_types` → write to `packages/supabase/src/types.generated.ts` + commit.

### 5.C — Before touching a trigger (JE, spoilage, WAC cascade)
- [ ] Identify every RPC that depends on the trigger. JE trigger is depended on by `record_production_v1`, `complete_order_v9` (sale movements), and all receive RPCs.
- [ ] Write an integration pgTAP test that exercises the full chain entry → production → sale, asserting the trigger fired the expected `journal_entries` row.
- [ ] Cross-check historical correctives (S15-S17) for known regressions: DEV-S15-2.B-01 (recipe_versions cost reconstruction), DEV-S17-2.A-01 (`expandRecipeCascade` has no consumer in apps).
- [ ] Additive migration first (new trigger function, attach), then drop the old in the next migration once production is stable.

### 5.D — Before modifying a CHECK / FK / RLS on stock tables
- [ ] Identify the invariant the constraint protects (see S25 `_014` / `_015` correctives — relaxing `orders.session_id NOT NULL` and the `refund_order_rpc_v2` RECORD bug surfaced once another change exercised the path).
- [ ] Check existing rows that would violate the new constraint — data migration must run first if any.
- [ ] Regression test suite: `inventory*.test.sql` + `recipe_*.test.sql` + `*production*.test.sql` via MCP `execute_sql` BEGIN/ROLLBACK envelope.
- [ ] RLS on `stock_movements` UPDATE/DELETE is non-negotiable — never relax. Find another mechanism if you need correction (a new `_void_v1` RPC, never UPDATE).

### 5.E — Before bumping an existing RPC `_vN` → `_vN+1`
- [ ] New signature lives in a new migration file with a forward timestamp.
- [ ] `DROP FUNCTION ... vN(<exact old args>)` in the SAME migration as the new function definition.
- [ ] REVOKE pair on `_vN+1` (the new function is anon-callable by default, even if `_vN` wasn't).
- [ ] Hooks in BO / POS calling `_vN`: locate via `Grep` on the function name, bump all callers to `_vN+1`.
- [ ] Types regen + commit.
- [ ] pgTAP covers the new signature and at least one case that wasn't covered in `_vN`.

## Sources de vérité (pointers)

```
Docs reference (read first, canonical)
  docs/reference/04-modules/15-production-recipes.md
  docs/reference/04-modules/14-inventory.md             # if present
  docs/reference/04-modules/16-stock-movements.md       # if present

Migrations (chronological order to understand history)
  supabase/migrations/20260516000001..024_*.sql         # S16 stock init + RPCs
  supabase/migrations/20260517000020..023_*.sql         # S17 lot_id + JE trigger
  supabase/migrations/20260517000040..042_*.sql         # S17 stock_lots FIFO
  supabase/migrations/20260517000060..064_*.sql         # S17 recipes + production
  supabase/migrations/20260519*.sql                     # S15 bakery production (32 migrations)
  supabase/migrations/20260521*.sql                     # S17 cascade

Tests (behavioral truth — run these to verify any change)
  supabase/tests/inventory*.test.sql                    # 4 files
  supabase/tests/inventory_phase1_complete.test.sql     # T1-T15+ acceptance
  supabase/tests/recipe_*.test.sql                      # 4 files (cascade snapshot, bom full, cost history, version cost)
  supabase/tests/*production*.test.sql                  # 3 files (batch, schedule, regular)
  supabase/tests/stock_reservations.test.sql

Patterns canon (CLAUDE.md "Critical patterns" + session refs)
  CLAUDE.md                                              # source of truth
  Sessions 12, 15, 16, 17, 18, 25 — see active workplan in CLAUDE.md

Domain (pure TS — mental model + validators)
  packages/domain/src/inventory/                         # validations, computeStockDelta
  packages/domain/src/production/                        # bomResolver, expandRecipeCascade
```

## Verification before claiming an audit or fix is complete

```bash
# Type & lint (cheap, run first)
pnpm typecheck
pnpm --filter @breakery/domain test inventory
pnpm --filter @breakery/domain test production

# RPC-level (pgTAP via MCP execute_sql with BEGIN/ROLLBACK envelope)
# Run the relevant test file from supabase/tests/

# Backoffice smoke
pnpm --filter @breakery/app-backoffice test inventory
pnpm --filter @breakery/app-backoffice test recipes

# POS smoke
pnpm --filter @breakery/app-pos test stock
```

If you're auditing prod data, work against V3 dev cloud `ikcyvlovptebroadgtvd` via the Supabase MCP, never against prod (V2 monolith `abjabuniwkqpfsenxljp` is incompatible with V3 migration lineage).

## When to escalate

- About to relax a RLS policy / CHECK / FK on stock tables → flag, almost always covers a latent bug elsewhere.
- About to add a `movement_type` value → flag, JE mapping is silent if missing.
- About to write directly to `stock_movements` from a new RPC → don't. Always use the primitive.
- Audit finds drift between WAC and recomputed cost > 0.01 IDR on more than 3 products → flag, likely manual UPDATE in production history.
- Audit finds orphan `lot_id` rows → flag, FK was relaxed somewhere.
