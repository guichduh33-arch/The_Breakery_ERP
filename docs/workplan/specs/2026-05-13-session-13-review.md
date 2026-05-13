# Session 13 — QA Review (Audit + Spec + Plan)

> **Date** : 2026-05-13 (initial review) → 2026-05-14 (re-pass after planner patches).
> **Auteur** : reviewer (Claude, supervised by guichduh33@gmail.com).
> **Pipeline position** : last (no downstream).
> **Inputs reviewed** :
> 1. [`./2026-05-13-session-13-architecture-audit.md`](./2026-05-13-session-13-architecture-audit.md) (560 L, unchanged).
> 2. [`./2026-05-13-session-13-spec.md`](./2026-05-13-session-13-spec.md) (573 L, internal rewrites D15/D16/D14).
> 3. [`../plans/2026-05-13-session-13-INDEX.md`](../plans/2026-05-13-session-13-INDEX.md) (1238 L — +40 L vs initial review for [m4] split + new view + DoD bullets).
> **Baseline** : `CLAUDE.md`, `supabase/migrations/` (latest committed `20260516000024`), shape `2026-05-12-session-12-inventory-complete-INDEX.md`, 25 backlog files in `docs/workplan/backlog-by-module/`.

---

## Re-pass verdict (2026-05-14)

**PASS with 1 minor finding** — All 9 fixes from the 2026-05-13 review are verifiably implemented in the spec + INDEX. The plan is now ready for execution. One **minor inconsistency** (a single contradictory DoD bullet on Phase 0.1 about the `audit_log` canonical choice) should be cleaned up but does NOT block Wave 0 kickoff — the spec and the actual DROP migration both agree on the same canonical (plural).

### Per-fix verification

| Fix | Status | Evidence (file:line) |
|-----|--------|---------------------|
| **B1** — FIFO upfront in `record_stock_movement_v1`, no AFTER triggers on `stock_movements` | ✓ | INDEX:223 (RPC signature additive `p_lot_id UUID DEFAULT NULL`); INDEX:330 ("**AUCUN trigger AFTER INSERT/UPDATE sur `stock_movements`**"); spec:110 (D15 fully rewritten — pattern (a) chosen); DoD bullets INDEX:247 (`T_F1_NO_UPDATE_INVARIANT`), INDEX:363 (`T_F1_NO_TRIGGER_INVARIANT` + `T_F1_NO_LOT_ID_UPDATE`). 0 hits for `tr_fifo_consume` / UPDATE-on-lot_id. |
| **B2** — `evaluate_promotions_v1` build-from-scratch, no DROP | ✓ | INDEX:541 phase title renamed "`evaluate_promotions_v1` — build-from-scratch"; INDEX:551 migration `000081` is "**CREATE…AUCUN DROP**"; INDEX:130 Phase 0.1 DoD verifies absence; spec:109 D14 explicitly states "pas un v2 — `_v1` reflects no predecessor"; spec:241/367/408/439 all use `_v1`. 0 hits for `evaluate_promotions_v2` in spec or INDEX. |
| **M1** — Trigger numeric prefix `tr_20_je_emit` + ordering test | ✓ | INDEX:226 migration `000023` ATTACH trigger named `tr_20_je_emit` + `COMMENT ON TABLE stock_movements` documents firing-order contract (reserves `_10_*` / `_20_je_emit` / `_30_+`); INDEX:246 DoD has `T_TRIGGER_ORDER_STOCK_MOVEMENTS` pgTAP; downstream references INDEX:485, 591, 626 use `tr_20_je_emit` name consistently. |
| **M2** — D19 channel uniqueness per-phase DoD on 4.B/4.C/5.A | ✓ | INDEX:810 (Phase 4.B KDS), INDEX:837 (Phase 4.C Display with StrictMode unit test), INDEX:897 (Phase 5.A LAN with StrictMode unit test). Each bullet includes `useMemo` + `Math.random()` pattern + grep audit + (4.C/5.A) StrictMode double-mount Vitest. |
| **m1** — Types regen DoD across 18-20 phases | ✓ | 19 `pnpm db:reset && pnpm db:types` bullets across phases 0.2, 1.A, 1.B, 1.C, 1.D, 2.A, 2.B, 2.C, 2.D, 3.A, 3.B, 3.C, 4.B, 4.C (conditional), 5.A, 5.B, 5.C, 5.D, 6.A, 6.B. Verified via `grep -c "db:reset && pnpm db:types"` = 19 phase-level hits + 1 CI workflow line. |
| **m2** — Refund audit unconditional | ✓ | INDEX:132 Phase 0.1 DoD "**Audit refund JE inconditionnel**…**résultat documenté indépendamment du finding**"; INDEX:219 migration `000013` is "**inconditionnel** (Phase 0.1 audit documente l'état actuel ; refactor exécuté quoi qu'il arrive…)"; INDEX:220 new dedicated `000014` for `refund_order_rpc_v2` bump (separated from `000013` per planner claim); spec:111 D16 reworded "audit unconditional + unconditional refactor". 0 hits for "si hardcodé" / "if hardcoded" gates in INDEX `000013`. |
| **m3** — `view_section_stock_details` migration in Phase 2.D | ✓ | INDEX:131 Phase 0.1 verifies absence; spec:164 D2 reworded "à créer Phase 2.D"; INDEX:597 lists migration `20260517000097_create_view_section_stock_details.sql` in Phase 2.D; INDEX:615 DoD "8 migrations appliquées (000090..097 — incluant `view_section_stock_details`)"; INDEX:622 DoD "queryable + remplace tout usage de phantom `stock_balances`". |
| **m4** — Migration `000020` split into 4 | ✓ | INDEX:223-226 lists 4 distinct migrations with `[m4 split N/3]` annotation: `000020_extend_record_stock_movement_v1_lot_id` (RPC extension), `000021_add_stock_movements_lot_id_column` (split 1/3), `000022_create_tr_stock_movement_je_function` (split 2/3), `000023_attach_tr_stock_movement_je_trigger_and_idempotency` (split 3/3). INDEX:243 DoD confirms count "**13 migrations**" (was 11) with explicit numbering `000001..005, 000010..016, 000020..023`. |
| **m5** — Drop legacy `audit_log` singular | ✓ (with **minor finding** below) | INDEX:282 migration `20260517000034_drop_legacy_audit_log_singular.sql` in Phase 1.B — migrates rows → drops table → updates consumers; spec:291 declares canonical = `audit_logs` plural (matches `journal_entries`/`stock_movements` convention); INDEX:314 Phase 1.B DoD has grep audit "0 hit on singular form"; spec:294, 302 update all references to `audit_logs` plural. |

