# CLAUDE.md doc sync (stale RPC versions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the stale RPC versions cited in the Critical-pattern bullet "Order writes go through RPCs" at `CLAUDE.md:61` so its present-tense assertions match the versions the code actually calls as of 2026-06-01.

**Architecture:** This is a **DOC-ONLY** change. Exactly one bullet of `CLAUDE.md` (line 61) is edited. The §Active Workplan session references that also cite RPC versions are **append-only history** describing the state at each past session — they MUST NOT be touched. Because RPC versions on this project are monotonic (a `_vN+1` can be published at any time), the plan re-verifies every cited version at its call-site immediately before editing, so execution never freezes an already-stale version. "Tests" here are `grep` verifications at the call-site with an exact command and an exact expected output.

**Tech Stack:** Markdown (`CLAUDE.md`), `grep`/ripgrep for call-site verification, `git` + `gh` for branch and PR. No application code, no SQL migration, no runtime test framework.

**Spec:** [`../specs/2026-06-01-pos-claudemd-doc-sync-spec.md`](../../specs/archive/2026-06-01-pos-claudemd-doc-sync-spec.md)
**Branch:** `docs/claudemd-rpc-versions-sync` (from `master` @ `70c5cf1`)
**Effort:** S (~0.25 day)

---

## Verified facts (code `file:line`, confirmed 2026-06-01)

Current text — `CLAUDE.md:61` (literal, verified present at line 61):
> `- **Order writes go through RPCs** — never raw inserts. RPCs: \`complete_order\` (v6), \`pay_existing_order\` (v3), \`create_tablet_order\`, \`pickup_tablet_order\`, \`evaluate_promotions\`, \`mark_item_served\`. They handle JE triggers, loyalty, promotions, table state atomically.`

| Cited (CLAUDE.md:61) | Real version called | Proof (exact `file:line`) |
|---|---|---|
| `complete_order` **(v6)** | `complete_order_with_payment_v10` | `supabase/functions/process-payment/index.ts:149` (`userClient.rpc('complete_order_with_payment_v10', { … })`). **The POS does NOT call this RPC directly** — `apps/pos/src/features/payment/hooks/useCheckout.ts:124` POSTs the EF `process-payment`, and the EF calls the RPC server-side. |
| `pay_existing_order` **(v3)** | `pay_existing_order_v6` | `apps/pos/src/features/payment/hooks/useCheckout.ts:93` (`supabase.rpc('pay_existing_order_v6', …)`) + type alias `Database['public']['Functions']['pay_existing_order_v6']` at `useCheckout.ts:7`. |
| `create_tablet_order` | `create_tablet_order_v2` | `apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts:19` (`supabase.rpc('create_tablet_order_v2', …)`, S25 hardening). |
| `pickup_tablet_order` | `pickup_tablet_order` (unversioned) | `apps/pos/src/features/inbox/hooks/usePickupTabletOrder.ts:43` — **doc already correct**. |
| `evaluate_promotions` | `evaluate_promotions_v1` | `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts:166` (`supabase.rpc('evaluate_promotions_v1', rpcArgs)`). |
| `mark_item_served` | `mark_item_served` (unversioned) | `apps/pos/src/features/kds/hooks/useMarkItemServed.ts:14` — **doc already correct**. |

**Audit imprecision corrected:** the originating audit claimed the code calls `complete_order_with_payment_v10` in `useCheckout.ts`. In reality `useCheckout.ts:124` POSTs the EF `process-payment`; the EF (`process-payment/index.ts:149`) calls the RPC. The version correction (v6 → v10) stands, but the call-site is the EF, not the hook — the replacement bullet text reflects that nuance.

---

## File Structure (overview)

```
CLAUDE.md                                                  (MODIFY — line 61 bullet only; one responsibility: project Critical patterns)
docs/workplan/plans/2026-06-01-pos-claudemd-doc-sync-plan.md   (this plan — already on disk)
docs/workplan/specs/2026-06-01-pos-claudemd-doc-sync-spec.md   (spec — read-only contract)
```

Only `CLAUDE.md` changes. The bullet is a single line; the edit is self-contained and makes sense independently.

---

## Task 1: Branch + check in spec & plan

**Files:**
- Modify: none (git only)

- [ ] **Step 1: Create the working branch from the spec base**

