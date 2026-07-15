# Session 22 — INDEX (Focus-trap lock-in + dette technique ciblée)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 2 streams parallèles + closeout serial.

**Goal :** verrouiller l'acquis focus-trap (TASK-22-006 implicitement DONE en V3 monorepo) via tests + ESLint guard + roadmap cleanup ; ramasser DEV-S17-1.B-01 (WAC bypass guard) + DEV-S19-2.A-02 (Retry-After 429) — 2 streams parallèles en 1 session.

**Architecture :** Wave 0 (spec/INDEX/branch) serial → **Wave 1** parallel 2 streams via subagent fan-out → Wave 2 closeout serial. Stream A = UI/tests/lint (focus-trap lock-in), Stream B = DB+EF (WAC guard + Retry-After 429). Cloud-only via Supabase MCP — no Docker.

**Tech Stack :** Vitest + @testing-library/react, `@typescript-eslint/utils` RuleTester, Postgres column-level REVOKE/GRANT + SECURITY DEFINER RPC, Supabase Edge Functions Deno + Response headers.

**Date :** 2026-05-18
**Branch :** `swarm/session-22` (off `20d484c` master post-S21 squash-merge PR #25)
**Spec :** [`../specs/2026-05-18-session-22-spec.md`](../../specs/archive/2026-05-18-session-22-spec.md)
**Migration block réservé :** `20260526000010..099`

---

## 1. Goal global

Stream A (lock-in focus-trap) + Stream B (2 dettes techniques) :

| # | Item | Stream | Estim |
|---|------|--------|-------|
| 1 | RTL focus-trap regression tests (4 primitives) | A | M ~2h |
| 2 | ESLint custom rule `no-raw-modal-overlay` + RuleTester | A | M ~1.5h |
| 3 | Roadmap cleanup + Status notes (4 fichiers backlog) | A | S ~0.5h |
| 4 | WAC bypass guard : column-level REVOKE + RPC `update_cost_price_v1` + pgTAP | B | M ~2.5h |
| 5 | Retry-After 429 sur 5 EFs + helper + Vitest live | B | S ~1.5h |

**Total :** ~8h serial ; ~5h wall-time avec 2 streams parallèles (max stream).

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec ✓ + INDEX (this doc) + branch ✓
        │
        ▼
Wave 1 (2 streams parallèles via subagent fan-out)
  ├── Stream A : Phase 1.A — Focus-trap verification + lock-in
  │     · 4 RTL focus-trap tests (Dialog + Sheet + FullScreenModal + CenterModal)
  │     · ESLint rule `no-raw-modal-overlay` + tests
  │     · Roadmap cleanup + Status notes
  │
  └── Stream B : Phase 1.B — Dette technique ciblée
        · B.1 — WAC bypass guard (REVOKE column + RPC + pgTAP)
        · B.2 — Retry-After header sur 5 EFs + Vitest live
        │
        ▼ Sync gate (les 2 streams DONE → reviewers spec+quality)
Wave 2 — Phase 2.A : closeout
  · Types regen
  · Roadmap refresh + Status notes append
  · INDEX §10 deviations
  · Final quality gates
  · Commit + push + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

- [x] Spec dated 2026-05-18, 5 deliverables + 8 risks + 2 streams.
- [x] Branche `swarm/session-22` créée off `20d484c` master.
- [x] INDEX dated, 2 streams + closeout.
- [ ] Commit spec + INDEX.

**Complexity :** S (~30min).
**Suggested executor :** lead.

---

## 4. Wave 1 — Stream A : Focus-trap verification + lock-in (Phase 1.A)

**Module(s) :** 22-design-system, 23-tests.
**Executor :** 1 subagent `coder` sonnet, name `stream-a`.

### Sub-phase 1.A.1 — RTL focus-trap regression tests (4 primitives)

**Files :**
- `packages/ui/src/primitives/__tests__/Dialog.focus-trap.test.tsx` (CREATE)
- `packages/ui/src/primitives/__tests__/Sheet.focus-trap.test.tsx` (CREATE)
- `packages/ui/src/components/__tests__/FullScreenModal.focus-trap.test.tsx` (CREATE)
- `packages/ui/src/components/__tests__/CenterModal.focus-trap.test.tsx` (CREATE)

**Steps :**

- [ ] **Step 1 — Read existing tests** : `Dialog.test.tsx` + `FullScreenModal.test.tsx` (déjà green via `packages/ui/coverage/`) pour comprendre le pattern de mount.

- [ ] **Step 2 — Author `Dialog.focus-trap.test.tsx`** : 4 cas :
  - `Tab cycles forward stays within modal subtree` : monte un Dialog avec 3 boutons + close ; `userEvent.tab()` 4× ; assert `document.activeElement` est dans `screen.getByRole('dialog')` à chaque step (jamais sur trigger external).
  - `Shift+Tab cycles backward similarly` : idem reverse.
  - `Escape key closes` : `userEvent.keyboard('{Escape}')` ; assert `onOpenChange` called with `false`.
  - `Focus returns to trigger on close` : render avec trigger button focused, open, close, assert `document.activeElement === triggerButton`.

- [ ] **Step 3 — Author 3 wrappers tests** : copier le pattern, adapter aux APIs spécifiques (FullScreenModal/CenterModal/Sheet ont des props open/onOpenChange identiques).

- [ ] **Step 4 — Run** : `pnpm --filter @breakery/ui test focus-trap`. Expect 16 tests green (4×4 cas).

- [ ] **Step 5 — Commit** : `test(ui): session 22 — phase 1.A.1 — focus-trap regression tests on 4 modal primitives`.

### Sub-phase 1.A.2 — ESLint custom rule `no-raw-modal-overlay`

**Files :**
- `packages/eslint-config/src/rules/no-raw-modal-overlay.ts` (CREATE)
- `packages/eslint-config/src/rules/__tests__/no-raw-modal-overlay.test.ts` (CREATE)
- `packages/eslint-config/src/index.ts` (MODIFY — wire rule, level `error`)
- `packages/eslint-config/package.json` (MODIFY si besoin)

**Steps :**

- [ ] **Step 1 — Read `packages/eslint-config/`** structure existante. Verify si `@typescript-eslint/utils` devDep présent.

- [ ] **Step 2 — Author rule** :
  ```ts
  // Detect: className contains both 'fixed' and 'inset-0' literal strings.
  // OR: JSXAttribute style with { position: 'fixed', inset: 0 } shape.
  // Allow if: file path matches /packages\/ui\// OR /__tests__\//.
  ```
  Le rule visitor cible `JSXAttribute` nodes. Le messageId est `noRawModalOverlay` avec hint "Use Dialog/FullScreenModal/CenterModal/Sheet from @breakery/ui".

- [ ] **Step 3 — RuleTester ≥ 5 cases** :
  - valid : `apps/pos/src/foo.tsx` qui import Dialog from `@breakery/ui` (no `fixed inset-0` literal).
  - valid : `packages/ui/src/primitives/Dialog.tsx` qui CONTIENT `fixed inset-0` (allowed because in packages/ui).
  - valid : sticky header `className="sticky top-0 z-10"` (different pattern).
  - invalid : `apps/pos/src/features/foo/CustomModal.tsx` avec `<div className="fixed inset-0">`.
  - invalid : `apps/backoffice/src/foo.tsx` avec `<div style={{position:'fixed', inset:0}}>`.
  - invalid : `packages/domain/src/foo.tsx` avec raw overlay.

- [ ] **Step 4 — Wire rule** : import et add à `rules` map dans `packages/eslint-config/src/index.ts` avec level `error`. Verify shared config consumed par `apps/pos/.eslintrc.json` et `apps/backoffice/.eslintrc.json`.

- [ ] **Step 5 — Run tests** : `pnpm --filter @breakery/eslint-config test`. Expect 6+ cases green.

- [ ] **Step 6 — Lint scan integration** : `pnpm exec eslint apps/pos/src apps/backoffice/src packages/{domain,supabase,utils}/src --max-warnings 0`. Expect 0 erreur (proves no raw overlay slipped in pre-S22).

- [ ] **Step 7 — Commit** : `feat(eslint-config): session 22 — phase 1.A.2 — no-raw-modal-overlay rule + tests`.

### Sub-phase 1.A.3 — Roadmap cleanup + Status notes

**Files :**
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (MODIFY)
- `docs/workplan/backlog-by-module/22-design-system.md` (MODIFY)
- `docs/workplan/backlog-by-module/02-pos-cart-orders.md` (MODIFY si A1-3 entry)
- `docs/workplan/backlog-by-module/23-tests.md` (MODIFY)

**Steps :**

- [ ] **Step 1 — Roadmap §Actifs** : strike item #5 (`Fix modal focus traps...`) avec mention `~~item~~ → **DONE S22 (lock-in via RTL+ESLint)**`. Add S22 row dans §Sessions complétées. Add §Indicateurs row `Modal focus-trap audit | locked-in | DONE S22`.

- [ ] **Step 2 — 22-design-system.md TASK-22-006** : append `**Status note (2026-05-18)**` confirming DONE-status verified via S22 empirical audit (30+ modals all on Radix primitive) + lock-in via 4 RTL focus-trap tests + ESLint rule `no-raw-modal-overlay`.

- [ ] **Step 3 — 02-pos-cart-orders.md** : grep `A1-3` ou `focus.trap` ; si entry présente, Status note cross-ref S22.

- [ ] **Step 4 — 23-tests.md** : append Status note documentant le nouveau test pattern `*.focus-trap.test.tsx` co-localisé dans `packages/ui/src/{primitives,components}/__tests__/`.

- [ ] **Step 5 — Commit** : `docs(workplan): session 22 — phase 1.A.3 — focus-trap lock-in roadmap cleanup + status notes`.

**DoD Stream A :**
- 4 RTL focus-trap tests green (16 sous-cas).
- ESLint rule + RuleTester green (≥ 6 cas).
- Lint scan apps/* + packages/{domain,supabase,utils}/src 0 nouveau error.
- 4 fichiers backlog updated (Status notes append-only).
- 3 commits sur `swarm/session-22`.

**Complexity :** M (~4h). **Dependencies :** Phase 0.1.

---

## 5. Wave 1 — Stream B : Dette technique ciblée (Phase 1.B)

**Module(s) :** 06-inventory-stock, 07-purchasing, 01-auth-permissions, 25-security.
**Migration sub-block :** `20260526000010..019`.
**Executor :** 1 subagent `backend-dev` sonnet, name `stream-b`.

### Sub-phase 1.B.1 — WAC bypass guard (DEV-S17-1.B-01)

**Files :**
- `supabase/migrations/20260526000010_revoke_direct_update_products_cost_price.sql` (CREATE)
- `supabase/migrations/20260526000011_create_update_cost_price_v1_rpc.sql` (CREATE)
- `supabase/tests/products_cost_price_guard.test.sql` (CREATE)
- `packages/supabase/src/types.generated.ts` (MODIFY post-Wave 2)

**Steps :**

- [ ] **Step 1 — Empirical check critical** : via MCP `execute_sql` (project_id `ikcyvlovptebroadgtvd`) :
  ```sql
  SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner
    FROM pg_proc
   WHERE proname IN ('receive_stock_v1','record_stock_movement_v1','update_cost_price_v1')
     AND pronamespace = 'public'::regnamespace;

  SELECT grantee, privilege_type
    FROM information_schema.column_privileges
   WHERE table_schema='public' AND table_name='products' AND column_name='cost_price';

  SELECT COUNT(*) AS direct_update_callsites
    FROM (SELECT 1 FROM pg_proc WHERE prosrc ILIKE '%UPDATE%products%SET%cost_price%') s;
  ```
  Decide path :
  - Si `receive_stock_v1.proowner = 'postgres'` AND `prosecdef = true` → safe to REVOKE.
  - Si NOT → refactor needed avant REVOKE ; document deviation et défère B.1.
  - Grep `apps/`, `packages/`, `supabase/scripts/` pour `cost_price.*=` patterns ou `update.*cost_price`.

- [ ] **Step 2 — Apply migration `_010_revoke_direct_update`** :
  ```sql
  REVOKE UPDATE (cost_price) ON public.products FROM authenticated, anon, PUBLIC;
  -- service_role intentionally retained for emergency ops, but RPC is preferred path.
  -- ALTER DEFAULT PRIVILEGES not applicable for column-level (PG limitation) — column REVOKE is per-column explicit.

  COMMENT ON COLUMN public.products.cost_price IS
    'S22 (DEV-S17-1.B-01): direct UPDATE revoked from authenticated/anon/PUBLIC. '
    'Use update_cost_price_v1 RPC (emits stock_movements audit row) or receive_stock_v1 WAC RPC. '
    'Both run SECURITY DEFINER as postgres owner.';
  ```

- [ ] **Step 3 — Apply migration `_011_create_update_cost_price_v1_rpc`** :
  - Check permission `inventory.cost_correction` existence via permission catalog. If absent, create it ; else use `inventory.write` ou équivalent (decision documentée en INDEX §10 deviation).
  - RPC signature : `update_cost_price_v1(p_product_id UUID, p_new_cost NUMERIC, p_reason TEXT, p_idempotency_key UUID DEFAULT NULL) RETURNS jsonb`.
  - Body :
    - check permission via session `roles_permissions` join (pattern conforme aux RPCs auth-gated S19/S20).
    - lock product row via `SELECT cost_price FROM products WHERE id=p_product_id FOR UPDATE`.
    - emit `record_stock_movement_v1` row : `movement_type='cost_price_correction'`, quantity=0, unit=p.unit, notes jsonb `{old_cost, new_cost, reason, idempotency_key}`.
    - UPDATE products SET cost_price = p_new_cost WHERE id = p_product_id.
    - RETURN jsonb_build_object('success', true, 'movement_id', mv_id).
  - `REVOKE EXECUTE FROM PUBLIC ; GRANT EXECUTE TO authenticated`.

- [ ] **Step 4 — Add `cost_price_correction` to stock_movements movement_type CHECK constraint** : si pas déjà accepté. Migration intégrée à `_011`.

- [ ] **Step 5 — Author `products_cost_price_guard.test.sql`** : pgTAP 4 asserts :
  ```sql
  -- 1) Direct UPDATE rejected (must rollback)
  BEGIN ; SAVEPOINT s ;
  SET LOCAL role authenticated ;
  SET LOCAL request.jwt.claims TO '{"sub":"<test-user-uuid>","role":"authenticated"}' ;
  SELECT throws_ok($$ UPDATE public.products SET cost_price = 999 WHERE id = '<test-uuid>' $$,
                   '42501', 'permission denied for column cost_price') ;
  ROLLBACK TO s ;

  -- 2) RPC update_cost_price_v1 passes for authorized role
  SELECT lives_ok($$ SELECT update_cost_price_v1(...) $$, 'RPC succeeds') ;

  -- 3) receive_stock_v1 continues to work (WAC path)
  SELECT lives_ok($$ SELECT receive_stock_v1(...) $$, 'WAC path intact') ;

  -- 4) Audit row emitted
  SELECT is((SELECT COUNT(*) FROM stock_movements WHERE movement_type='cost_price_correction'
              AND product_id='<test-uuid>')::int, 1, 'audit row emitted') ;
  ```

- [ ] **Step 6 — Run pgTAP via MCP `execute_sql`** wrapped in BEGIN/ROLLBACK envelope. Expect 4 passes.

- [ ] **Step 7 — Commit** : `feat(security): session 22 — phase 1.B.1 — wac bypass guard (revoke column update + rpc + audit)`.

### Sub-phase 1.B.2 — Retry-After header sur 5 EFs (DEV-S19-2.A-02)

**Files :**
- `supabase/functions/_shared/responses.ts` (CREATE ou MODIFY)
- `supabase/functions/auth-verify-pin/index.ts` (MODIFY)
- `supabase/functions/kiosk-issue-jwt/index.ts` (MODIFY — 2 sites)
- `supabase/functions/refund-order/index.ts` (MODIFY)
- `supabase/functions/void-order/index.ts` (MODIFY)
- `supabase/functions/cancel-item/index.ts` (MODIFY)
- `supabase/tests/functions/rate-limit-retry-after.test.ts` (CREATE)

**Steps :**

- [ ] **Step 1 — Inspect `_shared/responses.ts`** : Read first si existe (Glob first).

- [ ] **Step 2 — Author/extend helper** :
  ```ts
  export function rateLimitedResponse(retryAfterSec: number, msg = 'Too many requests') {
    return new Response(
      JSON.stringify({ error: msg, retry_after_sec: retryAfterSec }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))),
          'Access-Control-Expose-Headers':
            (corsHeaders['Access-Control-Expose-Headers'] ?? '') + ', Retry-After',
        },
      }
    );
  }
  ```

- [ ] **Step 3 — Wire dans 5 EFs** : replace inline `new Response(..., {status: 429})` par `return rateLimitedResponse(rateLimit.retryAfterSec)`. Aussi compatible avec memory-only fallback (retryAfterSec déjà calculé).

- [ ] **Step 4 — Author `rate-limit-retry-after.test.ts`** : Vitest live :
  ```ts
  // Burst 30 requests at auth-verify-pin to trigger 429
  // Assert: response.status === 429
  // Assert: response.headers.get('Retry-After') matches /^\d+$/ and is 1..60
  ```

- [ ] **Step 5 — Run Vitest** : `pnpm --filter @breakery/supabase test rate-limit-retry-after`. Expect green.

- [ ] **Step 6 — Deploy 5 EFs via MCP `deploy_edge_function`** (1 par EF) ou manuel `supabase functions deploy <name>`.

- [ ] **Step 7 — Manual smoke** : 1 EF curl 30× sur même IP, vérifier que 429 retourne header `Retry-After: <N>`.

- [ ] **Step 8 — Commit** : `feat(security): session 22 — phase 1.B.2 — retry-after header on 5 rate-limited efs`.

**DoD Stream B :**
- 2 migrations appliquées sur V3 dev (`20260526000010..011`).
- RPC `update_cost_price_v1` créé + REVOKE column + pgTAP 4/4.
- 5 EFs déployées avec Retry-After header.
- Vitest `rate-limit-retry-after` green.
- 2 commits sur `swarm/session-22`.

**Complexity :** M (~4h). **Dependencies :** Phase 0.1.

---

## 6. Wave 2 — Closeout (Phase 2.A)

**Files :**
- `packages/supabase/src/types.generated.ts` (MODIFY — regen)
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (MODIFY — Stream A déjà fait ; ajouter row Stream B Indicateur)
- `docs/workplan/backlog-by-module/{06-inventory-stock,07-purchasing-suppliers,01-auth-permissions,25-security}.md` (MODIFY — Status notes append)
- `docs/workplan/plans/2026-05-18-session-22-INDEX.md` (MODIFY — fill §10)

**Steps :**

- [ ] **Step 1 — Quality gates** : `pnpm typecheck && pnpm build && pnpm exec turbo run test --concurrency=1`.

- [ ] **Step 2 — Types regen** via MCP `generate_typescript_types` ; écrire dans `packages/supabase/src/types.generated.ts` ; `git diff` — committer si non-vide (devrait inclure `update_cost_price_v1` signature).

- [ ] **Step 3 — Roadmap refresh** :
  - Stream A : strike item #5 (Modal focus-trap) si pas déjà fait dans Phase 1.A.3.
  - §Sessions complétées : add S22 row.
  - §Indicateurs : add ligne `WAC bypass guard sur products.cost_price | enabled | DONE S22` + `429 Retry-After header sur EFs durables | enabled | DONE S22` + `Modal focus-trap audit | locked-in | DONE S22` (si pas déjà fait).

- [ ] **Step 4 — Status notes** sur 4 fichiers backlog Stream B.

- [ ] **Step 5 — Fill INDEX §10 deviations**.

- [ ] **Step 6 — Final quality gates rerun**.

- [ ] **Step 7 — Wave 2 commit**.

- [ ] **Step 8 — Push + PR** :
```bash
git push -u origin swarm/session-22
gh pr create --title "session 22 — focus-trap lock-in + wac bypass guard + retry-after 429" --body "$(cat <<'EOF'
## Summary

2-stream parallel session :

**Stream A — Focus-trap lock-in (verification + regression):**
- Empirical audit confirms 30+ modals in apps/ all route through Radix primitive (Dialog/FullScreenModal/CenterModal/Sheet from @breakery/ui). TASK-22-006 was already DONE via V3 monorepo consolidation.
- 4 new RTL focus-trap regression tests (Tab/Shift+Tab cycles, Esc closes, focus restore on close) on each primitive.
- New ESLint rule `no-raw-modal-overlay` (forbids `fixed inset-0` JSX outside packages/ui) + RuleTester ≥ 6 cases.
- Roadmap cleanup + Status notes append-only.

**Stream B — Dette technique ciblée:**
- WAC bypass guard (DEV-S17-1.B-01) : column-level REVOKE UPDATE on `products.cost_price` + new SECURITY DEFINER RPC `update_cost_price_v1` that emits `stock_movements` audit row (movement_type=`cost_price_correction`). `receive_stock_v1` WAC path intact (SECURITY DEFINER bypass).
- Retry-After 429 (DEV-S19-2.A-02) : new `rateLimitedResponse` helper in `_shared/responses.ts`, wired on 5 EFs (auth-verify-pin, kiosk-issue-jwt ×2 buckets, refund-order, void-order, cancel-item). Value dynamically sourced from `record_rate_limit_v1` RPC return (window_end - now()).

**Footprint :** 2 migrations (`20260526000010..011`), 4 RTL tests, 1 ESLint rule + tests, 5 EF wirings, 1 Vitest live, 4+ backlog Status notes.

## Test plan
- [ ] `pnpm --filter @breakery/ui test focus-trap` green (16 tests).
- [ ] `pnpm --filter @breakery/eslint-config test` green (≥ 6 cas).
- [ ] `pnpm exec eslint apps/pos/src apps/backoffice/src` 0 nouvelle erreur.
- [ ] pgTAP `products_cost_price_guard.test.sql` 4/4 via cloud MCP.
- [ ] Vitest `rate-limit-retry-after.test.ts` green.
- [ ] `pnpm typecheck`, `pnpm build`, `pnpm test` green modulo pre-existing flakes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Complexity :** M (~1.5h). **Dependencies :** Streams A, B tous DONE + reviewers APPROVED.

---

## 7. Parallelization map

| Wave | Phases | Parallel streams | Estim h |
|------|--------|------------------|---------|
| 0 | 0.1 | sequential | 0.5 |
| 1 | 1.A, 1.B | 2 parallel (subagent fan-out) | max(4, 4) = 4 |
| 2 | 2.A | sequential | 1.5 |
| **TOTAL** | **4** | — | **~6h wall-time parallel ; ~9.5h serial** |

---

## 8. Comms entre subagents

```
lead (Claude)
  ├──► stream-a (coder sonnet, run_in_background)
  │     · 4 RTL focus-trap tests
  │     · ESLint rule + tests
  │     · Roadmap cleanup + Status notes
  │
  └──► stream-b (backend-dev sonnet, run_in_background)
        · WAC guard (REVOKE column + RPC + pgTAP)
        · Retry-After 429 on 5 EFs + Vitest

After both stream subagents complete + commit, lead :
  ├──► spec-reviewer-A (reviewer sonnet) ◄── checks Stream A commits
  ├──► spec-reviewer-B (reviewer sonnet) ◄── checks Stream B commits
  └──► (if both APPROVED) → quality reviewers in parallel → fix loop → Wave 2 closeout
```

Each stream subagent runs autonomously, commits as it goes, returns a final report. Lead waits for both reports before dispatching reviewers in parallel.

---

## 9. Quality gates per Wave

| Wave | Gate |
|------|------|
| 0 | Spec committed + INDEX committed + branch pushed |
| 1.A done | `pnpm --filter @breakery/ui test focus-trap` green + `pnpm --filter @breakery/eslint-config test` green + lint scan apps/* 0 new error + 3 commits |
| 1.B done | pgTAP `products_cost_price_guard.test.sql` 4/4 + Vitest `rate-limit-retry-after.test.ts` green + `receive_stock_v1` smoke (one PO receipt updates cost_price via RPC) + 2 commits |
| 2 | `pnpm typecheck && pnpm build && pnpm exec turbo run test --concurrency=1` green ; types regen committed ; PR posted |

---

## 10. Deviation packs (Session 22 → Session 23+)

*Finalized post-execution Phase 2.A. Format `DEV-S22-1.A-NN` / `DEV-S22-1.B-NN`. All informational unless marked otherwise.*

### Stream A — Focus-trap lock-in

| ID | Phase | Severity | Description |
|----|-------|----------|-------------|
| DEV-S22-1.A.1-01 | 1.A.1 | informational | The spec's 4th test case (`Focus returns to trigger on close`) is not satisfiable for `FullScreenModal` / `CenterModal` because these primitives don't expose `DialogTrigger` ; Radix's `onCloseAutoFocus` `preventDefault`s the `FocusScope` fallback and drops focus to `<body>`. Dialog + Sheet keep the original "focus returns to trigger" assertion ; `FullScreenModal` + `CenterModal` use the adapted three-prong "focus is not stranded in unmounted modal subtree" invariant (modal unmounted + trigger still in doc + `body.contains(activeElement)`). Either accept the scope-reduced assertion (consuming apps already handle explicit focus restoration via `useEffect`), OR future work could augment the two primitives with a `triggerRef?: RefObject<HTMLElement>` prop wired into `onCloseAutoFocus`. |
| DEV-S22-1.A.1-02 | 1.A.1 | informational | Inconsistent `onOpenChange` default between primitive types : Dialog/Sheet harnesses use `(): void => {}` (Radix strict typing under `exactOptionalPropertyTypes`) ; FullScreenModal/CenterModal use `vi.fn()`. Intentional given each modal's API shape ; future refactor could normalize. |
| DEV-S22-1.A.1-03 | 1.A.1 | informational | Test isolation relies entirely on `cleanup()` in `vitest.setup.ts` — no explicit `beforeEach`/`afterEach`. Radix renders to a portal ; `cleanup()` removes the portal subtree but doesn't reset `document.body.focus` between tests. Not a flake today ; latent risk if a future test asserts initial activeElement. |
| DEV-S22-1.A.1-04 | 1.A.1 | informational | Test output emits Radix `Warning: Missing 'Description' or 'aria-describedby={undefined}' for {DialogContent}` in jsdom. Suppressed in Dialog harness via explicit `aria-describedby={undefined}`. Sheet harness can't apply the workaround cleanly because `SheetContent` types use `cva` variants that block prop spread. Cosmetic only. |
| DEV-S22-1.A.2-01 | 1.A.2 | informational | Spec called for `packages/eslint-config/src/rules/no-raw-modal-overlay.ts` + Vitest + `@typescript-eslint/rule-tester` — that package does NOT EXIST in the V3 monorepo. Lead empirically confirmed and re-routed to inline `tools/eslint-rules/no-raw-modal-overlay.mjs` + `__tests__/no-raw-modal-overlay.test.mjs` + minimal `tools/eslint-rules/package.json` (`type:module` stub). Rule wired in root `eslint.config.mjs` as plugin `breakery-local` at level `error`. RuleTester via ESLint's own `RuleTester` under `node:test` (no Vitest dep added to `tools/`). |
| DEV-S22-1.A.2-02 | 1.A.2 | informational | RuleTester uses `espree` parser (with `ecmaFeatures.jsx`) instead of `@typescript-eslint/parser`. Acceptable because JSXAttribute walking is parser-agnostic for the 2 AST shapes (`Literal` className strings + `ObjectExpression` style objects). CI invocation via `eslint.config.mjs` uses the project's TS parser as usual ; only the unit tests use espree. |
| DEV-S22-1.A.2-03 | 1.A.2 | informational | Rule tolerates `inset: '0px'` (in addition to `0` and `'0'`) as future-proofing leniency. Spec only mentioned `0` and `'0'`. No test case for `'0px'` ; current code only flags it because of an extra branch in `isInsetZero`. Future polish : add a 10th RuleTester case for `'0px'` to close the coverage gap. |
| DEV-S22-1.A.2-04 | 1.A.2 | informational | Stale docstring case-count in `tools/eslint-rules/__tests__/no-raw-modal-overlay.test.mjs:11-19` — header comment lists 7 cases (3 valid + 4 invalid) but file has 9 (4 valid + 5 invalid). Implementer flagged ; quick docstring sweep in S23+. |
| DEV-S22-1.A.2-05 | 1.A.2 | informational | Dynamic className construction patterns (template literals with embedded expressions, `cn('fixed', 'inset-0')` calls) are NOT detected by the rule (it only inspects static `Literal` className strings). No current codebase violations exist (`rg "cn\(.*['\"]fixed.*inset-0"` returns zero hits), so latent gap, not real miss. Worth a comment in the rule docstring acknowledging the limitation. |
| DEV-S22-1.A.2-06 | 1.A.2 | informational | `tools/eslint-rules/__tests__/no-raw-modal-overlay.test.mjs` lives outside the pnpm workspace graph (per `tools/eslint-rules/package.json` description), so `pnpm test` (turbo) does NOT pick it up. Test runs only when invoked manually via `node --test tools/eslint-rules/__tests__/`. Need to wire CI to invoke this path explicitly in S23+. |
| DEV-S22-1.A.2-07 | 1.A.2 | informational | `MarginWatchPage.tsx` migration to `<Dialog>` may have lost the visual `border border-border-subtle bg-bg-card p-4 shadow-lg` chrome — `DialogContent` provides Radix's default chrome which differs. Smoke tests still pass (5/5) ; no functional/a11y impact. Visual QA recommended before next release. |
| DEV-S22-1.A.3-01 | 1.A.3 | informational | Three doc locations referenced "ESLint rule deferred" because commit `1b97c0a` (docs) landed before `8290d9e` (rule). Wave 2 closeout corrected `00-roadmap-globale.md:43` + `:143` + `22-design-system.md:92`. |

### Stream B — Dette technique ciblée

| ID | Phase | Severity | Description |
|----|-------|----------|-------------|
| DEV-S22-1.B-01 | 1.B.1 | informational | Migration block split forced. Spec reserved `..010..011` for B.1 (1 REVOKE + 1 RPC). PG 55P04 (unsafe use of newly-added enum value in same tx) forced the RPC migration to split into `_011 enum extension` + `_012 RPC + constraint + perms`. Block actually used : `..010..012` (+ corrective `_013` for DEV-S22-1.B-02 + replay envelope fix `_014` for quality polish = 5 migrations total). |
| DEV-S22-1.B-02 | 1.B.1 | **medium** | `_010` column-level `REVOKE UPDATE (cost_price)` was silently a no-op for `authenticated` because the role held table-level `UPDATE ON products`. pgTAP T1 caught it on first run. Corrective `_013` REVOKEs table-level UPDATE on `authenticated`, then re-GRANTs per-column for every column EXCEPT `cost_price` (the intended guard target) PLUS `id` and `created_at` (the latter two were also never meant to be UPDATE-able from app code — implicit fail-safe tightening). Future column ADDs MUST be added to the re-grant list ; failure mode is fail-safe (new column not writable by `authenticated`). |
| DEV-S22-1.B-03 | 1.B.1 | informational | `update_cost_price_v1` bypasses `record_stock_movement_v1` primitive and does a direct INSERT into `stock_movements`. Rationale : the primitive rejects `quantity=0` (`quantity_must_be_nonzero`), but a price-only event must record qty=0. Same pattern other RPC families use when semantics don't fit the primitive's invariants (e.g. opname). RPC runs SECURITY DEFINER postgres so the write is privileged identically. |
| DEV-S22-1.B-04 | 1.B.1 | informational | `update_cost_price_v1` does NOT emit an `audit_logs` row separately from the `stock_movements` ledger row. The stock_movements row IS the audit (movement_type=`cost_price_correction`, qty=0, metadata jsonb with old_cost/new_cost/reason). Future BO admin UIs surfacing this should query `stock_movements` not `audit_logs`. |
| DEV-S22-1.B-05 | 1.B.2 | informational | `rate-limit-retry-after.test.ts` uses distinct `x-forwarded-for` IPs (`203.0.113.211..215`, RFC 5737 TEST-NET-3 range) per test to avoid cross-test bucket bleed in the durable RL store. Re-running back-to-back may 429 on FIRST burst attempt if the bucket from the previous run hasn't expired (60s window). Test author should be aware ; not flaky in CI when invoked once. |
| DEV-S22-1.B-06 | 1.B.2 | informational | `pnpm --filter @breakery/supabase test rate-limit-retry-after` does NOT work — `supabase/tests` is not in `pnpm-workspace.yaml`. Correct invocation : `cd supabase/tests && npx vitest run rate-limit-retry-after` with `SUPABASE_URL` + `SUPABASE_ANON_KEY` exported manually. Worth either adding `supabase/tests` to the workspace or documenting the run procedure in CLAUDE.md. |
| DEV-S22-1.B-07 | 1.B.2 | informational | `_shared/responses.ts` rateLimitedResponse helper is used by 5 EFs after S22, but ~25 other EFs on the project still hand-roll their 429 responses (inline `new Response(..., {status:429})`). Future hardening : sweep all rate-limited EFs and replace inline 429-jsonResponse with `rateLimitedResponse` to remove ad-hoc precedents. |
| DEV-S22-1.B-08 | 1.B.1 (fix-b) | informational | `update_cost_price_v1` idempotent-replay does NOT validate `p_product_id` matches the stored movement's `product_id` — consistent with `record_stock_movement_v1`'s project-wide convention. If a caller re-uses an `idempotency_key` across different products, they get a misleading envelope (replay returns the original movement's metadata, not data for the caller's `p_product_id`). Inline NOTE comment added in migration `_014` body for traceability. Project-wide convention change is out of S22 scope. |

---

## 11. Out of scope (déféré Session 23+)

- WAC opt-out sample/promo (DEV-S17-1.C-01).
- WAC garbage-in stale current_stock (DEV-S17-1.C-02).
- WAC landed cost shipping/douane pro-rata (TASK-07-012 partial).
- Rotate `birthday-cron-daily` secret to vault.secrets (DEV-S21-1.A.1-04).
- `mv_pl_monthly` conditional reuse (D-W6-6A-1) — accepted compromise, ne pas réouvrir.
- Mobile shell Capacitor (TASK-18-***).
- Compliance fiscale I1/I2/I3 (bloqué statut PKP).
- Tous autres DEV-S17/S18/S19/S20/S21 informationals non listés en §1.