**Score**: **9/9 fixes verifiably implemented.** One internal-consistency miss (m5 finding below) is cosmetic.

### Minor finding (non-blocking)

- **m5-bis (cosmetic contradiction in Phase 0.1 DoD)** — INDEX line 126 says *"`audit_logs` (legacy) → `audit_log` (canonical singular)"* while line 133 (same phase, same DoD) says *"canonical = `audit_logs` plural"*. The migration name (`drop_legacy_audit_log_singular.sql`), the spec (line 291), and the consumer-update guidance (lines 294, 302) all consistently designate **plural** as canonical. Line 126 is a left-over inversion from an earlier draft.
  - **Suggested fix** (1-min edit) : INDEX line 126 should read *"`audit_log` (legacy singular) → `audit_logs` (canonical plural)"* — direction reversed.
  - **Impact** : If a Phase 0.1 subagent reads only the translation-table bullet, they may document the wrong direction. Caught by every other reference downstream, but worth fixing for consistency.

### Re-pass coverage matrix (original 13 checks)

| # | Check | Initial verdict | Re-pass verdict | Delta |
|---|-------|-----------------|------------------|-------|
| 1 | Every audit risk addressed or deferred | PASS | **PASS** | unchanged |
| 2 | Migration numbering monotonic | PASS | **PASS** | renumbering for [m4] split is monotonic (`000020..023` strictly < `000030`) |
| 3 | Phases isolated for parallel execution | PASS w/ caveat | **PASS** | [m4] split clarifies 1.A → 1.C dependency (1.C waits for `000021` not `000020`) |
| 4 | RPC versioning honored | NEEDS FIX | **PASS** | B2 (no fictional DROP), refund_order_rpc_v2 in dedicated `000014`, complete_order/pay_existing bumps clean |
| 5 | `stock_movements` writes via RPCs only | PASS w/ caveat | **PASS** | B1 resolved — no AFTER INSERT/UPDATE triggers manipulating ledger columns |
| 6 | `unit` NOT NULL + section constraints | PASS | **PASS** | unchanged (extended RPC still auto-resolves `unit` from `products.unit`) |
| 7 | Types regen DoD per migration-touching phase | NEEDS FIX | **PASS** | m1 — 19 phase-level bullets confirmed |
| 8 | Types regen step explicit | NEEDS FIX | **PASS** | same as #7 |
| 9 | PIN auth wrapper not bypassed | PASS | **PASS** | unchanged |
| 10 | Tests at 3 layers planned | PASS | **PASS** | extended with 3 new F1 invariant tests + `T_TRIGGER_ORDER_STOCK_MOVEMENTS` |
| 11 | Plan executable via `superpowers:executing-plans` | PASS | **PASS** | unchanged |
| 12 | Realtime channel uniqueness | NEEDS FIX | **PASS** | M2 — DoD on 4.B/4.C/5.A explicit with grep + StrictMode tests |
| 13 | All 25 modules covered | PASS | **PASS** | unchanged |