Run:
```bash
git checkout master && git pull --ff-only
git checkout -b docs/claudemd-rpc-versions-sync
```
Expected: `Switched to a new branch 'docs/claudemd-rpc-versions-sync'`. (If `git log -1 --format=%h` no longer shows `70c5cf1`, branch from current `master` tip anyway — the base commit is informational, not load-bearing for a doc edit.)

- [ ] **Step 2: Stage and commit the spec + plan**

Run:
```bash
git add docs/workplan/specs/2026-06-01-pos-claudemd-doc-sync-spec.md docs/workplan/plans/2026-06-01-pos-claudemd-doc-sync-plan.md
git commit -m "docs(workplan): spec + plan for CLAUDE.md RPC-version sync"
```
Expected: one commit created with 2 files changed.

---

## Task 2: Re-verify every cited version at its call-site (gate)

**Files:**
- Modify: none (read-only verification — this is the "test" step for a doc-only plan)

> RPC versions are monotonic and a `_vN+1` may have been published since the spec was written. This task is the gate: if any command below prints a DIFFERENT version than the one in the "Verified facts" table, use the **printed** version in Task 3 and record it in the Deviations log. Do not edit until all five commands pass.

- [ ] **Step 1: Confirm `complete_order_with_payment_v10` is the version the EF calls**

Run:
```bash
grep -rn "complete_order_with_payment_v" supabase/functions
```
Expected (exact): one line —
```
supabase/functions/process-payment/index.ts:149:  const { data, error } = await userClient.rpc('complete_order_with_payment_v10', {
```
If the suffix is not `v10`, record the printed version in the Deviations log and use it in Task 3.

- [ ] **Step 2: Confirm the POS hook POSTs the EF (NOT the RPC directly)**

Run:
```bash
grep -n "functions/v1/process-payment" apps/pos/src/features/payment/hooks/useCheckout.ts
```
Expected (exact): one line at 124 —
```
124:      const res = await fetch(`${supabaseUrl}/functions/v1/process-payment`, {
```
This proves the "called server-side by the EF" nuance in the replacement text. If the hook instead calls `supabase.rpc('complete_order_with_payment_*')` directly, record it in the Deviations log and adjust the bullet's parenthetical.

- [ ] **Step 3: Confirm `pay_existing_order_v6`, `create_tablet_order_v2`, `evaluate_promotions_v1` in the POS**

Run:
```bash
grep -rn "supabase.rpc('pay_existing_order_v6'\|supabase.rpc('create_tablet_order_v2'\|supabase.rpc('evaluate_promotions_v1'" apps/pos/src
```
Expected (exact, 3 lines — order may vary):
```
apps/pos/src/features/payment/hooks/useCheckout.ts:93:        const { error, data } = await supabase.rpc('pay_existing_order_v6', args as PayExistingOrderArgs);
apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts:166:        const { data, error } = await supabase.rpc('evaluate_promotions_v1', rpcArgs);
apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts:19:      const { data, error } = await supabase.rpc('create_tablet_order_v2', {
```
If any of the three prints a higher version suffix, record it in the Deviations log and use the printed version in Task 3.

- [ ] **Step 4: Confirm `pickup_tablet_order` and `mark_item_served` are still UNVERSIONED**

Run:
```bash
grep -rn "supabase.rpc('pickup_tablet_order'\|rpc('mark_item_served'" apps/pos/src/features
```
Expected (exact, 2 lines):
```
apps/pos/src/features/inbox/hooks/usePickupTabletOrder.ts:43:      const { data: orderData, error: pickupError } = await supabase.rpc('pickup_tablet_order', {
apps/pos/src/features/kds/hooks/useMarkItemServed.ts:14:      }).rpc('mark_item_served', { p_item_id: itemId });
```
If either now shows a `_vN` suffix, record it in the Deviations log — these two must stay unversioned in the bullet otherwise.

---

## Task 3: Edit the `CLAUDE.md:61` bullet (the only change)

**Files:**
- Modify: `CLAUDE.md:61` (the "Order writes go through RPCs" bullet — and only that line)

> Use the `Read`-then-`Edit` tool flow with an exact string match. Below is the literal before → after. Substitute any version suffix that Task 2 reported as different.

- [ ] **Step 1: Verify the current text matches the before-block exactly**

