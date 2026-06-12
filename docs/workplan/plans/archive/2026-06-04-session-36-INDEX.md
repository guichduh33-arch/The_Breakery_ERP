# Session 36 — POS Correctness & Security Close-out — INDEX

> **Branch** : `swarm/session-36` (base `feat/pos-redesign` @ `7dbb10a` — see DEV-S36-PLAN-01, NOT `master`)
> **Spec** : [`../specs/2026-06-04-session-36-spec.md`](../../specs/archive/2026-06-04-session-36-spec.md)
> **Plan** : [`./2026-06-04-session-36-plan.md`](./2026-06-04-session-36-plan.md)
> **Status** : ✅ **executed** — all 3 waves shipped, reviewed (spec ✅ / quality ✅ / pattern-guardian 14/14), green.

---

## 1. Summary

- **Wave A — F-008** : explicit canonical S25 REVOKE pair on `send_items_to_kitchen(UUID[])`. Task 0 found anon was **already** revoked by the S20 global sweep (DEV-S36-A-02), so this is defense-in-depth + a regression guard (pgTAP 2/2), not a live-vuln fix.
- **Wave A — kiosk-issue-jwt** : verified no body PIN (`kiosk_id`/`scope`/`device_label` + env JWT secret only) → already PIN-in-header compliant, no change (DEV-S36-A-01). S25 sweep line closed.
- **Wave B — F-002** : `orderTypeLabel` domain helper (4-key DB-enum union) + 3 sites rewired off the ghost `take_away`/`takeaway` to the real `take_out`; OrderHistoryPanel consumes the helper, the two customer-display sites keep bespoke "Pickup"/table copy (DEV-S36-B-03). **F-021** : `as never` cast dropped in `useDisplayRealtime` (no regen, DEV-S36-B-02).
- **Wave C** : POS idle → `lock()` (session-preserving, ratified reversal — DEV-S36-C-01) ; customer object re-fetched on held restore (DEV-S35-C-05) ; VKP overlay portaled into the active Radix Dialog (DEV-S35-E3-01).
- **No new feature; correctness/security close-out only.** Review follow-ups folded in (shared `CUSTOMER_SELECT`, label-scope doc).

---

## 2. Schema facts (recorded in Task 0)

| Fact | Value |
|---|---|
| Migration block base (max NAME applied + 1) | `20260620000017` (prior max NAME `20260620000016`; cloud `version` is clock-assigned) |
| `send_items_to_kitchen` arg signature | `send_items_to_kitchen(p_item_ids uuid[])` |
| anon EXECUTE before/after fix | **already `false` before** (S20 sweep) → `false` after ; `authenticated` `true` (DEV-S36-A-02) |
| F-021 type regen required? | **No** — `useTableOccupancy.ts:49` proves the clean no-cast `.on('postgres_changes', …)` compiles (DEV-S36-B-02) |
| `OrderType` export path in `@breakery/domain` | `packages/domain/src/types/cart.ts` (**3-member**, no b2b — DEV-S36-B-01) ; helper exported from `packages/domain/src/index.ts` (no `orders/index.ts` barrel) |

---

## 3. Migrations applied

| File timestamp | Object |
|---|---|
| `20260620000017_revoke_send_items_to_kitchen_anon` | REVOKE pair `send_items_to_kitchen(UUID[])` FROM PUBLIC + anon, re-GRANT authenticated, ALTER DEFAULT PRIVILEGES FROM PUBLIC |

> Applied via MCP `apply_migration` (cloud V3 dev `ikcyvlovptebroadgtvd`). No types regen (REVOKE/GRANT only — no schema change).
> No new permissions seeded (F-008 removes an over-broad GRANT; `authenticated` retains EXECUTE).

---

## 4. New files

