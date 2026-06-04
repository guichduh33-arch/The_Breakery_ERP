# Session 35 — POS Service Polish — INDEX

> **Branch** : `swarm/session-35` (base `master` @ `2de5eac`, post-S35a PR #61)
> **Spec** : [`../specs/2026-05-29-session-35-spec.md`](../specs/2026-05-29-session-35-spec.md)
> **Plan** : [`./2026-05-29-session-35-plan.md`](./2026-05-29-session-35-plan.md)
> **Status** : ✅ all 5 findings delivered — ready to merge.
> **Execution** : subagent-driven (one implementer + 2-stage review per task).

---

## 1. Scope delivered (5 Major audit findings)

| Finding | Wave | What shipped |
|---|---|---|
| **F-014** Lock Terminal | A | `authStore.isLocked`/`lock`/`unlock` (session-preserving) + `<TerminalLockedOverlay>` PIN re-auth gate + `Pos.tsx` wiring. Cart + shift survive (separate stores). |
| **F-009** Settings Printing tab (+ F-015) | B | `usePosSettingsStore` (Zustand persist, `pos:settings`) + `printService` reads URL at call-time (completes F-015) + `SuccessModal` auto-print/auto-drawer toggles + `<PrintingSettingsTab>`. |
| **F-003** Held orders DB-backed | C | `orders.is_held` + `notes` + 3 SECURITY DEFINER RPCs (`hold`/`restore`/`discard`) + idempotency table + pgTAP 16/16 + DB-backed POS hooks (query/hold/restore/discard/realtime) + UI rewire + retire localStorage store. |
| **F-007** Customer Display cart mirror | D | `useCartBroadcast` emitter + `useCartBroadcastReceiver` + `<CDActiveCartView>` via `BroadcastChannel('breakery-cart')` + wiring (POS emitter / `/display` receiver). |
| **F-005** Virtual keypad | E | `<QwertyLayout>` + `<VirtualKeypadProvider>` (focus-driven, input+textarea, `inputmode=none`) + `useVirtualKeypad` + mount around `/pos` + opt-in 3 reason/search inputs. |

---

## 2. Migrations (block `20260620000010..015`, applied to V3 dev `ikcyvlovptebroadgtvd`)

| Version | Name |
|---|---|
| `…000010` | `add_is_held_and_notes_to_orders` (col + partial index) |
| `…000011` | `create_held_order_idempotency_and_hold_order_v1` |
| `…000012` | `revoke_hold_order_v1` (REVOKE pair) |
| `…000013` | `create_restore_held_order_v1` (+ REVOKE pair inline) |
| `…000014` | `create_discard_held_order_v1` (+ REVOKE pair inline) |
| `…000015` | `relax_orders_session_id_for_held` (corrective — caught by pgTAP T1) |
| `…000016` | `fix_held_rpcs_default_privileges_from_public` (corrective — pattern-guardian P11: ALTER DEFAULT PRIVILEGES `FROM anon` → canonical `FROM PUBLIC`) |

Base verified via `list_migrations` (prior max `20260606000013`). Types regen → `packages/supabase/src/types.generated.ts`.

No new permissions seeded — reuses `pos.sale.create` (hold/restore, CASHIER+) + `orders.void` (discard, MANAGER+).

---

## 3. Tests

- **pgTAP** `supabase/tests/held_orders.test.sql` — **16/16 PASS** via cloud MCP (hold/restore/discard happy + draft+is_held + notes + idempotency + round_idr line totals + audit + perm gate P0003 + not-found P0002 + reason P0001 + anon revoked).
- **POS smoke/unit** (Vitest): `authStore.lock` (2) · `terminal-locked-overlay` (3) · `pos-lock-terminal` (1) · `posSettingsStore` (3) · `print-server-url-config` (+1 store-precedence) · `success-modal-auto-toggles` (2) · `printing-settings-tab` (2) · `POSSettingsPage` (12) · `cart-broadcast` (1) · `cd-active-cart-view` (2) · display suite (16) · `held-orders-query` (1) · `hold-order-db` (2) · `held-orders.smoke` (4) · `golden-path` (27).
- **UI unit** (`@breakery/ui`): `QwertyLayout` (3) · `VirtualKeypadProvider` (5).
- **Typecheck**: `@breakery/app-pos`, `@breakery/ui`, `@breakery/supabase` — all PASS (0 errors).

Pre-existing baseline (NOT regressions): `variant-select-modal.smoke` flakes under full-`cart`-suite load (passes in isolation), per the documented flake-under-load pattern.

---

## 4. Deviations

| ID | Sev | Note |
|---|---|---|
| DEV-S35-PLAN-01 | info | Spec assumed an S34 `create_draft_order_with_items_v1` to reuse — it does not exist (S34 = Station Printing). F-003 built `hold_order_v1` from scratch on the `create_tablet_order_v2` template. |
| DEV-S35-C-01 | info | `orders` had no `notes` column → added (additive) so held-order notes persist + show in the list. |
| DEV-S35-C-02 | info | hold/restore gate is `pos.sale.create` (CASHIER+), not `sales.create` (waiter/tablet). Verified `has_permission` is table-driven + CASHIER has `pos.sale.create`. |
| DEV-S35-C-03 | low | Corrective `_015`: `orders_session_id_required_for_pos` relaxed to exempt `is_held=true` (held drafts are session-independent; caught by pgTAP T1). |
| DEV-S35-C-04 | info | restore + discard **DELETE** the held draft (items + idem row cascade) rather than void — deliberately avoids the `status→voided` JE trigger (`trg_create_sale_journal_entry_upd`) firing on a draft with no sale JE. The real sale is a fresh order at checkout. |
| DEV-S35-C-05 | low | On restore, `cart.customerId` is re-linked but the full `attachedCustomer` badge object is not re-fetched (the RPC returns only the id; `restoreCart` nulls the object). Pricing/JE keyed off `customerId` is intact; only the visual badge is missing until re-attach. Follow-up: customer re-fetch on restore. |
| DEV-S35-C-06 | info | `hold_order_v1` silently skips items whose `product_id` is unknown (inherited from `create_tablet_order_v2`). Held orders are re-editable, so low risk. |
| DEV-S35-E3-01 | low | The `<VirtualKeypadProvider>` overlay is `aria-hidden` when opened from inside a Radix modal Dialog (it renders outside the dialog portal). Works visually + by touch (the POS interaction model); not announced to screen readers. Full a11y (portal overlay into active dialog) deferred. |
| DEV-S35-B-01 | info | `SectionLabel` does not accept `as="label"`/`htmlFor` → `PrintingSettingsTab` uses a plain `<label>` (input keeps `aria-label`). |
| DEV-S35-A-01 | info | `NumpadPin` has no auto-submit (explicit "Verify" button) + does not clear its buffer after submit → `TerminalLockedOverlay` resets it on failed attempts via an attempt-counter `key`. |

---

## 5. Out of scope (backlog S36+)

Per spec §10: F-010 QR scan, F-011 ComboSelectorModal, F-012 vente au poids, F-013 Stripe Terminal, F-019 debts inline payment, F-020 CartItemRow dedup, F-021 useDisplayRealtime typings, F-022 cart TTL UX, F-023 NPWP receipt, F-024 modifier receipt test, kiosk-issue-jwt PIN sweep, LAN-hub cross-device cart mirror (F-007 extension), idle→lock rewire, VKP a11y inside modals (DEV-S35-E3-01), customer re-fetch on held restore (DEV-S35-C-05).