**Re-pass score** : **13 / 13 PASS** (was 8 / 13 in initial review).

### Outstanding blockers / majors

**None.** All 2 blockers (B1, B2) and 2 majors (M1, M2) from the initial review are resolved. The single m5-bis contradiction is cosmetic and does not block Wave 0.

### Sign-off

**Ready for `superpowers:executing-plans` Wave 0.** Recommended kickoff:

```
/skill superpowers:executing-plans
# Then dispatch 3 parallel subagents on Wave 0 phases:
#   - arch-steward   → docs/workplan/refs/2026-05-13-v2-v3-path-translation.md + decision-pack.md
#   - ops-steward    → .github/workflows/ci.yml + staging-deploy.yml + staging-config.md
#   - sec-design + ui-steward → kiosk-auth-design.md + ui-steward-charter.md
# Wave 0 sync-gate (all 3 green) → launch Wave 1 (1.A strictly seq, 1.B/1.C/1.D parallel)
```

Optional 1-min cleanup before kickoff : fix INDEX line 126 direction (see m5-bis).

---

## Historical record — initial review (2026-05-13)

The original review section below is preserved verbatim as historical context. Its NEEDS FIXES verdict has been superseded by the 2026-05-14 re-pass verdict above.

---

## Verdict

**NEEDS FIXES** — Plan is structurally sound and executable, but **three factual claims about V3 state** are inaccurate and would mislead executing subagents into writing invalid SQL. Two are blockers (will cause migration failures), one is a major (sequencing fragility). Audit and spec are otherwise excellent; INDEX coverage of waves/phases is comprehensive; per-module acceptance is testable.

Once the four blockers/majors below are fixed (≈ 30 min of edit work to the INDEX), the plan is ready for `superpowers:executing-plans` Wave 0 kickoff.

---

## Coverage matrix (13 checks)

