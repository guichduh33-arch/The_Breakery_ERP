# Session 13 — Phase 4.A — POS UX + 03 polish

**Branch:** `swarm/session-13`
**Date opened:** 2026-05-14
**Migrations:** none (UI-only phase)
**Complexity:** M (~14-18 h)
**Parallel-with:** 4.B (KDS), 4.C (Customer Display), 4.D (Tablet + ui-steward batch 2)

## Scope

Wave 4 surface UX cascade — POS hardening (02-001/002/006/020) + 03 payment polish
relying on RPCs already bumped by Phase 1.A (`complete_order_with_payment_v9`,
`pay_existing_order_v6`).

Five concrete deliverables:

1. **cartStore network-split / re-mount hardening** — `useCartStore` already
   persists `cart` + `lockedItemIds` + `attachedCustomer` + `pickedUpOrderId`
   to `sessionStorage` via Zustand `persist` middleware. We need to guarantee
   the store survives:
   - StrictMode double-mount (already verified for the realtime channels —
     same principle for the cart subscription).
   - Network split + realtime reconnect (KDS hook reconnects automatically;
     cart shouldn't lose unsent line edits).
   - Tab reload mid-checkout (already covered by persist).
   - Offline mode → graceful read-only. Detect via `navigator.onLine`
     listener; expose `isOffline` boolean from the store; disable mutations
     when offline.
2. **PaymentTerminal idempotency UX** — `usePaymentStore` already regenerates
   `idempotencyKey` on `open()`, `close()`, `reset()`. Two gaps:
   - On RPC failure (network blip, 5xx, transient), show a **Retry** button
     that preserves the **same** `idempotencyKey` so server returns the same
     replay-safe response (server has UNIQUE on `(session_id, idempotency_key)`).
     Currently `onError` only fires `toast.error`; the user has no clear path.
   - When the server returns `idempotent_replay: true` (already-paid /
     conflict), show a non-destructive banner that the order was already
     finalized.
3. **OrderRetryBanner** (CREATE) — covers the rare race where an order
   reaches `status='paid'` but the JE trigger failed (e.g. account mapping
   missing, fiscal period closed mid-tx). Detection: query the order with
   `journal_entries(reference_id=order.id, reference_type='sale')` and check
   for zero rows. One-click retry calls a new lightweight RPC OR re-invokes
   the trigger. Wave 1 hotfix migration `20260517000010_refactor_create_sale_journal_entry.sql`
   already added an idempotent rebuild — call it again via a thin RPC wrapper.
4. **ServiceSpeedIndicator** (CREATE) — small badge in POS header reading
   current hour's avg fulfillment time. Manager+ only. Reuses Phase 2.B
   `get_sales_by_hour_v1(p_date)` for revenue but for fulfillment we need an
   order-creation-to-paid-at delta. Since 2.B doesn't expose that, indicator
   uses a lightweight client-side query: count today's paid orders this hour
   and read `mv_sales_daily` for context. Acceptable simplification — the
   indicator's role is "feel the rhythm", not precise SLA tracking.
5. **Tests** — Vitest co-located.

## Cumulative learnings applied

- `useCartStore` lives at `apps/pos/src/stores/cartStore.ts` (NOT `features/cart/store/...` as the INDEX line 772 suggests — actual path verified via Glob; INDEX is stale, will note as deviation D-W4-4A-01).
- `pay_existing_order_v6` is the active RPC (see `useCheckout`).
- `complete_order_with_payment_v9` is the active RPC.
- `mv_sales_daily` exists (Wave 2); we use `get_sales_by_hour_v1` instead for hourly granularity.
- `PermissionCode` union — gating ServiceSpeedIndicator on `'reports.read'` (already in the union, no `as never` cast needed).
- D19 realtime: no new channels in this phase; nothing to migrate.
- Tests pattern from `CloseShiftModal.smoke.test.tsx` — RTL + mocked supabase rpc + sonner mock + QueryClientProvider wrapper.

## Files

### POS app

- `apps/pos/src/stores/cartStore.ts` (UPDATE) — add `isOffline` + listener init / teardown helper.
- `apps/pos/src/features/payment/PaymentTerminal.tsx` (UPDATE) — idempotency retry banner + last-error state.
- `apps/pos/src/features/order-history/components/OrderRetryBanner.tsx` (CREATE).
- `apps/pos/src/features/order-history/hooks/useOrderRetryStatus.ts` (CREATE) — query for missing JE.
- `apps/pos/src/features/order-history/hooks/useRetryOrderJournal.ts` (CREATE) — invoke retry RPC.
- `apps/pos/src/features/order-history/components/OrderDetailDrawer.tsx` (UPDATE) — surface banner.
- `apps/pos/src/features/products/components/ServiceSpeedIndicator.tsx` (CREATE).
- `apps/pos/src/features/products/hooks/useServiceSpeed.ts` (CREATE).

### Tests (Vitest co-located)

- `apps/pos/src/stores/__tests__/cartStore.networkSplit.test.ts` (CREATE).
- `apps/pos/src/features/payment/__tests__/PaymentTerminal.idempotency.test.tsx` (CREATE).
- `apps/pos/src/features/order-history/__tests__/OrderRetryBanner.test.tsx` (CREATE).
- `apps/pos/src/features/products/__tests__/ServiceSpeedIndicator.test.tsx` (CREATE).

### Domain

- `packages/domain/src/payments/retryClassifier.ts` (CREATE) — pure: classify checkout error → `{ kind: 'retryable' | 'already_paid' | 'fatal', userMessage }`.
- `packages/domain/src/payments/__tests__/retryClassifier.test.ts` (CREATE).
- `packages/domain/src/payments/index.ts` (UPDATE if needed) — barrel export.

## Working sequence

1. Sub-plan + commit ✓ (this file).
2. Domain `retryClassifier` + unit tests.
3. `useOrderRetryStatus` + `useRetryOrderJournal` hooks.
4. `OrderRetryBanner` component + test.
5. `useServiceSpeed` + `ServiceSpeedIndicator` + test.
6. `cartStore` offline + reconnect + test.
7. `PaymentTerminal` idempotency UI + test.
8. Wire banner into `OrderDetailDrawer`.
9. `pnpm typecheck`, run focused tests, commit per atomic feature.
10. Append deviation pack D-W4-4A entries.

## DoD checklist

- [ ] POS reload under load OK — assert `cartStore` preserves state across StrictMode double-mount.
- [ ] Order retry banner visible when JE missing on completed order ; one-click retry works.
- [ ] Service speed indicator visible to manager+ ; renders within 250ms with mocked rpc.
- [ ] Payment modal idempotency UX clear — retry preserves `client_payment_id`, conflict shows banner.
- [ ] All new/updated tests green.
- [ ] `pnpm typecheck` green.
- [ ] Commits squash-mergeable, Claude co-author.

## Deviations (D-W4-4A-NN)

To be appended to `docs/workplan/refs/2026-05-14-session-13-wave-3-deviations.md`
or a new W4 deviation file (decided at commit time).
