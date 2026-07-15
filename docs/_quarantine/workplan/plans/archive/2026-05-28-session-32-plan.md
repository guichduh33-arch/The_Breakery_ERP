> 🗄️ **ARCHIVED / SUPERSEDED (banner added 2026-06-04).** Superseded draft — the "POS Service Polish" scope was re-numbered to **Session 35** (`2026-05-29-session-35-plan.md`, merged PR #62) after the Reports track took the S32 slot (PR #40). Never executed under this number (no INDEX). Kept verbatim for history.

# Session 32 — POS Service Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Livrer le palier "service polish" sur le POS : held orders DB-backed (F-003), VirtualKeypadProvider + QwertyLayout (F-005), Customer Display live cart mirror (F-007), POSSettingsPage tabs opérationnels (F-009), Lock Terminal (F-014), + Minor bundle (F-016/F-019/F-022/F-024). F-015 print URL est absorbé dans F-009 Printing tab.

**Architecture:** Pattern S26+ monotonique. 1 nouvelle table `held_orders` (RLS + 3 RPCs + REVOKE pairs), 1 nouvelle permission `sales.hold` seedée. UI new : `VirtualKeypadProvider` dans `@breakery/ui`, `CDActiveCartView`, 3 Settings tabs, `TerminalLockedOverlay`. BroadcastChannel API pour live cart mirror.

**Tech Stack:** PostgreSQL Supabase cloud `ikcyvlovptebroadgtvd`, Deno EFs, TypeScript monorepo, React 18, React-Query v5, Zustand persist, Vitest, pgTAP.

**Spec:** [`../../specs/archive/2026-05-28-session-32-spec.md`](../../specs/archive/2026-05-28-session-32-spec.md)

**Branch:** `swarm/session-32` (créée depuis `master` après merge S31)

**Audit source:** [`../../../audit/archive/2026-05-28-pos-audit.md`](../../../audit/archive/2026-05-28-pos-audit.md)

---

## Wave 0 — Branch + spec commit

### Task 0.1 : Branch + spec commit
- [ ] `git checkout master && git pull && git checkout -b swarm/session-32`
- [ ] `git add docs/workplan/specs/2026-05-28-session-32-spec.md docs/workplan/plans/2026-05-28-session-32-plan.md`
- [ ] `git commit -m "docs(s32): wave 0 — session 32 spec + plan (POS service polish)"`

---

## Wave 1 — F-003 : Held orders DB-backed

### Task 1.1 : Migration `_010` — `held_orders` table + RLS

**File:** `supabase/migrations/20260710000010_create_held_orders_table.sql`

- [ ] CREATE TABLE per spec §3.1
- [ ] Indexes : `idx_held_orders_session_active` partial WHERE not restored/discarded
- [ ] RLS + REVOKE INSERT/UPDATE/DELETE from authenticated/anon
- [ ] Apply via MCP

### Task 1.2 : Migration `_011` — `hold_order_v1` RPC + REVOKE pair

**File:** `supabase/migrations/20260710000011_create_hold_order_v1_rpc.sql`

- [ ] SECURITY DEFINER, gate `sales.hold` via `user_has_permission`
- [ ] Auth check, INSERT held_orders, emit audit_logs action='order.held'
- [ ] REVOKE EXECUTE FROM PUBLIC, anon (in same migration, pattern S25)
- [ ] Apply

### Task 1.3 : Migration `_012` — `restore_held_order_v1` RPC + REVOKE pair

**File:** `supabase/migrations/20260710000012_create_restore_held_order_v1_rpc.sql`

- [ ] SET restored_at=now() + RETURN cart_snapshot
- [ ] Idempotency : if already restored, return same snapshot (no error)
- [ ] REVOKE pair
- [ ] Apply

### Task 1.4 : Migration `_013` — `discard_held_order_v1` RPC + REVOKE pair

**File:** `supabase/migrations/20260710000013_create_discard_held_order_v1_rpc.sql`

- [ ] Validate p_reason length ≥ 5
- [ ] SET discarded_at=now(), discard_reason=p_reason
- [ ] Audit log
- [ ] REVOKE pair
- [ ] Apply

### Task 1.5 : Migration `_014` — seed `sales.hold` permission

**File:** `supabase/migrations/20260710000014_seed_sales_hold_permission.sql`

- [ ] INSERT INTO permissions (code, description)
- [ ] INSERT INTO role_permissions for cashier, waiter, manager, admin, super_admin
- [ ] Apply

### Task 1.6 : pgTAP tests

**File:** `supabase/tests/held_orders.test.sql`

- [ ] 15 cas T1-T15 per spec §9.1
- [ ] Run via cloud MCP `execute_sql` BEGIN/ROLLBACK
- [ ] **Critère** : 15/15 PASS

### Task 1.7 : Vitest live RPC

**File:** `supabase/tests/functions/held-orders.test.ts`

- [ ] 5 cas env-gated par `SUPABASE_SERVICE_ROLE_KEY`

### Task 1.8 : Types regen

- [ ] `mcp__plugin_supabase_supabase__generate_typescript_types`
- [ ] Write `packages/supabase/src/types.generated.ts`

### Task 1.9 : POS hooks

**Files:**
- `apps/pos/src/features/heldOrders/hooks/useHeldOrders.ts` (new) — useQuery + realtime
- `apps/pos/src/features/heldOrders/hooks/useHoldOrder.ts` (refactor) — replace local store call with RPC
- `apps/pos/src/features/heldOrders/hooks/useRestoreHeldOrder.ts` (refactor)
- `apps/pos/src/features/heldOrders/hooks/useDiscardHeldOrder.ts` (new)

### Task 1.10 : Drop `useHeldOrdersStore` + migration localStorage→DB

**File:** `apps/pos/src/stores/heldOrdersStore.ts` (delete) + `apps/pos/src/lib/heldOrdersMigration.ts` (new)

- [ ] One-shot migration on App mount : read `localStorage['breakery-held-orders']` → POST each entry via `hold_order_v1` → clear localStorage on success
- [ ] Mount in `App.tsx`

### Task 1.11 : Refacto `HeldOrdersModal` + `HoldOrderButton`

**Files:**
- `apps/pos/src/features/cart/HeldOrdersModal.tsx` — consume `useHeldOrders` query
- `apps/pos/src/features/heldOrders/components/HoldOrderButton.tsx` — call `useHoldOrder` mutation
- `apps/pos/src/features/cart/ActiveOrderPanel.tsx:121` — `heldCount` source = query length

### Task 1.12 : Smoke tests POS

**Files:**
- `apps/pos/src/features/heldOrders/__tests__/useHoldOrder.smoke.test.tsx` (3 cas)
- `apps/pos/src/features/heldOrders/__tests__/useRestoreHeldOrder.smoke.test.tsx` (3 cas)
- `apps/pos/src/__tests__/held-orders-migration.smoke.test.tsx` (2 cas)
- Update existing `apps/pos/src/__tests__/held-orders.smoke.test.tsx` for new query-based flow

### Task 1.13 : Commit Wave 1

- [ ] All migrations + RPCs + hooks + tests
- [ ] `git commit -m "feat(pos+db): session 32 — wave 1 — F-003 held orders DB-backed (held_orders table + 3 RPCs + RLS + sales.hold permission)"`

---

## Wave 2 — F-005 : VirtualKeypadProvider

### Task 2.1 : `@breakery/ui` components

**Files:**
- `packages/ui/src/components/virtual-keypad/VirtualKeypadProvider.tsx` (new)
- `packages/ui/src/components/virtual-keypad/VirtualKeypadOverlay.tsx` (new)
- `packages/ui/src/components/virtual-keypad/QwertyLayout.tsx` (new)
- `packages/ui/src/components/virtual-keypad/useVirtualKeypad.ts` (new)
- Export from `packages/ui/src/index.ts`

### Task 2.2 : Hook logic

- Listens to focus events globally on document
- Resolves layout from `<input>` attributes (`inputmode`, `type`)
- Honors `data-vkp="off"` opt-out
- Manages overlay open/close state via context

### Task 2.3 : UI unit tests

**Files:**
- `packages/ui/src/components/virtual-keypad/__tests__/VirtualKeypadProvider.test.tsx` (4 cas)
- `packages/ui/src/components/virtual-keypad/__tests__/QwertyLayout.test.tsx` (3 cas)

### Task 2.4 : Mount in POS App

**File:** `apps/pos/src/App.tsx`

- [ ] Wrap `<BrowserRouter>` content with `<VirtualKeypadProvider>`

### Task 2.5 : Audit existing inputs for opt-out

- [ ] Grep `apps/pos/src/` for `<input>` / `<Input>` / `<textarea>` outside `data-vkp="off"` modales
- [ ] `PinPad` inputs add `data-vkp="off"` (pin entry has its own numpad)
- [ ] `Numpad` PaymentTerminal — already has integrated numpad → `data-vkp="off"`
- [ ] PostgreSQL textarea (discount reason, cancel reason, void reason) → leave default (use QwertyLayout)

### Task 2.6 : POS integration smoke test

**File:** `apps/pos/src/__tests__/virtual-keypad-integration.smoke.test.tsx` (new)

- 2 cas : focus on customer search input → Qwerty appears ; focus on PinPad input → no overlay

### Task 2.7 : Commit Wave 2

- [ ] All UI components + tests + App mount + opt-out audit
- [ ] `git commit -m "feat(ui+pos): session 32 — wave 2 — F-005 VirtualKeypadProvider + QwertyLayout (touch-first invariant restored)"`

---

## Wave 3 — F-007 : Customer Display live cart mirror

### Task 3.1 : Émetteur hook

**File:** `apps/pos/src/features/display/hooks/useCartBroadcast.ts` (new)

- [ ] Subscribe `cartStore` change → post message to `BroadcastChannel('breakery-pos-cart')`
- [ ] Mount in `pages/Pos.tsx`

### Task 3.2 : Récepteur hook

**File:** `apps/pos/src/features/display/hooks/useCartBroadcastReceiver.ts` (new)

- [ ] Listen on `BroadcastChannel('breakery-pos-cart')`
- [ ] Expose live cart state

### Task 3.3 : `CDActiveCartView` composant

**File:** `apps/pos/src/features/display/CDActiveCartView.tsx` (new)

- [ ] Layout : items list à gauche + total live à droite
- [ ] Empty state "Welcome — your order will appear here"
- [ ] Highlight gold animation à chaque update (200ms)

### Task 3.4 : Wire in `CustomerDisplayPage`

**File:** `apps/pos/src/features/display/CustomerDisplayPage.tsx`

- [ ] Splitscreen : `CDActiveCartView` à gauche, `OrderQueueTicker` à droite
- [ ] Both sourced live (cart broadcast + queue realtime)

### Task 3.5 : Smoke tests

**File:** `apps/pos/src/features/display/__tests__/CDActiveCartView.smoke.test.tsx` (new)

- 3 cas : empty state, with items, with customer

### Task 3.6 : Commit Wave 3

- [ ] All files + tests
- [ ] `git commit -m "feat(pos): session 32 — wave 3 — F-007 customer display live cart mirror (BroadcastChannel)"`

---

## Wave 4 — F-009 : POSSettingsPage tabs

### Task 4.1 : Printing tab

**File:** `apps/pos/src/features/settings/components/PrintingTab.tsx` (new)

- [ ] Settings keys via `usePOSPresets` extended : `print_server_url`, `print_auto_on_checkout`, `drawer_auto_on_cash`, `receipt_footer_text`
- [ ] "Test print" button → dummy ticket
- [ ] Wire in `POSSettingsPage:78` (replace `<PlaceholderSection title="Printing" />`)

### Task 4.2 : KDS & Display tab

**File:** `apps/pos/src/features/settings/components/KdsDisplayTab.tsx` (new)

- [ ] Toggles + pairing code display (read from kiosk_devices)
- [ ] Wire `:79`

### Task 4.3 : Devices tab

**File:** `apps/pos/src/features/settings/components/DevicesTab.tsx` (new)

- [ ] Health cards : print server, LAN hub, terminal
- [ ] Wire `:80`

### Task 4.4 : `printService.ts` reads URL from settings

**File:** `apps/pos/src/services/print/printService.ts`

- [ ] Replace const `SERVER_URL = 'http://localhost:3001'` with `function getServerUrl()` that reads `localStorage['breakery-print-server-url']` or default
- [ ] `printReceipt` + `openCashDrawer` + `checkPrintServer` use the function

### Task 4.5 : `SuccessModal` honors drawer toggle

**File:** `apps/pos/src/features/payment/SuccessModal.tsx`

- [ ] Read `drawer_auto_on_cash` from `usePOSPresets`
- [ ] Drawer = `tenders.some(cash) && drawer_auto_on_cash`

### Task 4.6 : Smoke tests

**Files:**
- `apps/pos/src/features/settings/__tests__/PrintingTab.smoke.test.tsx` (3 cas)
- `apps/pos/src/features/settings/__tests__/KdsDisplayTab.smoke.test.tsx` (2 cas)
- `apps/pos/src/features/settings/__tests__/DevicesTab.smoke.test.tsx` (2 cas)

### Task 4.7 : Commit Wave 4

- [ ] `git commit -m "feat(pos): session 32 — wave 4 — F-009 + F-015 POSSettingsPage tabs operational (Printing + KDS&Display + Devices)"`

---

## Wave 5 — F-014 : Lock Terminal

### Task 5.1 : Store

**File:** `apps/pos/src/stores/terminalLockStore.ts` (new)

- [ ] Zustand state `{ locked, lockedAt, lockedByUserId, lock(), unlock() }`

### Task 5.2 : Overlay composant

**File:** `apps/pos/src/features/auth/TerminalLockedOverlay.tsx` (new)

- [ ] Fullscreen overlay : UserPicker + PinPad
- [ ] On verify success via `auth-verify-pin` EF → call `unlock()` + restore authStore

### Task 5.3 : Mount in App

**File:** `apps/pos/src/App.tsx`

- [ ] Conditionally render `<TerminalLockedOverlay>` when locked

### Task 5.4 : Wire in `SideMenuDrawer`

**File:** `apps/pos/src/pages/Pos.tsx:170-180`

- [ ] Pass `onLockTerminal={() => useTerminalLockStore.getState().lock(user!.id)}`

### Task 5.5 : Pause idle timeout when locked

**File:** `apps/pos/src/App.tsx` `IdleTimeoutMount`

- [ ] If terminal locked → don't start idle timeout

### Task 5.6 : Smoke tests

**File:** `apps/pos/src/features/auth/__tests__/TerminalLockedOverlay.smoke.test.tsx` (3 cas)

### Task 5.7 : Commit Wave 5

- [ ] `git commit -m "feat(pos): session 32 — wave 5 — F-014 Lock Terminal (pause without logout, cart preserved)"`

---

## Wave 6 — Minor bundle (F-016, F-019, F-022, F-024)

### Task 6.1 : F-016 — SideMenuDrawer callbacks wired

**File:** `apps/pos/src/pages/Pos.tsx:170-180`

- [ ] Add `onOpenHeldOrders={() => setHeldOrdersOpen(true)}` (needs state lifted from `ActiveOrderPanel`)
- [ ] Add `onOpenCustomers={() => setCustomerSearchOpen(true)}`

**Trade-off** : Held orders modal currently owned by `ActiveOrderPanel`. To wire from drawer, lift the state to `Pos.tsx`. Effort XS.

### Task 6.2 : F-019 — Inline pay in CustomerDebtsPanel

**File:** `apps/pos/src/features/customers/CustomerDebtsPanel.tsx`

- [ ] Replace `navigate('/pos?orderHistoryFor=' + orderId)` with `useDebtPayment(orderId)` hook that opens `PaymentTerminal` with `pickedUpOrderId` set
- [ ] Loads order detail RPC `get_order_for_pickup_v1` (existing)

### Task 6.3 : F-022 — Cart TTL warning toast

**File:** `apps/pos/src/stores/cartStore.ts` `merge` callback

- [ ] On rehydrate, if `cart.items.length > 0` and TTL < 2h remaining < 30min → toast warning "Cart will expire in {n}min — checkout or hold soon"

### Task 6.4 : F-024 — Print smoke modifiers

**File:** `apps/pos/src/__tests__/print.smoke.test.tsx`

- [ ] Add cas T-modifiers : cart line with modifiers → assert `payload.items[0].modifiers` non empty

### Task 6.5 : Commit Wave 6

- [ ] `git commit -m "chore(pos): session 32 — wave 6 — minor bundle (F-016 drawer callbacks, F-019 inline pay, F-022 cart TTL warn, F-024 print modifiers test)"`

---

## Wave 7 — Closeout

### Task 7.1 : Full typecheck + test sweep

- [ ] `pnpm typecheck` → 6/6 PASS
- [ ] `pnpm --filter @breakery/domain test`
- [ ] `pnpm --filter @breakery/ui test`
- [ ] `pnpm --filter @breakery/pos test`
- [ ] `pnpm --filter @breakery/supabase test`

### Task 7.2 : INDEX

**File:** `docs/workplan/plans/2026-05-28-session-32-INDEX.md`

- [ ] Sections : Summary, Migrations, Files, Tests, Deviations, Follow-ups (backlog S33+)

### Task 7.3 : Update CLAUDE.md Active Workplan

- [ ] Append S32 closeout

### Task 7.4 : Commit closeout

- [ ] `git commit -m "docs(s32): wave 7 — INDEX + CLAUDE.md Active Workplan + backlog status notes (S32 closeout)"`

### Task 7.5 : PR

- [ ] `gh pr create --title "feat(pos): session 32 — POS service polish (F-003 held DB, F-005 vkp, F-007 mirror, F-009 settings, F-014 lock, minor bundle)"`

---

## Deviation tracking

`outputs/s32-deviations.md` — list DEV-S32-N.M-NN entries per project convention.

---

## Backlog S33+ (référence, hors S32)

| ID | Titre | Sévérité originale | Effort estimé | Pourquoi reporté |
|---|---|---|---|---|
| F-010 | Scan QR / barcode caméra | 🟠 | M | Intégration `html5-qrcode` + permissions caméra + mapping product SKU |
| F-011 | ComboSelectorModal | 🟠 | L | Refacto cart_line.combo_selections JSONB + tables combo_components |
| F-012 | Vente au poids | 🟠 | L | Web Serial API balance integration + `products.sale_unit` schema |
| F-013 | Stripe Terminal pre-auth dine-in | 🟠 | L | Partenariat Stripe + SDK setup + flow tab management |
| F-020 | Doublon CartItemRow/CartLineRow | 🟡 | XS | Cosmetic refactor, no functional impact |
| F-021 | `'postgres_changes' as never` | 🟡 | XS | Auto-fix au prochain `gen-types` après une migration touchant order_items |
| F-023 | NPWP sur receipt | 🟡 | XS | Dépend validation fiscale NON-PKP — décision business |
| - | Quick reorder | 🟠 backlog POS.md | M | "Refaire la même" depuis OrderHistory |
| - | Reservation / pré-commande client | 🟠 backlog | M | Acompte + retrait différé (anniversaire/gâteau sur mesure) |
| - | Multi-language UI (Bahasa Indonesia) | 🟠 backlog | M | i18n integration |
| - | Apple Pay / Google Pay tap-to-pay | 🟢 backlog | L | Hardware NFC + processor integration |
| - | Voice search | 🟡 backlog | M | Web Speech API |
| - | Suggested upsell | 🟡 backlog | M | Basket analysis ML |
| - | Customer-facing payment QR | 🟢 backlog | M | QR dynamic + bank app integration |

**Décisions business pré-S33** :
- Option B F-001 (draft orders persistés) — métier confirme Send-to-Kitchen avant Checkout ?
- Print server externe — qui le maintient ?
- `project_allergens_wontfix` — toujours WONTFIX en 2026-08+ ?
