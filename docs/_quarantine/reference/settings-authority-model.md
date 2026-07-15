# Settings authority model

> S73 Phase 3. Ground truth for "where does a setting live, who can edit it,
> and which copy wins" across `apps/backoffice` and `apps/pos`. Companion to
> the shared typed dictionary [`packages/supabase/src/settings-keys.ts`](../../packages/supabase/src/settings-keys.ts)
> (source of the category/key list below) and the audit that drove S73's
> settings cleanup: [`docs/workplan/audits/settings-pos-bo-audit.md`](../workplan/audits/settings-pos-bo-audit.md).
> Session plan: [`docs/workplan/plans/2026-07-11-session-73-settings-INDEX.md`](../workplan/plans/2026-07-11-session-73-settings-INDEX.md).

## Two storage layers, one rule

There are exactly two places a "setting" can live:

1. **`business_config`** (singleton row, org-wide) — read via `get_settings_by_category_v1`,
   written via `set_setting_v1`, both gated server-side and audit-logged
   (`audit_logs`, `action='setting.update'`). This is the **authoritative**
   copy: every terminal and the back office read the same row.
2. **`pos:settings`** localStorage (zustand `persist`), per POS terminal —
   `apps/pos/src/stores/posSettingsStore.ts`. No server round-trip, no
   permission gate, no audit trail — by design, because the 3 fields left
   here are hardware/device facts, not business policy (see below).

**Org DB always wins** when a setting could conceptually exist in both
places. As of S73 Lot 2 the only fields still terminal-local are ones that
are local *by nature* — a printer URL only makes sense for the box it's
wired to. Two fields that used to live in `pos:settings` (auto-print,
auto-open-drawer) and two customer-display copy fields were moved to
`business_config` in S73 Lot 2 specifically to remove the "which terminal's
copy is right" ambiguity (`apps/pos/src/features/settings/hooks/useOrgDisplaySettings.ts:1-7`).

## `business_config` keys — category, BO page, permission

| Category | Keys (`SETTING_KEYS`) | BO page | Permission (route / edit) |
|---|---|---|---|
| `business` | `name`, `fiscal_address` | Settings → General (`/backoffice/settings/general`) | `settings.read` / `settings.update` |
| `localization` | `currency`, `timezone` | Settings → General | `settings.read` / `settings.update` |
| `tax` | `tax_rate`, `tax_inclusive` | Settings → General | `settings.read` / `settings.update` |
| `pos` | `shift_variance_threshold_pct`, `shift_variance_threshold_abs`, `shift_variance_pin_threshold_pct`, `shift_variance_pin_threshold_abs`, `shift_denomination_count_enabled` | Settings → General (Caisse section) | `settings.read` / `settings.update` |
| `pos_presets` | `pos_quick_payment_amounts`, `pos_opening_cash_presets`, `pos_discount_presets` | Settings → POS Configuration (`/backoffice/settings/pos`) **and** POS Settings → POS tab → General sub-tab (`apps/pos/src/features/settings/POSSettingsPage.tsx:75,142`) | `settings.read` / `settings.update` |
| `inventory` | `allow_negative_stock` | Settings → Inventory Config (`/backoffice/settings/inventory`) | `settings.read` / `settings.update` |
| `payments` | `enabled_payment_methods` | Settings → Payment Methods (`/backoffice/settings/payment-methods`) | `settings.read` / `settings.update` |
| `customer_display` | `display_footer_message`, `display_slogan` | Settings → Customer Display (`/backoffice/settings/customer-display`) **and** POS Settings → Customer Display tab (`DisplaySettingsTab`, via `useOrgDisplaySettings`/`useSetOrgDisplaySetting`) | `settings.read` / `settings.update` |
| `printing` | `pos_auto_print_receipt`, `pos_auto_open_drawer` | Settings → Printing (`/backoffice/settings/printing`) **and** POS Settings → Printing tab (`PrintingSettingsTab`, via `useOrgDisplaySettings`/`useSetOrgDisplaySetting`) | `settings.read` / `settings.update` |

Two POS surfaces read `business_config` **read-only**, without a matching
BO write UI here because the write UI lives elsewhere (General page owns
`tax`; Payment Methods page owns `payments`):
`useTaxRate.ts` (`tax_rate`) and `useEnabledPaymentMethods.ts`
(`enabled_payment_methods`).

Every BO settings route is gated `settings.read` at the route level
(`apps/backoffice/src/routes/index.tsx:886-933`); the in-page `canEdit`
check is `settings.update` (e.g. `SettingsGeneralPage.tsx`, `SettingsInventoryPage.tsx`,
`SettingsPaymentMethodsPage.tsx`). The POS Settings page applies the same
`settings.update` gate to decide `readOnly` for every tab
(`apps/pos/src/features/settings/POSSettingsPage.tsx:47`).

## Settings outside `business_config`

Two more BO settings pages edit different tables and use **different**
permissions than the `settings.update` default — they are out of scope for
`SETTING_KEYS` (a different RPC surface) but are part of the same "Settings"
hub:

| Page | Table / RPC | Route permission | Edit permission |
|---|---|---|---|
| Notifications (`/backoffice/settings/notifications`) | `notification_templates`, consumed by `enqueue_notification_v1` | `settings.read` | `notifications.send` (`SettingsNotificationsPage.tsx:8,177`) |
| Security & PIN (`/backoffice/settings/security`) | `roles.session_timeout_minutes`, written via `update_role_session_timeout_v1` | `settings.security.manage` (`routes/index.tsx:977`) | `settings.update` in-page (`SecuritySettingsPage.tsx:30`) |

## Terminal-local settings (`pos:settings`, localStorage)

`apps/pos/src/stores/posSettingsStore.ts:22-37` — no BO surface, no
permission gate, per-device only:

| Field | Edited from | Consumed by |
|---|---|---|
| `printerUrl` | POS Settings → Printing tab (`PrintingSettingsTab.tsx`), Devices tab, Advanced tab | `printService` |
| `deviceCode` | POS Settings → Devices tab (`DevicesSettingsTab.tsx`) | `useLanHeartbeat` (this terminal's `lan_devices.code`) |
| `defaultOrderType` | POS Settings → Behavior tab (`BehaviorSettingsTab.tsx`) | `cartStore` (order type a fresh cart starts on) |

Every group in the POS Settings UI now carries an explicit `ScopeBadge`
(`apps/pos/src/features/settings/components/ScopeBadge.tsx`) — "Établissement"
(gold, DB-backed, shared) vs "Ce terminal" (localStorage, this device only)
— so an operator can tell at a glance which copy they're editing.

## Who primes

**Org DB is authoritative for every business setting.** The only settings
left in terminal localStorage are hardware/device facts that have no
meaningful "org" value (a print server URL, a LAN device code, which order
type a blank cart defaults to) — there is nothing to reconcile because
these fields were never duplicated server-side. If a future setting needs
to be edited from the POS AND shared across terminals, it belongs in
`business_config` via `set_setting_v1`, not in `pos:settings`.
