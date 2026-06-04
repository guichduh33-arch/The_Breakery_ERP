> 🗄️ **ARCHIVED / SUPERSEDED (banner added 2026-06-04).** Superseded draft — the POS-audit work was re-numbered into the **2026-05-29 session-33/34/35** plans after the Reports track took the S31 slot (PR #39). Never executed under this number (no INDEX). Kept verbatim for history.

# Session 31 — POS Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Fermer les 4 Critical de l'audit POS (F-001 KDS handoff, F-002 enum drift, F-003 reporté S32, F-004 receipt+drawer multi-tender) + 2 Major sécurité (F-006 PIN-en-header, F-008 anon REVOKE sweep) + 2 Minor housekeeping (F-017 doc threshold, F-018 recover-shift toast).

**Architecture:** Pattern S26-S29 monotonique RPC versioning + REVOKE pair canonique. Aucune nouvelle permission, aucune nouvelle table. Migration block `20260628000010..020`. EF helper partagé `_shared/manager-pin.ts` (mirror `_shared/idempotency.ts` S25).

**Tech Stack:** PostgreSQL Supabase cloud `ikcyvlovptebroadgtvd`, Deno EFs, TypeScript monorepo, React 18, React-Query v5, Vitest, pgTAP.

**Spec:** [`../../specs/archive/2026-05-28-session-31-spec.md`](../../specs/archive/2026-05-28-session-31-spec.md)

**Branch:** `swarm/session-31` (à créer depuis `master` ou `swarm/session-30` selon merge status)

**Audit source:** [`../../../audit/2026-05-28-pos-audit.md`](../../../audit/2026-05-28-pos-audit.md)

---

## Wave 0 — Branch + spec commit + discovery

### Task 0.1 : Branch creation

- [ ] `git checkout master` (ou `swarm/session-30` si PR S30 pas mergée)
- [ ] `git pull`
- [ ] `git checkout -b swarm/session-31`

### Task 0.2 : Commit spec + plan

- [ ] `git add docs/workplan/specs/2026-05-28-session-31-spec.md docs/workplan/plans/2026-05-28-session-31-plan.md`
- [ ] `git commit -m "docs(s31): wave 0 — session 31 spec + plan (POS critical fixes)"`

### Task 0.3 : Discovery — anon GRANT audit sweep

- [ ] `grep -rn "GRANT EXECUTE.*TO.*anon\|TO authenticated.*anon" supabase/migrations/` → liste des fonctions anon-granted
- [ ] Pour chaque résultat, vérifier si le fichier source est S20 (`20260524000020..031`) ou antérieur
- [ ] Documenter dans `outputs/s31-anon-sweep.md` la liste des fonctions trouvées hors S20 (utilisé Wave 3 pour migration `_013..017`)
- [ ] **Critère** : si > 5 fonctions trouvées, déléguer le sweep en backlog dédié et garder S31 sur send_items_to_kitchen seul.

### Task 0.4 : Discovery — verify kiosk-issue-jwt PIN paths

- [ ] Read `supabase/functions/kiosk-issue-jwt/index.ts` end-to-end
- [ ] Note si une mutation path lit `body.manager_pin` ou `body.pin`. Si oui → inclus en Wave 4. Si non → skip cette EF de F-006 scope.

---

## Wave 1 — F-001 : KDS handoff (RPC bump)

### Task 1.1 : Migration `_010` — `complete_order_with_payment_v10`

**File:** `supabase/migrations/20260628000010_bump_complete_order_v10.sql`

- [ ] Migration body :
  1. `DROP FUNCTION complete_order_with_payment_v9` cascade (signature exacte, cf. S26 pattern)
  2. `CREATE OR REPLACE FUNCTION complete_order_with_payment_v10(...)` — **signature et corps identiques à v9** sauf le bloc INSERT order_items qui ajoute `is_locked, kitchen_status, sent_to_kitchen_at` colonnes + `true, 'pending', now()` values
  3. `GRANT EXECUTE ON FUNCTION complete_order_with_payment_v10(...) TO authenticated;`
  4. COMMENT ON FUNCTION explicite : "v10 (S31, fix F-001) — items inserted with is_locked=true so KDS sees them. v9 dropped same migration."
- [ ] Apply via `mcp__plugin_supabase_supabase__apply_migration` name=`bump_complete_order_v10`
- [ ] Verify : `SELECT proname FROM pg_proc WHERE proname IN ('complete_order_with_payment_v9','complete_order_with_payment_v10');` → only v10 row.

### Task 1.2 : Migration `_011` — REVOKE pair v10

**File:** `supabase/migrations/20260628000011_revoke_pair_complete_order_v10.sql`

- [ ] Migration body :
  ```sql
  REVOKE EXECUTE ON FUNCTION complete_order_with_payment_v10(...) FROM PUBLIC, anon;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  ```
- [ ] Apply name=`revoke_pair_complete_order_v10`

### Task 1.3 : Update POS hook

**File:** `apps/pos/src/features/payment/hooks/useCheckout.ts`

- [ ] Change `supabase.rpc('complete_order_with_payment_v9', ...)` → `supabase.rpc('complete_order_with_payment_v10', ...)` (mêmes args, juste le nom)
- [ ] Same for any other call site — `grep -rn "complete_order_with_payment_v9" apps/ packages/ supabase/functions/` first to make sure
- [ ] Types regen : `mcp__plugin_supabase_supabase__generate_typescript_types` + write `packages/supabase/src/types.generated.ts`

### Task 1.4 : pgTAP `pos_kds_handoff.test.sql`

**File:** `supabase/tests/pos_kds_handoff.test.sql`

- [ ] 12 cas T1-T12 par spec §3.4 :
  - T1-T6 : invariants insert v10 (is_locked, kitchen_status, sent_to_kitchen_at, KDS query visibility)
  - T7-T8 : `pay_existing_order_v6` regression OK (tablet pickup non régressé)
  - T9-T10 : `complete_order_with_payment_v9` introuvable (DROP confirmed)
  - T11-T12 : aucun audit_logs supplémentaire émis
- [ ] Run via `mcp__plugin_supabase_supabase__execute_sql` wrapped `BEGIN; ... ROLLBACK;`
- [ ] **Critère** : 12/12 PASS

### Task 1.5 : POS smoke test

**File:** `apps/pos/src/features/payment/__tests__/PaymentTerminal.kdsHandoff.smoke.test.tsx`

- [ ] Mock `supabase.rpc('complete_order_with_payment_v10', ...)` → returns mocked `{ order_id, order_number, total, tax_amount, change_given }`
- [ ] Assert `useCheckout` calls the right RPC name
- [ ] (No e2e KDS handoff — deferred to runtime verify)

### Task 1.6 : Commit Wave 1

- [ ] `git add supabase/migrations/20260628000010_* supabase/migrations/20260628000011_*`
- [ ] `git add apps/pos/src/features/payment/hooks/useCheckout.ts packages/supabase/src/types.generated.ts`
- [ ] `git add supabase/tests/pos_kds_handoff.test.sql`
- [ ] `git add apps/pos/src/features/payment/__tests__/PaymentTerminal.kdsHandoff.smoke.test.tsx`
- [ ] `git commit -m "feat(pos): session 31 — wave 1 — F-001 complete_order_v10 sets is_locked so KDS sees POS comptoir orders"`

---

## Wave 2 — F-002 : enum drift sweep

### Task 2.1 : Domain helper `orderTypeLabel`

**File:** `packages/domain/src/orders/order-type.ts` (new)

- [ ] Export `ORDER_TYPE_LABELS: Record<OrderType, string>` const map (dine_in/take_out/delivery/b2b)
- [ ] Export `orderTypeLabel(t: string): string` with safe fallback for unknown values
- [ ] Export from `packages/domain/src/index.ts`

### Task 2.2 : Domain unit test

**File:** `packages/domain/src/orders/__tests__/order-type.test.ts` (new)

- [ ] Type-level assert `Record<OrderType, string>` (compile fail if enum extended without label)
- [ ] 3 cas runtime : dine_in / take_out / delivery / b2b labels + unknown fallback
- [ ] Run `pnpm --filter @breakery/domain test order-type` → 3/3 PASS

### Task 2.3 : POS sites sweep

| File | Change |
|---|---|
| `apps/pos/src/features/display/components/OrderQueueTicker.tsx:33` | `'take_away'` → `'take_out'`; use `orderTypeLabel` for fallback |
| `apps/pos/src/features/display/components/CurrentOrderCard.tsx:55` | `'take_away'` → `'take_out'` |
| `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx:48` | fixture `'take_away'` → `'take_out'` |
| `apps/pos/src/features/order-history/OrderHistoryPanel.tsx:189` | ternary → `orderTypeLabel(row.order_type)` |
| `apps/pos/src/features/cart/HeldOrdersModal.tsx:276` | `'takeaway'` → `orderTypeLabel(filter).toLowerCase()` (cosmetic but consistent) |

- [ ] After all edits : `grep -rn "'take_away'\|'takeaway'\|\"take_away\"\|\"takeaway\"" apps/pos/src/` → 0 result.
- [ ] Adjust `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx` assertions if needed (re-run).

### Task 2.4 : Typecheck + tests

- [ ] `pnpm typecheck` → 6/6 PASS
- [ ] `pnpm --filter @breakery/pos test display` → PASS
- [ ] `pnpm --filter @breakery/pos test order-history` → PASS
- [ ] `pnpm --filter @breakery/pos test held-orders` → PASS

### Task 2.5 : Commit Wave 2

- [ ] `git add packages/domain/src/orders/order-type.ts packages/domain/src/orders/__tests__/order-type.test.ts packages/domain/src/index.ts`
- [ ] `git add apps/pos/src/features/display/components/OrderQueueTicker.tsx apps/pos/src/features/display/components/CurrentOrderCard.tsx apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx apps/pos/src/features/order-history/OrderHistoryPanel.tsx apps/pos/src/features/cart/HeldOrdersModal.tsx`
- [ ] `git commit -m "fix(pos): session 31 — wave 2 — F-002 enum drift sweep (take_away/takeaway → take_out + orderTypeLabel helper)"`

---

## Wave 3 — F-008 : REVOKE sweep anon

### Task 3.1 : Migration `_012` — corrective `send_items_to_kitchen`

**File:** `supabase/migrations/20260628000012_revoke_send_items_to_kitchen_anon.sql`

- [ ] Body :
  ```sql
  REVOKE EXECUTE ON FUNCTION send_items_to_kitchen(UUID[]) FROM anon, PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  ```
- [ ] Apply name=`revoke_send_items_to_kitchen_anon`

### Task 3.2 : Discovery-based migrations `_013..017` (conditional)

**If Wave 0.3 trouve fonctions hors-S20 :**

- [ ] Pour chaque, créer migration corrective `REVOKE EXECUTE ON FUNCTION <name>(<sig>) FROM anon, PUBLIC;`
- [ ] Apply via MCP
- [ ] Update `outputs/s31-anon-sweep.md` avec statut DONE per function

### Task 3.3 : pgTAP `anon_revoke_send_items_to_kitchen.test.sql`

**File:** `supabase/tests/anon_revoke_send_items_to_kitchen.test.sql`

- [ ] 2 cas :
  - T1 : `SET ROLE anon; SELECT send_items_to_kitchen(ARRAY['00000000-0000-0000-0000-000000000000']::UUID[]);` → ERROR 42501 permission denied
  - T2 : SET ROLE authenticated + valid item → success (regression check)
- [ ] Run via cloud MCP → 2/2 PASS

### Task 3.4 : Commit Wave 3

- [ ] `git add supabase/migrations/20260628000012_* supabase/migrations/20260628000013..017_* (if any)`
- [ ] `git add supabase/tests/anon_revoke_send_items_to_kitchen.test.sql outputs/s31-anon-sweep.md`
- [ ] `git commit -m "feat(db): session 31 — wave 3 — F-008 REVOKE anon sweep (send_items_to_kitchen + ${count} discovered)"`

---

## Wave 4 — F-006 : PIN-en-header sweep

### Task 4.1 : EF helper `_shared/manager-pin.ts`

**File:** `supabase/functions/_shared/manager-pin.ts` (new)

- [ ] Export `MissingManagerPinError`, `InvalidManagerPinError`, `getManagerPin(req, opts)`
- [ ] PIN regex `/^\d{4,8}$/` (compatible avec project pre-existing S19 DEV-S19-3.B-01)
- [ ] Mirror pattern de `_shared/idempotency.ts` S25

### Task 4.2 : `void-order` EF migration

**File:** `supabase/functions/void-order/index.ts`

- [ ] Replace `const { manager_pin } = body` (or Zod schema field) → `const pin = getManagerPin(req)`
- [ ] Drop `manager_pin` from Zod body schema (hard cutover)
- [ ] Pass `pin` to existing RPC call (`void_order_rpc_vN` ou similaire — vérifier le nom exact)
- [ ] Deploy via `mcp__plugin_supabase_supabase__deploy_edge_function` name=`void-order`

### Task 4.3 : `cancel-item` EF migration

**File:** `supabase/functions/cancel-item/index.ts`

- [ ] Idem Task 4.2
- [ ] Deploy

### Task 4.4 : `kiosk-issue-jwt` (conditional sur Wave 0.4)

- [ ] If mutation path uses PIN → migrate header read
- [ ] Else → skip and document deviation INDEX

### Task 4.5 : POS hooks adapted

**Files:**
- `apps/pos/src/features/order-history/hooks/useVoidOrder.ts`
- `apps/pos/src/features/cart/hooks/useCancelOrderItem.ts`

- [ ] In each `useMutation` body :
  - Add `'x-manager-pin': managerPin` to headers
  - Drop `manager_pin: managerPin` from `JSON.stringify({...})` body

### Task 4.6 : Vitest live EF tests

**Files:**
- `supabase/tests/functions/void-order-pin-header.test.ts` (new)
- `supabase/tests/functions/cancel-item-pin-header.test.ts` (new)

- [ ] Each file : 3 cas (valid PIN happy, missing header 401, invalid format 400)
- [ ] Tests gated by `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars (S25 pattern)

### Task 4.7 : POS smoke tests

**Files:**
- `apps/pos/src/features/order-history/__tests__/void-modal-pin-header.smoke.test.tsx` (new)
- `apps/pos/src/features/cart/__tests__/cancel-item-pin-header.smoke.test.tsx` (new)

- [ ] Each : mock fetch, verify `x-manager-pin` header sent + body without `manager_pin` field
- [ ] 2 cas chacun

### Task 4.8 : Commit Wave 4

- [ ] `git add supabase/functions/_shared/manager-pin.ts`
- [ ] `git add supabase/functions/void-order/index.ts supabase/functions/cancel-item/index.ts`
- [ ] `git add apps/pos/src/features/order-history/hooks/useVoidOrder.ts apps/pos/src/features/cart/hooks/useCancelOrderItem.ts`
- [ ] `git add supabase/tests/functions/void-order-pin-header.test.ts supabase/tests/functions/cancel-item-pin-header.test.ts`
- [ ] `git add apps/pos/src/features/order-history/__tests__/void-modal-pin-header.smoke.test.tsx apps/pos/src/features/cart/__tests__/cancel-item-pin-header.smoke.test.tsx`
- [ ] `git commit -m "feat(pos+ef): session 31 — wave 4 — F-006 PIN-en-header sweep (void-order, cancel-item EFs + POS hooks)"`

---

## Wave 5 — F-004 : Receipt + drawer multi-tender

### Task 5.1 : Domain `ReceiptTender` type

**File:** `packages/domain/src/payments/receipt-tender.ts` (new)

- [ ] Export `ReceiptTender` interface
- [ ] Export from `packages/domain/src/index.ts`

### Task 5.2 : Print service breaking change

**File:** `apps/pos/src/services/print/printService.ts`

- [ ] `ReceiptPayload.payment: ReceiptTender[]` (était `payment: { method: 'cash'; ... }`)
- [ ] `ReceiptPayload.order.order_type: string` (relax du literal `'dine_in' | 'take_out'`)
- [ ] Server URL : move to a configurable `getPrintServerUrl()` qui lit `localStorage` ou défaut `'http://localhost:3001'` (F-015 prep)

### Task 5.3 : SuccessModal multi-tender + drawer conditioned

**File:** `apps/pos/src/features/payment/SuccessModal.tsx`

- [ ] `const tenders = usePaymentStore((s) => s.tenders)` au lieu de hardcoder cash
- [ ] `buildReceiptPayload` itère `tenders` pour construire `payment: ReceiptTender[]`
- [ ] `useEffect` calcule `hasCash = tenders.some((t) => t.method === 'cash')` → drawer conditionné

### Task 5.4 : POS smoke tests

**Files:**
- `apps/pos/src/features/payment/__tests__/print.smoke.test.tsx` — étendre 3 cas T1-T3
- `apps/pos/src/features/payment/__tests__/SuccessModal.tenders.smoke.test.tsx` (new) — 2 cas shape

- [ ] T1 cash-only : drawer appelé 1×, payment[0].method='cash'
- [ ] T2 qris-only : drawer **non** appelé, payment[0].method='qris'
- [ ] T3 split cash+card : drawer appelé 1×, payment.length=2

### Task 5.5 : Print server external — deviation

- [ ] Document dans `outputs/s31-print-server-migration.md` la nouvelle wire shape `payment: ReceiptTender[]`
- [ ] **Critère** : ce fichier doit être livré à l'ops gestionnaire du print server avec une version cible (`v2 receipt format`)

### Task 5.6 : Commit Wave 5

- [ ] `git add packages/domain/src/payments/receipt-tender.ts packages/domain/src/index.ts`
- [ ] `git add apps/pos/src/services/print/printService.ts`
- [ ] `git add apps/pos/src/features/payment/SuccessModal.tsx`
- [ ] `git add apps/pos/src/features/payment/__tests__/print.smoke.test.tsx apps/pos/src/features/payment/__tests__/SuccessModal.tenders.smoke.test.tsx`
- [ ] `git add outputs/s31-print-server-migration.md`
- [ ] `git commit -m "fix(pos): session 31 — wave 5 — F-004 receipt accepts ReceiptTender[] + drawer conditioned on cash tender"`

---

## Wave 6 — Minor housekeeping (F-017, F-018)

### Task 6.1 : F-017 — Stock threshold doc alignment

**File:** `docs/reference/04-modules/02-pos-cart-orders.md`

- [ ] §34 ligne `Stock low (<10)` → `Stock low (<= 3)` (le code utilise `<= 3` qui est plus adapté boulangerie rotation rapide)
- [ ] Commenter dans `outputs/s31-deviations.md` la justification

### Task 6.2 : F-018 — Recover shift

**File:** `apps/pos/src/pages/Pos.tsx:196`

**Option A (retire le bouton)** :
- [ ] `<ShiftClosedState>` : drop le prop `onRecover` (et le bouton associé)

**Option B (livre la feature minimale)** :
- [ ] Implémenter `useRecoverShift()` :
  - Query `pos_sessions WHERE status='open' AND cashier_id IS NULL ORDER BY opened_at DESC LIMIT 1`
  - Re-attache le user au row via RPC `claim_open_shift_v1(p_session_id)`
- [ ] Cette option ouvre un sub-spec — si trop lourd, retomber sur Option A

**Decision** : default Option A (cleanup) — Option B promue backlog si métier le demande explicitement.

### Task 6.3 : Commit Wave 6

- [ ] `git add docs/reference/04-modules/02-pos-cart-orders.md apps/pos/src/pages/Pos.tsx`
- [ ] `git commit -m "chore(pos): session 31 — wave 6 — F-017 doc threshold + F-018 retire toast 'recover not implemented'"`

---

## Wave 7 — Closeout

### Task 7.1 : Full typecheck + test sweep

- [ ] `pnpm typecheck` → 6/6 PASS
- [ ] `pnpm --filter @breakery/domain test` → PASS
- [ ] `pnpm --filter @breakery/pos test` → PASS
- [ ] `pnpm --filter @breakery/supabase test` → PASS (live EF tests gated)

### Task 7.2 : INDEX

**File:** `docs/workplan/plans/2026-05-28-session-31-INDEX.md`

- [ ] Sections : Summary, Migrations applied, Files changed, Tests added, Deviations, Follow-ups (S32 + backlog).

### Task 7.3 : Update CLAUDE.md Active Workplan

- [ ] Append S31 closeout entry mirroring S30 format

### Task 7.4 : Commit closeout

- [ ] `git add docs/workplan/plans/2026-05-28-session-31-INDEX.md CLAUDE.md docs/workplan/backlog-by-module/02-pos-cart-orders.md`
- [ ] `git commit -m "docs(s31): wave 7 — INDEX + CLAUDE.md Active Workplan + backlog status notes (S31 closeout)"`

### Task 7.5 : PR

- [ ] `gh pr create --title "feat(pos): session 31 — POS critical fixes (F-001/F-002/F-004/F-006/F-008 + F-017/F-018)"` with body referencing the audit + the closing checklist of the spec §10

---

## Deviation tracking

`outputs/s31-deviations.md` (created Wave 0, updated as we go) — list any DEV-S31-N.M-NN entries (informational vs medium) per project convention.