- **DB + tests** : `supabase/migrations/20260620000017_revoke_send_items_to_kitchen_anon.sql`, `supabase/tests/send_items_anon_revoke.test.sql`.
- **Domain** : `packages/domain/src/orders/orderTypeLabel.ts` (+ `__tests__/orderTypeLabel.test.ts`).
- **POS** : `apps/pos/src/components/IdleTimeoutMount.tsx` (extracted from App.tsx for isolated testing).
- **POS tests** : `apps/pos/src/features/display/__tests__/order-type-label.smoke.test.tsx`, `apps/pos/src/components/__tests__/idle-lock.smoke.test.tsx`, `apps/pos/src/features/heldOrders/__tests__/restore-customer-refetch.smoke.test.tsx`.
- **UI tests** : `packages/ui/src/components/__tests__/vkp-dialog-a11y.test.tsx`.

---

## 5. Files modified

- `packages/domain/src/index.ts` — export `orderTypeLabel` / `ORDER_TYPE_LABELS` / `OrderTypeLabelKey`.
- `apps/pos/src/features/display/components/OrderQueueTicker.tsx` — `take_away` → `take_out` (kept "Pickup").
- `apps/pos/src/features/display/components/CurrentOrderCard.tsx` — `take_away` → `take_out`.
- `apps/pos/src/features/order-history/OrderHistoryPanel.tsx` — `'takeaway'` ternary → `orderTypeLabel(row.order_type)`.
- `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx` — fixture `take_away` → `take_out`.
- `apps/pos/src/features/display/hooks/useDisplayRealtime.ts` — drop `'postgres_changes' as never` (+ filter cast).
- `apps/pos/src/App.tsx` — inline `IdleTimeoutMount` replaced by the extracted component import; `useIdleTimeout` import removed.
- `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts` — best-effort customer re-fetch + `attachCustomer` on restore.
- `apps/pos/src/features/customers/hooks/useCustomerSearch.ts` — export shared `CUSTOMER_SELECT` (review follow-up).
- `packages/ui/src/components/VirtualKeypadProvider.tsx` — portal overlay into active Radix Dialog (+ `data-testid="vkp-overlay"`).

---

## 6. Tests run

| Suite | Count | Status |
|---|---|---|
| pgTAP `send_items_anon_revoke` (cloud MCP) | 2 | PASS |
| domain `orderTypeLabel` | 3 | PASS |
| POS `order-type-label` smoke | 1 | PASS |
| POS `OrderQueueTicker` (fixture fix) | 4 | PASS |
| POS `idle-lock` smoke | 2 | PASS |
| POS `restore-customer-refetch` smoke | 2 | PASS |
| POS `held-orders` (regression) | 5 | PASS |
| POS `display` (regression) | 17 | PASS |
| UI `vkp-dialog-a11y` | 2 | PASS |
| UI `VirtualKeypadProvider` (regression) | 5 | PASS |
| **Full sweep — domain** | 56 files / 635 | PASS |
| **Full sweep — UI** | 54 files / 338 | PASS |
| **Full sweep — POS** | 99 files / 405 (+1 skip) | PASS |
| `pnpm typecheck` (full) | 6/6 pkgs | PASS |

> No env-gated baseline failures observed in this run (VITE_SUPABASE_URL configured locally).

---

## 7. Permissions seeded

None. F-008 only removes the over-broad `anon` GRANT on `send_items_to_kitchen`.

---

## 8. RPCs added / bumped

| Action | RPC | Notes |
|---|---|---|
| Hardened (GRANT only) | `send_items_to_kitchen(UUID[])` | No signature change; REVOKE pair applied (F-008) |

No new RPCs.

---

## 9. Deviations vs spec/plan