| # | Check | Status | One-line evidence |
|---|-------|--------|-------------------|
| 1 | Every audit risk addressed or deferred in plan | **PASS** | Audit §4 R1-R14 + spec §6 R1-R20 cross-referenced; R12 (multi-currency) explicitly deferred Wave 7; R16/R17/R18/R19/R20 added net-new in spec. |
| 2 | Migration numbering monotonic vs `supabase/migrations/` | **PASS** | Latest applied = `20260516000024`; all Session 13 migrations `20260517000001..20260517000220+`, no overlap. |
| 3 | Phases isolated for parallel execution post-Phase 1 | **PASS w/ caveat** | Migration numeric blocks separated per phase (1.A=001-020, 1.B=030-033, 1.C=040-045, 2.A=060-066, etc.). One real cross-phase coupling: 1.C `000042` adds FK that depends on 1.A `000020` having shipped the `lot_id` column — INDEX line 358 acknowledges this. See **B1** for shared-file risks. |
| 4 | RPC versioning honored | **NEEDS FIX** | `complete_order_with_payment_v8 → v9` and `pay_existing_order_v5 → v6` correctly DROP+CREATE'd. **BUT**: Plan claims to "DROP `evaluate_promotions(<v1 args>)`" — function does NOT exist in V3 migrations (see **B2**). Also `pay_existing_order` historically has NEVER used `_vN` suffix in SQL function name (audit §3.2 confirms: "versioned in filenames only"); promoting to `_v6` is a new pattern that needs the cart hook callers updated, which IS in plan line 225. |
| 5 | `stock_movements` writes via RPCs only | **PASS w/ caveat** | All Phase 1.C/2.A/3.A/3.C consumers call `record_stock_movement_v1`. **BUT** the F1 FIFO trigger `tr_fifo_consume_on_movement` (line 326) UPDATES `stock_movements.lot_id` post-INSERT via trigger — UPDATEs are RLS-revoked for `authenticated` (CLAUDE.md), trigger runs as `postgres` so technically allowed, but the ledger invariant is "append-only". See **M1**. |
| 6 | `unit` NOT NULL + section constraints respected | **PASS** | No direct INSERTs into `stock_movements` proposed. All RPC-callers pass via `record_stock_movement_v1` which auto-resolves `unit` from `products.unit` (per migration `20260516000019`). Section constraint relaxation (`20260516000020`) covers all movement types Phase 1+ uses. |
| 7 | Each phase ends with `pnpm db:reset && pnpm db:types` if migrations touched | **NEEDS FIX (minor)** | Explicit in DoD of phases 0.2, 1.A, 1.C, 2.A, 2.D. **Missing from DoD checklists**: 1.B (4 migrations), 1.D (no mig — OK), 2.B (7 mig), 2.C (3 mig), 3.A (5 mig), 3.B (3 mig), 3.C (7 mig), 4.B (2 mig), 4.C (1 opt mig), 5.A (2 mig), 5.B (1 mig), 5.C (3 mig), 5.D (1 mig), 6.A (3 mig), 6.B (3 mig). CI workflow @0.2 catches drift globally, but per-phase DoD should be explicit for executing subagents. |
| 8 | Types regen step explicit when migrations change schema | **NEEDS FIX (minor)** | Same as #7. INDEX line 1063 ("regen 15-25 cycles") is a global note, not per-phase. Spec §7.2 has session-wide DoD, but executing subagents work from sub-plans derived from per-phase DoD. |
| 9 | PIN auth fetch wrapper not bypassed | **PASS** | Plan line 286: `setSupabaseAccessToken.ts` (UPDATE) — supports kiosk JWT path. No `auth.setSession` or raw `Authorization` header anti-patterns proposed. Kiosk JWT issued via new EF `kiosk-issue-jwt` and threaded through the same custom fetch wrapper. D18 + D19 align. |
| 10 | Tests planned at all 3 layers (pgTAP / Vitest live / domain unit) | **PASS** | Every migration-touching phase declares tests at appropriate layers. Accounting Phase 1.A: pgTAP T1-T35 + 3 Vitest live + domain `packages/domain/src/accounting/__tests__/`. Inventory F1 Phase 1.C: pgTAP T_F1_01-15 + Vitest live + domain `expiry/__tests__/`. Production Phase 2.A: pgTAP T_PROD + Vitest live + domain `production/__tests__/`. BO smoke tests present for every UI-producing phase. |
| 11 | Plan executable via `superpowers:executing-plans` | **PASS** | Each of the 25 phases has: Goal, Modules touched, Files touched (CREATE/UPDATE annotated), DoD checklist (`- [ ]`), Complexity (S/M/L), Dependencies, Suggested executor (named subagent), Parallelization tag. Comms pattern documented INDEX §"Comms entre subagents". Sub-plan filename convention `2026-05-13-session-13-phase-NN-{slug}.md` formalized line 87. |
| 12 | Realtime channel uniqueness (new channels) | **NEEDS FIX (minor)** | D19 in spec mandates `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` pattern for ALL new realtime hooks. INDEX names new hooks: `useDisplayRealtime` (4.C line 802), `lanHub/lanClient` (5.A), KDS extensions (4.B). **No per-phase DoD explicitly requires "channel name uses `useMemo` + random suffix" audit**. Plan §spec D19 audit grep is mentioned in spec but not enforced in plan DoD. See **M2**. |
| 13 | All 25 modules covered (or out-of-scope with reason) | **PASS** | Spec §4 has subsection for each of modules 01-25 with at minimum ✅ or ❌ acceptance criteria + dependency map. Module 18 explicitly out-of-scope (D7→PWA-first, deferred Session 16). Module 09 portal explicitly deferred Phase 7. All 25 module backlog files in `docs/workplan/backlog-by-module/01-…25-…md` are reflected. |

**Score** : **8 PASS / 5 NEEDS FIX** (2 blocker-class, 1 major, 2 minor across the 5).

---

## Issues found

### Blockers (must fix before Wave 0 starts)

#### **B1 — Phase 1.C FIFO trigger violates `stock_movements` append-only invariant (per CLAUDE.md)**

