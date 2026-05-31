# Session 34 — Station Ticket Printing — INDEX

> **Date** : 2026-06-01
> **Branche** : `swarm/session-34`
> **Base** : `master` @ `dafc500` (post-merge S33 PR #53 security-fraud-guard)
> **Status** : ✓ ready to merge
> **Spec** : [`../specs/2026-06-01-session-34-station-printing-spec.md`](../specs/2026-06-01-session-34-station-printing-spec.md)
> **Plan** : [`./2026-06-01-session-34-station-printing-plan.md`](./2026-06-01-session-34-station-printing-plan.md)

---

## 1. Summary

Session 34 delivers end-to-end **station ticket printing** for the POS: prep tickets routed per product category to barista / kitchen / bakery thermal printers, bill printing (pre-payment addition) to cashier/waiter, and auto-fire of unprinted prep items on checkout. Receipt routing to the cashier printer completes the full print flow.

Architecture is **mock-first** (VITE_PRINT_MOCK=1 in CI; external print-bridge `localhost:3001` at runtime). Five printer roles: `barista`, `kitchen`, `bakery` (prep stations) + `cashier`, `waiter` (document/receipt printers), all resolved from `lan_devices.capabilities->>'station'` via the new `useStationPrinters` hook.

**Business pivot (DEV-S34-W0-01):** original spec called for POS on-screen station displays (KDS-like); replaced with hardware thermal printers at sessions start. KDS screen-side deferred S35.

**Tests** : 7 pgTAP rows `category_station_remap` PASS via cloud MCP (verified live, pre-W4 controller) + 7 new POS Vitest smoke tests PASS. `pnpm --filter @breakery/app-pos typecheck` PASS.

---

## 2. Migration applied (1)

| Timestamp | File | Object |
|---|---|---|
| `20260601043059` | `_remap_categories_dispatch_station_printer_model.sql` | UPDATE categories: Beverage→barista, Sandwiches→kitchen, Pastry/Bread→bakery; idempotent. |

Total: **1 migration** (data-only, no schema change — categories.dispatch_station col + CHECK existed since prior sessions).

---

## 3. New files (S34)

### DB + tests
- `supabase/migrations/20260601043059_remap_categories_dispatch_station_printer_model.sql`
- `supabase/tests/category_station_remap.test.sql` — 7 pgTAP (category→station mapping assertions)

### Domain
- `packages/domain/src/printing/types.ts` — `PrintKind` union (`'prep' | 'bill' | 'receipt'`) + `PrinterRole` union (5 roles)
- `packages/domain/src/printing/groupItemsByStation.ts` — pure `groupItemsByStation(items, stationByProductId)` returns `Record<PrepStation, CartItem[]>`
- `packages/domain/src/printing/index.ts` — barrel
- `packages/domain/src/printing/__tests__/groupItemsByStation.test.ts` — unit tests

### POS services + hooks
- `apps/pos/src/services/print/printService.ts` — `printStationTicket(printer, payload)` + `printReceipt(payload, printer?)` + mock buffer (`getMockPrintBuffer`, `clearMockPrintBuffer`, `VITE_PRINT_MOCK` guard)
- `apps/pos/src/features/cart/hooks/useStationPrinters.ts` — `Map<PrinterRole, {ip_address, port, name}>` from `lan_devices`
- `apps/pos/src/features/cart/hooks/useFireToStations.ts` — mutation: group unprinted items by station, fire concurrently, `markLocked+markPrinted` on success; `firableCount` computed from products query cache
- `apps/pos/src/features/cart/hooks/usePrintBill.ts` — mutation `{role: 'cashier'|'waiter'}`: whole-order bill ticket, re-printable, no markPrinted

### POS UI
- `apps/pos/src/features/cart/PrintBillButton.tsx` — role by tableNumber/pickedUpOrderId; toasts

### POS smoke tests (W4)
- `apps/pos/src/features/cart/__tests__/fire-to-stations.smoke.test.tsx` — 1 test
- `apps/pos/src/features/cart/__tests__/fire-printer-unreachable.smoke.test.tsx` — 1 test
- `apps/pos/src/features/cart/__tests__/print-bill.smoke.test.tsx` — 1 test
- `apps/pos/src/features/payment/__tests__/checkout-autofire.smoke.test.tsx` — 2 tests
- `apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx` — 1 test

### Workplan
- `docs/workplan/specs/2026-06-01-session-34-station-printing-spec.md`
- `docs/workplan/plans/2026-06-01-session-34-station-printing-plan.md`
- `docs/workplan/plans/2026-06-01-session-34-station-printing-INDEX.md` (this file)

---

## 4. Files modified (S34)

- `packages/domain/src/types/product.ts` — add `dispatch_station?: DispatchStation` to `Product` type
- `packages/domain/src/index.ts` — re-export printing barrel
- `apps/pos/src/features/products/hooks/useProducts.ts` — append `categories(dispatch_station)` to SELECT, flatten to `dispatch_station` on each Product row
- `apps/pos/src/stores/cartStore.ts` — add `printedItemIds: string[]` + `markPrinted` + `unprintedItems()` + `unprintedItemIds()`; `clear()` resets `printedItemIds`; `restoreCart()` also resets
- `apps/pos/src/features/cart/hooks/useSendToKitchen.ts` — **DELETED** (fake markLocked-only hook fully removed; replaced by `useFireToStations`; no dangling importers)
- `apps/pos/src/features/cart/SendToKitchenButton.tsx` — rewired to `useFireToStations`; per-station toast (success/error)
- `apps/pos/src/features/cart/ActiveOrderPanel.tsx` — add `<PrintBillButton />`
- `apps/pos/src/features/payment/PaymentTerminal.tsx` — `dispatchCheckout`: non-blocking auto-fire of unprinted prep items after checkout; per-station error toast on failure; SuccessModal receives the result for receipt routing
- `apps/pos/src/features/payment/SuccessModal.tsx` — `useStationPrinters` → `cashierPrinter`; `printReceipt(payload, cashierPrinter)` on mount (auto-print); degraded fallback (no printer = prints without routing, `toast.warning`)

---

## 5. Category → station mapping (migration `20260601043059`)

| Category (name lowercase) | dispatch_station | Printer role |
|---|---|---|
| Beverage | `barista` | barista |
| Sandwiches | `kitchen` | kitchen |
| Plate, Savoury | `kitchen` (pre-existing) | kitchen |
| Viennoiserie, Bagel, Pastry, Bread | `bakery` (pre-existing or updated) | bakery |
| Ingredient | `none` | — (not routed) |

---

## 6. Printer roles (5)

| Role | Kind | Resolved via |
|---|---|---|
| `barista` | prep | `lan_devices.capabilities->>'station' = 'barista'` |
| `kitchen` | prep | `lan_devices.capabilities->>'station' = 'kitchen'` |
| `bakery` | prep | `lan_devices.capabilities->>'station' = 'bakery'` |
| `cashier` | bill + receipt | `lan_devices.capabilities->>'station' = 'cashier'` |
| `waiter` | bill | `lan_devices.capabilities->>'station' = 'waiter'` |

All resolved at runtime by `useStationPrinters()` (5-min stale-time). Missing printer → `{ ok: false, error: 'no_printer' }` result, toast.error per station.

---

## 7. Commits (S34)

| Commit | Wave | Description |
|---|---|---|
| `02ce30c` | W0 | docs(workplan): spec + plan |
| `261e13b` | W1.1 | feat(domain,db): dispatch_station remap + groupItemsByStation |
| `5396d5c` | W1.2 | feat(pos): expose dispatch_station on products |
| `9f11474` | W2.2/2.3 | feat(pos): printStationTicket + useStationPrinters |
| `3b818ac` | W2.4 | feat(pos): cartStore printedItemIds tracking |
| `6fa62f7` | W2.4 fix | fix(pos): preserve printedItemIds in clear() |
| `ce20fdb` | W2.4 fix | fix(pos): reset printedItemIds in restoreCart() |
| `049bac8` | W2.5/2.6 | feat(pos): useFireToStations replaces fake send-to-kitchen |
| `5b43c97` | W2.5/2.6 fix | fix(pos): firableCount gate + cache-read routing + lock-before-print |
| `5153140` | W2.6 | feat(pos): usePrintBill + PrintBillButton |
| `1c95e32` | W2.6 fix | fix(pos): simplify usePrintBill order label |
| `e4a0ee9` | W2.8 | feat(pos): checkout auto-fire + receipt→cashier printer |
| `02de350` | W2.8 fix | fix(pos): toast noise + mock discriminant + unprinted filter |
| *(this commit)* | W4 | test(pos): smokes + pgTAP + INDEX + CLAUDE.md |

---

## 8. Tests run

| Suite | Count | Status |
|---|---|---|
| pgTAP `category_station_remap` (cloud MCP, pre-W4) | 7/7 | PASS |
| POS smoke `fire-to-stations` | 1/1 | PASS |
| POS smoke `fire-printer-unreachable` | 1/1 | PASS |
| POS smoke `print-bill` | 1/1 | PASS |
| POS smoke `checkout-autofire` | 2/2 | PASS |
| POS smoke `receipt-targets-cashier` | 1/1 | PASS |
| `pnpm --filter @breakery/app-pos typecheck` | PASS | |
| Pre-existing cart + payment suites (non-regression) | 32/32 | PASS |

**Total: ~46 tests PASS, 0 fail.**

---

## 9. Deviations vs spec/plan

| ID | Section | Original | What happened | Reason | Risk |
|---|---|---|---|---|---|
| DEV-S34-W0-01 | §1 scope | POS on-screen station displays | Business pivot: hardware thermal printers | User decision at session start | Informational — screens deferred S35 |
| DEV-S34-W0-02 | §2 bridge | External print-bridge (localhost:3001) | Deferred runtime dependency; mock-first in CI | No bridge deployed yet | S34-FOLLOWUP: bridge deployment + integration test |
| DEV-S34-W2.8-01 | §4 SuccessModal | cashierPrinter from useStationPrinters() | Cold-query on SuccessModal mount: `printers?.get('cashier')` is undefined if the query hasn't resolved yet. Falls back to `printReceipt(payload, undefined)` = no printer routing = print goes to default bridge endpoint (degraded). StrictMode double-mount is safe (useEffect dep=[open] + `open=true`). | Query hasn't prefetched if modal rendered first time in session | Informational |
| DEV-S34-W4-01 | P1 findings | Receipt method/tax/drawer | Not implemented this session; bill + prep receipt only; openCashDrawer is best-effort (no error surfaced) | Scope: S35+ | Informational |

---

## 10. Deferred S35+ (out of scope)

1. **External print-bridge deployment** (DEV-S34-W0-02) — `localhost:3001` bridge must be deployed + configured on POS device; integration test pending.
2. **KDS on-screen station displays** (DEV-S34-W0-01) — the original spec; deferred after business pivot to printers.
3. Receipt enhancements: method-aware (non-cash), tax line itemised, drawer amount display.
4. openCashDrawer error surfacing (currently silent if bridge unreachable).
5. Receipt cold-query fix: pre-warm `['station-printers']` query on POS mount so cashierPrinter is always available at SuccessModal render.
6. cartStore: align `unprintedItemIds()` with `unprintedItems()` (add `!is_cancelled` guard) ; replace inline `PREP_STATIONS` in `useFireToStations` with `KDS_STATIONS` from `@breakery/domain` (DRY).
7. Waiter printer bill routing for tablet orders end-to-end test.
8. BO + POS smoke suite backlog (S33 follow-up: VoidOrderModal, EditOrderItemsModal, OpenShiftModal terminal selector).
9. Ongoing S33 out-of-scope: refund from BO, edit other order fields, mobile responsive, UnifiedReportFilters, compare toggle, hub KPI/favorites, 6 Soon cards.