Run:
```bash
grep -n "Order writes go through RPCs" CLAUDE.md
```
Expected (exact): one line —
```
61:- **Order writes go through RPCs** — never raw inserts. RPCs: `complete_order` (v6), `pay_existing_order` (v3), `create_tablet_order`, `pickup_tablet_order`, `evaluate_promotions`, `mark_item_served`. They handle JE triggers, loyalty, promotions, table state atomically.
```
If the printed line differs from the BEFORE block below (e.g. someone already partially fixed it), reconcile before editing — do not blind-replace.

- [ ] **Step 2: Apply the edit (literal before → after)**

**BEFORE** (the entire line 61, match it exactly including the leading `- ` and the em-dashes `—`):
```markdown
- **Order writes go through RPCs** — never raw inserts. RPCs: `complete_order` (v6), `pay_existing_order` (v3), `create_tablet_order`, `pickup_tablet_order`, `evaluate_promotions`, `mark_item_served`. They handle JE triggers, loyalty, promotions, table state atomically.
```

**AFTER** (replace the whole line with this; keep it a single line):
```markdown
- **Order writes go through RPCs** — never raw inserts. RPCs: `complete_order_with_payment_v10` (called server-side by the `process-payment` EF — the POS does NOT call it directly; `apps/pos/src/features/payment/hooks/useCheckout.ts:124` POSTs the EF, which calls the RPC at `supabase/functions/process-payment/index.ts:149`), `pay_existing_order_v6`, `create_tablet_order_v2`, `pickup_tablet_order` (unversioned), `evaluate_promotions_v1`, `mark_item_served` (unversioned). They handle JE triggers, loyalty, promotions, table state atomically. RPC versions are monotonic — verify `supabase/migrations/` + the call-site before relying on a version.
```

The `Edit` call: `old_string` = the BEFORE block, `new_string` = the AFTER block, `replace_all: false`.

- [ ] **Step 3: Confirm only line 61 changed and §Active Workplan history is untouched**

Run:
```bash
git diff --stat CLAUDE.md && git diff -U0 CLAUDE.md
```
Expected: `CLAUDE.md | 2 +-` (one line removed, one added — a single-line replacement); the unified diff shows exactly the BEFORE line removed and the AFTER line added, at line 61, and nothing in the §Active Workplan / session-reference region. If the diff touches any other line, revert with `git checkout CLAUDE.md` and redo the edit as a single-line replacement.

---

## Task 4: Post-edit verification grep + PR

**Files:**
- Modify: none (verification + git)

- [ ] **Step 1: Confirm the corrected versions are now present in the bullet**

Run:
```bash
grep -n "complete_order_with_payment_v10\|pay_existing_order_v6\|create_tablet_order_v2\|evaluate_promotions_v1" CLAUDE.md | grep ":61:"
```
Expected: line 61 prints (it contains all four corrected names) —
```
61:- **Order writes go through RPCs** — never raw inserts. RPCs: `complete_order_with_payment_v10` (called server-side by the `process-payment` EF …
```
If line 61 is not returned, the edit did not land — return to Task 3.

- [ ] **Step 2: Confirm the stale versions are gone from the bullet**

Run:
```bash
grep -n "RPCs: \`complete_order\` (v6)\|\`pay_existing_order\` (v3)" CLAUDE.md
```
Expected: **no output** (exit code 1). If anything prints, the BEFORE text is still present — return to Task 3.

- [ ] **Step 3: Commit the doc fix**

Run:
```bash
git add CLAUDE.md
git commit -m "docs(claude): sync stale RPC versions in \"Order writes go through RPCs\" pattern

complete_order (v6) -> complete_order_with_payment_v10 (via process-payment EF)
pay_existing_order (v3) -> pay_existing_order_v6
create_tablet_order -> create_tablet_order_v2
evaluate_promotions -> evaluate_promotions_v1
pickup_tablet_order / mark_item_served remain unversioned (already correct)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: one commit, 1 file changed.

- [ ] **Step 4: Push and open the PR**

Run:
```bash
git push -u origin docs/claudemd-rpc-versions-sync
gh pr create --base master --head docs/claudemd-rpc-versions-sync \
  --title "docs(claude): sync stale RPC versions in \"Order writes go through RPCs\" pattern" \
  --body "Corrects the Critical-pattern bullet at CLAUDE.md:61 to the versions the code actually calls (2026-06-01).