- **Location** : INDEX line 326 (`20260517000043_create_fifo_trigger_and_lot_rpcs.sql`).
- **Quote** : *"trigger `tr_fifo_consume_on_movement()` AFTER INSERT on `stock_movements` WHEN movement_type IN ('sale','sale_void','waste','transfer_out','production_out') — sélectionne le lot le plus proche d'expirer (`ORDER BY expires_at ASC LIMIT 1`), décrémente `stock_lots.quantity`, **set `stock_movements.lot_id`**"*.
- **Problem** : Setting `stock_movements.lot_id` from an AFTER INSERT trigger requires an UPDATE on the just-inserted row. CLAUDE.md mandate: *"`stock_movements` is an append-only ledger — RLS revokes UPDATE/DELETE for `authenticated`"*. Even though the trigger runs as `postgres` (bypasses RLS via SECURITY DEFINER on enclosing RPC), it **breaks the append-only contract** that downstream auditors, reports, and reconciliation tools rely on. D15 was specifically written to forbid this pattern ("FIFO trigger n'insère pas dans `stock_movements`").
- **Suggested fix** : Two options.
  - **(a) Preferred** : Resolve lot_id BEFORE INSERT — make `record_stock_movement_v1` accept an optional `p_lot_id UUID` parameter, and have the caller (cart, POS, production RPC, waste RPC) resolve the FIFO lot UPFRONT (call `SELECT id FROM stock_lots WHERE product_id=? AND status='active' ORDER BY expires_at ASC LIMIT 1 FOR UPDATE`) then pass it in. The decrement of `stock_lots.quantity` becomes a side-effect of `record_stock_movement_v1` (or a BEFORE INSERT trigger on stock_movements that only updates the lot row, not the movement row).
  - **(b) Acceptable** : Change the column from `stock_movements.lot_id` to a new join table `stock_movement_lots(movement_id, lot_id, quantity_consumed)` written by `record_stock_movement_v1` itself. Keeps `stock_movements` truly append-only.
- **Why it matters** : F1 is XL P0 — getting the trigger architecture wrong means the entire expiry module is rebuilt mid-session. The pgTAP `T_F1_LOT_INVARIANT` (line 348) is described as "RLS authenticated INSERT direct → denied" — but does NOT test "no UPDATE post-INSERT on lot_id". Add that test too.

#### **B2 — `evaluate_promotions(<v1 args>)` does not exist in V3 — DROP statement will fail**

- **Location** : INDEX line 533 (Phase 2.C migration `20260517000081_create_evaluate_promotions_v2.sql`).
- **Quote** : *"DROP `evaluate_promotions(<v1 args>)` ; CREATE `evaluate_promotions_v2(...)`"*.
- **Problem** : `evaluate_promotions` does NOT exist as a PostgreSQL function in any migration. Verification :
  - `grep -RE "FUNCTION (public\.)?evaluate_promotions" supabase/migrations/` → 0 hits.
  - `grep -R "evaluate_promotions" supabase/migrations/` → 0 hits.
  - Only docs (`docs/workplan/...`, `CLAUDE.md`) reference it.
- **Root cause** : The audit §3.2 listed `evaluate_promotions` as "unversioned (assumed) — v2 (BOGO/threshold engine)". The "(assumed)" was a yellow flag the planner did not chase down. The original promotions engine (`20260511000001_init_promotions.sql`, `20260511000002_init_promotion_applications.sql`) defines tables + RLS but **no `evaluate_promotions` SQL function** — the matching logic likely lives in `packages/domain/src/promotions/` (pure TS).
- **Suggested fix** :
  - Drop the "DROP `evaluate_promotions(<v1 args>)`" clause from migration `20260517000081`.
  - Reframe Phase 2.C as **build-from-scratch** for the DB-side engine (matching the actual Module 10 pattern: spec §0.2 acknowledged accounting is "embryonnaire", same is true for promotions).
  - Update audit §3.2 table row for `evaluate_promotions`: current version = **none (TS-only)** ; Session 13 plan = **build_v1** in `packages/supabase` SQL + new RPC name `evaluate_promotions_v1` (or `_v2` if reusing the TS engine name to ease consumer migration).
  - Update spec §3 D14: "evaluate_promotions → evaluate_promotions_v2 (Phase 2, BOGO+threshold)" → clarify "new SQL RPC (no prior SQL fn)".

### Majors

#### **M1 — Two AFTER INSERT triggers on `stock_movements` will execute in alphabetical order; ordering is fragile**

- **Location** : INDEX line 219 (Phase 1.A `20260517000020` creates `tr_stock_movement_je`) + line 326 (Phase 1.C `20260517000043` creates `tr_fifo_consume_on_movement`).
- **Problem** : PostgreSQL fires AFTER INSERT triggers in alphabetical order by trigger name. `tr_fifo_consume_on_movement` < `tr_stock_movement_je` — FIFO fires FIRST. This means the `lot_id` column is filled in before the JE trigger reads it. That's likely what was intended, but it's not stated explicitly in either migration. If a future migration introduces a third trigger (e.g. `tr_section_stock_update`), ordering breaks silently.
- **Suggested fix** : Add explicit trigger name prefixes to encode ordering : `tr_10_fifo_consume`, `tr_20_section_stock`, `tr_30_je_emit`. Document the ordering contract in a comment block on `stock_movements`. Add a pgTAP test that asserts trigger fire order via `INSERT` + selective `SELECT lot_id, je_id FROM stock_movements WHERE id=…`.

