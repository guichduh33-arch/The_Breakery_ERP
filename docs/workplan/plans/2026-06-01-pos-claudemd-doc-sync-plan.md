# CLAUDE.md doc sync (stale RPC versions) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: invoke `superpowers:writing-plans` to author. Steps use checkbox (`- [ ]`) syntax. **Doc-only** — no code, no migration, no test. Single bullet edit + a grep verification.

**Goal:** Correct the stale RPC versions cited in the **Critical pattern** "Order writes go through RPCs" at `CLAUDE.md:61`, so the present-tense assertions match the versions the code actually calls (2026-06-01).

**Architecture:** Edit exactly one bullet. The §Active Workplan session references are **append-only history** and MUST NOT be touched — only the present-tense Critical-patterns bullet is in scope.

**Spec:** [`../specs/2026-06-01-pos-claudemd-doc-sync-spec.md`](../specs/2026-06-01-pos-claudemd-doc-sync-spec.md)
**Branch:** `docs/claudemd-rpc-versions-sync` (from `master` @ `70c5cf1`)
**Effort:** S (~0.25 day)

---

## Verified facts (code `fichier:ligne`, 2026-06-01)

Current text — `CLAUDE.md:61`:
> "**Order writes go through RPCs** — never raw inserts. RPCs: `complete_order` (v6), `pay_existing_order` (v3), `create_tablet_order`, `pickup_tablet_order`, `evaluate_promotions`, `mark_item_served`. …"

| Cited (CLAUDE.md:61) | Real version called | Proof |
|---|---|---|
| `complete_order` **(v6)** | `complete_order_with_payment_v10` | `supabase/functions/process-payment/index.ts:149` + migration `20260530190828_bump_complete_order_v10.sql`. **The POS does NOT call this RPC directly** — `useCheckout.ts:124` POSTs the EF `process-payment`, which calls the RPC server-side. |
| `pay_existing_order` **(v3)** | `pay_existing_order_v6` | `apps/pos/src/features/payment/hooks/useCheckout.ts:93` `supabase.rpc('pay_existing_order_v6', ...)` + type alias `Database['public']['Functions']['pay_existing_order_v6']` at `useCheckout.ts:7` (tablet pickup path). |
| `create_tablet_order` | `create_tablet_order_v2` | `apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts:19` (S25 hardening). |
| `pickup_tablet_order` | `pickup_tablet_order` (unversioned) | `apps/pos/src/features/inbox/hooks/usePickupTabletOrder.ts:43` — **doc OK**. |
| `evaluate_promotions` | `evaluate_promotions_v1` | `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts:166`. |
| `mark_item_served` | `mark_item_served` (unversioned) | `apps/pos/src/features/kds/hooks/useMarkItemServed.ts:14` — **doc OK**. |

**Audit imprecision corrected:** the audit claimed the code calls `complete_order_with_payment_v10` in `useCheckout.ts`. In reality `useCheckout.ts:124` POSTs the EF `process-payment`; the EF (`process-payment/index.ts:149`) calls the RPC. The version correction (v6 → v10) stands, but the call-site is the EF, not the hook — the replacement text must reflect that nuance.

---

## File Structure (overview)

```
CLAUDE.md   (EDIT — line 61 bullet only)
```

---

## Phase 0 — branch

- [ ] **P0.1** Create `docs/claudemd-rpc-versions-sync` from `master` @ `70c5cf1` ; commit spec + plan.

---

## Phase 1 — re-verify versions at call-site (gate)

- [ ] **P1.1** Re-confirm each version at its call-site (RPC versions are monotonic and may have bumped since the spec was written):
  - `grep -rn "complete_order_with_payment_v10" supabase/functions`
  - `grep -rn "pay_existing_order_v6\|create_tablet_order_v2\|evaluate_promotions_v1" apps/pos/src`
  - confirm `pickup_tablet_order` and `mark_item_served` are still unversioned at their call-sites.
  If any version differs from the table above, use the **current** one and note it in the deviations log.

---

## Phase 2 — edit the bullet

- [ ] **P2.1** Replace the `CLAUDE.md:61` bullet with (adjusting versions to whatever P1.1 confirms):
  > "**Order writes go through RPCs** — never raw inserts. RPCs: `complete_order_with_payment_v10` (called server-side by the `process-payment` EF — the POS does NOT call it directly), `pay_existing_order_v6`, `create_tablet_order_v2`, `pickup_tablet_order`, `evaluate_promotions_v1`, `mark_item_served`. They handle JE triggers, loyalty, promotions, table state atomically. (RPC versions are monotonic — verify `supabase/migrations/` + the call-site before relying on a version.)"
- [ ] **P2.2** Confirm no other lines changed (`git diff CLAUDE.md` shows only line 61's bullet). Do **not** touch §Active Workplan session references (append-only history).

---

## Phase 3 — PR

- [ ] **P3.1** PR `docs/claudemd-rpc-versions-sync` → `master`. Title `docs(claude): sync stale RPC versions in "Order writes go through RPCs" pattern`. Body links spec + lists the corrected versions.

---

## Acceptance criteria

- [ ] `CLAUDE.md:61` cites `complete_order_with_payment_v10`, `pay_existing_order_v6`, `create_tablet_order_v2`, `evaluate_promotions_v1` (real versions).
- [ ] The nuance "`complete_order_with_payment_v10` is called via the `process-payment` EF, not directly by the POS" is present (or at least the text does not suggest a direct hook call).
- [ ] `pickup_tablet_order` and `mark_item_served` remain unversioned (correct).
- [ ] No other change (doc-only); §Active Workplan history untouched.

---

## Risks / dependencies

- **Risk nil** — doc-only, no runtime impact.
- **Append-only caution** — do not confuse the Critical-patterns bullet (to fix) with §Active Workplan session references (immutable history).
- If a new migration bumps one of these RPCs between this plan and execution, re-verify at the call-site (P1.1) before editing.

## Deviations log (fill during execution)

| ID | Severity | Description |
|---|---|---|
| _(à compléter — e.g. version bumped since spec)_ | | |

## Out of scope

- Rewriting version references in §Active Workplan (append-only per-session history — DO NOT touch).
- Any real RPC bump (doc-only).
- Exhaustive audit of every RPC version in the project (only the "Order writes" bullet is at fault).