- \`complete_order\` (v6) -> \`complete_order_with_payment_v10\` (called server-side by the \`process-payment\` EF — useCheckout.ts:124 POSTs the EF; index.ts:149 calls the RPC)
- \`pay_existing_order\` (v3) -> \`pay_existing_order_v6\` (useCheckout.ts:93)
- \`create_tablet_order\` -> \`create_tablet_order_v2\` (useCreateTabletOrder.ts:19, S25)
- \`evaluate_promotions\` -> \`evaluate_promotions_v1\` (useEvaluatePromotions.ts:166)
- \`pickup_tablet_order\` / \`mark_item_served\` left unversioned (already correct)

DOC-ONLY: no code, no migration, no runtime test. §Active Workplan session references (append-only history) untouched. Spec: docs/workplan/specs/2026-06-01-pos-claudemd-doc-sync-spec.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
Expected: `gh` prints the new PR URL.

---

## Acceptance criteria

- [ ] `CLAUDE.md:61` cites `complete_order_with_payment_v10`, `pay_existing_order_v6`, `create_tablet_order_v2`, `evaluate_promotions_v1` (real versions confirmed in Task 2).
- [ ] The nuance "`complete_order_with_payment_v10` is called via the `process-payment` EF, not directly by the POS" is present in the bullet.
- [ ] `pickup_tablet_order` and `mark_item_served` remain unversioned (correct).
- [ ] No other change (doc-only); §Active Workplan session-reference history untouched (`git diff -U0 CLAUDE.md` shows only line 61).
- [ ] The "RPC versions are monotonic — verify before relying" reminder is appended to the bullet.

---

## Risks / dependencies

- **Risk nil** — doc-only, no runtime impact.
- **Append-only caution** — do not confuse the Critical-patterns bullet (to fix) with §Active Workplan session references (immutable per-session history). The project rule "dated specs/plans are append-only" applies to the CLAUDE.md session references too.
- **Monotonic-version race** — if a new migration bumps one of these RPCs between this plan and execution, Task 2's gate catches it; use the printed version and log it below.

## Deviations log (fill during execution)

| ID | Severity | Description |
|---|---|---|
| _(empty — populate if a Task 2 grep prints a version different from the Verified-facts table, or if the diff touches more than line 61)_ | | |

---

## Out of scope

- Rewriting version references in §Active Workplan (append-only per-session history — DO NOT touch).
- Any real RPC bump (doc-only).
- Exhaustive audit of every RPC version in the project (only the "Order writes go through RPCs" bullet is at fault).

---

## Self-Review (run against the spec with fresh eyes)

**1. Spec coverage** — every spec section maps to a task:
- Spec §1 (proof `file:line`) → Verified-facts table + Task 2 re-verification grep.
- Spec §2 (doc-only edit of the bullet, replacement text, monotonic-versioning note) → Task 3 before/after + the appended reminder sentence.
- Spec §3 acceptance criteria (4 items) → Acceptance criteria section (matched 1:1, plus the EF-nuance and monotonic-note items).
- Spec §4 (grep verification, only the Critical-patterns bullet, not §Active Workplan) → Task 2 (pre) + Task 4 Steps 1-2 (post) + Task 3 Step 3 diff guard.
- Spec §5 (hors scope) → Out of scope section.
- Spec §6 (risks, append-only caution, re-verify if bumped) → Risks/dependencies + Task 2 gate + Deviations log.
No gaps found.

**2. Placeholder scan** — no "TBD/TODO/implement later/add appropriate X". Every code/text step shows the literal content. The Deviations-log row is intentionally empty (it is a fill-during-execution record, not a plan placeholder) and is labelled as such. The Task 1 base-commit fallback ("branch from current master tip") is an explicit instruction, not a vague placeholder.

**3. Type/name consistency** — RPC names are identical across Verified-facts table, Task 2 greps, Task 3 before/after, Task 4 greps, acceptance criteria, and commit/PR body: `complete_order_with_payment_v10`, `pay_existing_order_v6`, `create_tablet_order_v2`, `evaluate_promotions_v1`, `pickup_tablet_order` (unversioned), `mark_item_served` (unversioned). Line numbers (`useCheckout.ts:93`/`:124`, `process-payment/index.ts:149`, `useCreateTabletOrder.ts:19`, `useEvaluatePromotions.ts:166`, `CLAUDE.md:61`) are consistent throughout and were confirmed by reading the files. No naming drift.

Self-review result: **OK** — no inline fixes required.

---

## Execution Handoff

Plan complete and saved to `docs/workplan/plans/2026-06-01-pos-claudemd-doc-sync-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session using superpowers:executing-plans, batch execution with checkpoints for review.

Which approach?