#### **M2 — Realtime channel naming D19 not enforced per-phase DoD**

- **Location** : Spec §3 D19 (mandates `useMemo` + random suffix pattern). INDEX phases 4.B, 4.C, 5.A introduce new realtime hooks without per-phase DoD bullet.
- **Problem** : `useDisplayRealtime` (4.C), KDS handlers update (4.B), LAN realtime (5.A) all introduce realtime channels. CLAUDE.md is explicit: *"Realtime channel names must be unique per mount — StrictMode double-mounts components and shared channel names collide silently"*. Spec mentions D19 but plan DoD doesn't enforce. An executing subagent reading their phase plan won't see the constraint.
- **Suggested fix** : Add to DoD of phases 4.B, 4.C, 5.A:
  ```
  - [ ] All new realtime hooks follow `useKdsRealtime.ts` pattern (channelName via useMemo + random suffix). Audit: `grep -RE "supabase\.channel\(" apps/pos/src/features/{display,kds,lan}/` returns 0 hardcoded literal channel names.
  ```

### Minors

#### **m1 — Per-phase types-regen DoD missing on 13 phases (checks #7 + #8)**

- **Location** : INDEX phases 1.B, 2.B, 2.C, 3.A, 3.B, 3.C, 4.B, 4.C, 5.A, 5.B, 5.C, 5.D, 6.A, 6.B (all touch migrations but DoD checklist omits the regen step).
- **Suggested fix** : Append to each affected phase's DoD:
  ```
  - [ ] `pnpm db:reset && pnpm db:types` clean; `packages/supabase/src/types.generated.ts` regen committed.
  ```
  (Phase 0.2's CI workflow catches drift globally, but per-phase enforcement reduces back-and-forth between subagent and reviewer.)

#### **m2 — Refund JE audit is conditional ("si hardcodé") — should be explicit Phase 0 task**

- **Location** : INDEX line 216 (`20260517000013_refactor_refund_je.sql`) + spec D16.
- **Quote** : *"refactor `fn_create_je_for_refund` (audité Phase 0.1) si hardcodé → utilise mapping…"*.
- **Problem** : Phase 0.1 DoD doesn't explicitly include "audit `fn_create_je_for_refund` (`20260512000005`) for hardcoded codes". The conditional execution path of `20260517000013` is unclear. If Phase 0.1 doesn't flag it, the migration becomes ambiguous.
- **Suggested fix** : Add to Phase 0.1 DoD:
  ```
  - [ ] Audit `fn_create_je_for_refund` in migration `20260512000005_init_refund_je_trigger.sql` — confirm hardcoded codes vs mapping-resolved. Result documented in `docs/workplan/refs/2026-05-13-decision-pack.md` section "Refund JE".
  ```
  Then make migration `20260517000013` unconditional (always emit the refactor, since the V3 trigger predates the mapping table).

#### **m3 — `view_section_stock_details` referenced in spec D2 but does not exist**

- **Location** : Spec §3 D2(b) — *"`stock_balances` → DROP usage (remplacer par `section_stock` + `view_section_stock_details` déjà en place via Session 12)"*.
- **Problem** : `grep -R "view_section_stock_details" supabase/migrations/` → 0 hits. The view is referenced as "déjà en place" but doesn't exist. Section 12 Phase 3 transfers UI uses raw `section_stock` JOIN queries, not a view.
- **Suggested fix** : Either (a) the view was renamed — verify exact name in `packages/supabase/src/types.generated.ts` and update spec; or (b) it needs to be created — add migration `20260517000046_create_view_section_stock_details.sql` to Phase 1.C or Phase 2.D.

#### **m4 — Phase 1.A migration `20260517000020` mixes 3 unrelated concerns**

- **Location** : INDEX line 219.
- **Problem** : One migration adds `stock_movements.lot_id`, creates `tr_stock_movement_je()` function, attaches the trigger, AND adds UNIQUE idempotency on `journal_entries`. That's 4 distinct operations. If any fails, rollback is ambiguous. Style-wise breaks the "one concern per migration" pattern visible in `20260516000019-024` (each fix isolated).
- **Suggested fix** : Split into 3 migrations: `000020_add_stock_movements_lot_id_column.sql`, `000021_create_tr_stock_movement_je_function.sql`, `000022_attach_tr_stock_movement_je_trigger_and_je_idempotency.sql`. Renumber downstream migrations in Phase 1.A (`000010-000015` shift to 010-013, 022-024) — net adds 2 migrations.

#### **m5 — `audit_log` vs `audit_logs` resolution deferred but Phase 0.1 has no concrete drop migration**

- **Location** : Spec §4 Module 19 — *"décision Phase 0 : canonical = `audit_log` ; `audit_logs` (si reste de V2 leftover) à dropper. Phase 0/1"*. INDEX Phase 0.1 doesn't list a migration.
- **Problem** : Both `audit_log` (singular, `20260515000002`) and `audit_logs` (plural, `20260503000005`/`20260503000007`) exist in V3. If both stay, every audit consumer must know which to query. Dropping `audit_logs` is a P1 cleanup; deferring it past Phase 0 risks tech debt persistence.
- **Suggested fix** : Add migration `20260517000034_drop_legacy_audit_logs.sql` to Phase 1.B Security stream. DoD: "0 references to `audit_logs` table in apps/packages/migrations".

---

## Top 5 fixes the planner should address before execution

1. **B1 (blocker)** — Redesign F1 FIFO lot tracking to NOT UPDATE `stock_movements.lot_id` post-INSERT. Either (a) resolve lot UPFRONT and pass via `record_stock_movement_v1` parameter, or (b) extract to `stock_movement_lots` join table. Update INDEX line 326 + add pgTAP `T_F1_NO_UPDATE_INVARIANT`.

2. **B2 (blocker)** — Drop the "DROP `evaluate_promotions(<v1 args>)`" clause in migration `20260517000081`. Acknowledge it's build-from-scratch (no SQL fn predecessor). Update spec D14 row and audit §3.2 table.

3. **M1 (major)** — Add numeric prefixes to triggers on `stock_movements` (`tr_10_fifo_consume`, `tr_20_je_emit`) to encode firing order. Document in COMMENT ON TABLE. Add pgTAP for ordering.

4. **M2 (major)** — Add per-phase DoD bullet enforcing D19 realtime channel uniqueness to phases 4.B, 4.C, 5.A.

5. **m1 (minor batch)** — Sweep DoD checklists for phases 1.B, 2.B, 2.C, 3.A, 3.B, 3.C, 4.B, 4.C, 5.A, 5.B, 5.C, 5.D, 6.A, 6.B — add `pnpm db:reset && pnpm db:types` regen-committed bullet wherever migrations are touched. (15 trivial edits, ~10 min.)

---

## Sign-off note (deferred — pending NEEDS FIXES)

When B1, B2, M1, M2, and m1 are addressed:

> **Ready for `superpowers:executing-plans` Wave 0.** Start with phases 0.1 (translation table + decision pack), 0.2 (staging + CI), 0.3 (kiosk-auth + ui-steward charter) in parallel via 3 subagents (`arch-steward`, `ops-steward`, `sec-design` + `ui-steward`). Wave 0 sync-gate before Wave 1 launch.

---

## Out-of-scope verification (modules / decisions)

| Item | Spec § | Status |
|------|--------|--------|
| Multi-currency (10-019) | §2.2, §9 | DEFERRED Wave 7 → Session 14 |
| Multi-tenancy (19-008) | §2.2, §9 | DEFERRED Wave 7 → Session 15 |
| Mobile shell Capacitor (Module 18) | §2.2, §9 | DEFERRED Wave 7 → Session 16 (D7 PWA-first) |
| B2B portal (09 cascade) | §2.2, §9 | DEFERRED Wave 7 → Session 17 |
| e-Faktur (10-014) | §2.2, §9 | DEFERRED Wave 7 → Session 18 |
| Voice ordering, ML forecasting | §9 | DEFERRED Sessions 19-20 |
| Sub-recipes récursifs (F6 complet) | §2.2, §9 | DEFERRED — D3 acted: 15 owns flat `recipes`, recursive deferred Q3+ |
| Multi-LAN site-to-site (21-011) | §9 | DEFERRED |
| 2FA / TOTP | §4 Module 01 | DEFERRED Phase 7 |
| OCR receipts | §4 Module 11 | DEFERRED Phase 7 |
| Dark mode complete | §4 Module 22 | DEFERRED Phase 6+ |
| Backup verification cron | §4 Module 24 | DEFERRED Phase 6 |

All explicit deferrals have a session target. No dangling out-of-scope items.

---

## Audit-to-spec-to-plan trace

| Audit risk/decision | Spec resolution | Plan implementation |
|---------------------|-----------------|---------------------|
| R1 V2→V3 paths | D1 + §2.1 Phase 0 | Phase 0.1 file `docs/workplan/refs/2026-05-13-v2-v3-path-translation.md` |
| R2 Accounting P0 sequential | D11-D14 + §4 Module 10 | Phase 1.A single subagent `acct-stream`, migrations 001-020 |
| R3 reference_type CHECK | D13 (17 types listed) | Migration `20260517000003` |
| R4 RLS PII | D18 kiosk-JWT + §4 Module 25 | Phase 1.B migrations `000032-033`, EF `kiosk-issue-jwt` |
| R5 F1 ledger invariant | D15 | Phase 1.C — **B1 not yet honored** |
| R6 F6 dual-claim | D3 (15 owns, 05 reads) | Phase 2.A creates `recipes`, Phase 2.A creates `view_product_recipes` |
| R7 Types regen | §7.2 + Phase 0.2 CI | Phase 0.2 CI workflow — **m1 not per-phase** |
| R8 Phantom-tables | D2 (5 phantoms resolved) | Phase 1.B (audit_log), Phase 2.D (stock_balances), Phase 3.C (stock_reservations), Phase 5.A (print_queue), Phase 5.C (get_settings_by_category) |
| R9 Notifications XL | D5 (Supabase EF, email-only MVP) | Phase 5.B `notification-dispatch` EF |
| R10 packages/ui contention | D9 ui-steward singleton | Phase 0.3 charter, batches in Phases 1.D / 4.D / 6.B |
| R11 LAN architecture | D4 hybrid Realtime+BroadcastChannel | Phase 5.A port + `packages/domain/src/lan/` |
| R12 Multi-currency | §2.2 deferred Phase 7 | Wave 7 |
| R13 Sentry + cold-start separation | §6 R13 + Phase 6.C | Phase 6.C Sentry; cold-start deferred |
| R14 has_permission re-publish | D10 lookup-pur refactor | Phase 1.B migration `20260517000030` |

All 14 audit risks have a spec resolution and a plan implementation (modulo B1 + B2 + M1 + M2 + m1-m5).

---

## Strengths to acknowledge

1. **Audit is exceptionally rigorous** — 13 open questions Section 6 are concrete, decision-ready, and each maps to a single phase 0 task. Risk matrix top-14 + honorable mentions cross-cut cleanly.

2. **Spec §3 decision table (D1-D20)** is a model of disciplined decision capture — every decision has a rationale and a phase anchor.

3. **Spec §4 per-module acceptance criteria** is testable, prioritized (✅/❌), and explicitly cites which phase each item lands in.

4. **Plan wave architecture** (0 → 1 strictly seq within 1.A → 2-6 parallel) matches the project's session-12 shape (used as reference) and respects critical-path constraints (accounting blocks production, security blocks 25-001).

5. **Migration numbering discipline** — block reservations per phase (1.A=01-20, 1.B=30-33, 1.C=40-45, ...) prevent inter-phase collisions while preserving global monotonicity. Future-proof for renumbering.

6. **Tests at 3 layers** consistently planned for every migration-touching phase — no phase ships without pgTAP + Vitest live + domain unit (where applicable).

7. **V3-vs-V2 reality** is honestly acknowledged — spec §0 (3) admits "accounting V3 est embryonnaire" rather than papering over the gap.

8. **Risk register §6 has 20 entries** (audit had 14) — R15-R20 are net-new and catch subagent-coordination-class risks (migration block exhaustion, parallel file conflicts, sub-plan oversight).

---

## File paths

Reviewed files (all absolute):
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\specs\2026-05-13-session-13-architecture-audit.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\specs\2026-05-13-session-13-spec.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\plans\2026-05-13-session-13-INDEX.md`

Baseline files consulted:
- `C:\Users\MamatCEO\The_Breakery_ERP\CLAUDE.md`
- `C:\Users\MamatCEO\The_Breakery_ERP\supabase\migrations\` (24 migrations, latest `20260516000024`)
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\backlog-by-module\` (27 module files)
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\plans\2026-05-12-session-12-inventory-complete-INDEX.md` (shape reference)

This review file:
- `C:\Users\MamatCEO\The_Breakery_ERP\docs\workplan\specs\2026-05-13-session-13-review.md`

---

*End of review. Reviewer signs off pending NEEDS FIXES resolution. Lead may proceed with the planner re-iteration loop or accept the plan with documented technical debt on B1/B2.*