| ID | Section | Original | What happened | Reason | Risk |
|---|---|---|---|---|---|
| DEV-S36-PLAN-01 | Base branch | Plan said base `master @ 0086017` | Branched `swarm/session-36` from `feat/pos-redesign @ 7dbb10a` | Task C1 edits `apps/pos/src/App.tsx`, which the unmerged reload-fix PR #66 also changed — basing off it avoids a conflict and builds on the latest POS state | Informational |
| DEV-S36-A-01 | Wave A — kiosk sweep | S25 backlog lists `kiosk-issue-jwt` in the PIN-in-header sweep | EF carries no body PIN (`kiosk_id`/`scope`/`device_label` + env JWT secret only) → no change | Already compliant | Informational |
| DEV-S36-A-02 | Wave A — F-008 | Spec framed F-008 as a live anon vuln | Task 0 found anon EXECUTE **already `false`** (revoked by the S20 global sweep `20260517223012`). Migration still applied as the canonical per-function REVOKE pair | Defense-in-depth + regression guard + local intent (original `20260505000004` still GRANTs anon) ; pgTAP green-from-start (no red-first) | Informational |
| DEV-S36-B-01 | Wave B — F-002 | Plan assumed `OrderType` was the 4-member DB enum | Domain `OrderType` is only 3-member (`dine_in\|take_out\|delivery`, no b2b). Helper keyed on an explicit 4-member `OrderTypeLabelKey` union covering b2b, without loosening the narrower Cart type. Exported from `src/index.ts` (no `orders/index.ts`) | Cart can't be b2b; orders can | Informational |
| DEV-S36-B-02 | Wave B — F-021 | Spec considered a type regen | No regen — `useTableOccupancy.ts:49` already uses the clean no-cast `.on('postgres_changes', …)` and compiles; F-021 is a pure cast removal | Regen wouldn't change `@supabase/supabase-js` `.on()` overloads anyway | Informational |
| DEV-S36-B-03 | Wave B — F-002 | Plan Option A: "rewrite the 3 sites to consume the helper" | OrderHistoryPanel (staff) consumes the helper ("Takeaway"); OrderQueueTicker + CurrentOrderCard (customer display) keep bespoke "Pickup" + table-aware copy, fixed `take_away`→`take_out` in-place | The helper doesn't model table numbers or customer-display vocabulary; divergence documented in `orderTypeLabel.ts` | Informational |
| DEV-S36-C-01 | Wave C — idle→lock | S35 plan ratified "manual lock only — no idle→lock rewire" (2026-06-03) | S36 reverses it: POS idle calls `authStore.lock()` (conditional on `isAuthenticated`); `IdleTimeoutMount` extracted to its own file for testing | Ratified user 2026-06-04 — `lock()` preserves shift+cart vs `signOut()`. POS only; BO stays logout-on-idle | Informational |
| DEV-S36-C-02 | Wave C — VKP a11y | Plan test asserted the literal `aria-hidden` attribute | Test asserts the **structural** invariant (`dialog.contains(overlay)` — overlay portaled into `[role=dialog]`) | jsdom doesn't run Radix's aria-hidden side-effects; containment is the real, testable guarantee | Informational |

---

## 10. Out of scope (deferred S37+)

Per spec §8: F-010 QR scan, F-011 ComboSelectorModal, F-012 vente au poids, F-013 Stripe Terminal, F-019 debts inline payment ; polish tail F-016..018/020/022..024 ; LAN cross-device cart mirror, print-bridge deployment, refund-test-investigation (`SUPABASE_SERVICE_ROLE_KEY`) ; business decisions (allergens receipt/display, offline mode, Apple/Google Pay).

---

## 11. Acceptance criteria

- [x] F-008 — `anon` cannot EXECUTE `send_items_to_kitchen`; `authenticated` can — pgTAP 2/2 PASS.
- [x] kiosk-issue-jwt — compliance documented (DEV-S36-A-01).
- [x] F-002 — `take_away`/`takeaway` swept (3 code sites + 1 fixture); `orderTypeLabel` covers the enum; UI shows human labels — smoke PASS; grep returns only the image-ref comment.
- [x] F-021 — `useDisplayRealtime` has no `as never`; realtime functional — typecheck PASS, display regression 17/17.
- [x] idle→lock — POS idle locks (not logout) when authenticated — smoke 2/2; BO unchanged.
- [x] DEV-S35-C-05 — customer badge restored on held-order restore — smoke 2/2.
- [x] DEV-S35-E3-01 — VKP overlay not `aria-hidden` inside a Radix Dialog — UI unit 2/2.
- [x] `pnpm typecheck` full sweep PASS (6/6).
- [x] INDEX filled + CLAUDE.md §Active Workplan bumped.
