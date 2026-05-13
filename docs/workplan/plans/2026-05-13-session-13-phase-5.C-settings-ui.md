# Session 13 — Phase 5.C — Settings UI + holidays/templates

**Date opened:** 2026-05-14
**Owner subagent:** `settings-ui`
**Scope tag:** `feat(settings)`
**Complexity:** M (~14-18h)
**Branch:** `swarm/session-13`
**Migration block reserved:** `20260517000190..000192` (3 migrations).

## Goal

Wire up the Settings module (#19). Implement:
1. `get_settings_by_category_v1` (phantom RPC D2 from decision pack) + `set_setting_v1` (audit-aware).
2. `holidays` table + seed 2026 Indonesian public holidays.
3. `email_templates` + `receipt_templates` tables + seeds (4 email, 1 receipt).
4. BO pages: General / Holidays / Email Templates / Receipt Templates / Permissions (read-only).

## Schema reality (confirmed via `list_tables`)

- **`business_config` IS the singleton** (smallint PK = 1). No KV `app_settings` table exists.
  Columns: `name, currency, tax_rate, tax_inclusive, fiscal_address, timezone,
  shift_variance_threshold_pct, shift_variance_threshold_abs`.
- `audit_logs.entity_id` is **UUID** (not TEXT). Setting keys cannot fit in `entity_id` directly
  → store the symbolic key in `metadata.key` and leave `entity_id = NULL`.
  Per Wave 3.C deviation D-W3-3C-04 and `Cumulative learning #6`, we keep
  `entity_type='setting'`, `actor_id=auth.uid()`, and `metadata={ key, category, old, new }`.

## Approach

### `get_settings_by_category_v1(p_category TEXT) RETURNS jsonb`
Partition the singleton columns by symbolic category:
- `business`     → `name`, `fiscal_address`
- `localization` → `currency`, `timezone`
- `tax`          → `tax_rate`, `tax_inclusive`
- `pos`          → `shift_variance_threshold_pct`, `shift_variance_threshold_abs`

Returns `{ category, settings: { key: value, ... } }`. Empty object for unknown
categories rather than RAISE so the UI can render an empty section without crashing.

Gate: `has_permission(auth.uid(), 'settings.read')` (MANAGER+).

### `set_setting_v1(p_key TEXT, p_value JSONB, p_category TEXT) RETURNS void`
SECURITY DEFINER. Resolves `p_key` → `business_config` column update via a CASE
whitelist (8 known keys). Reads OLD before UPDATE, INSERTs an `audit_logs` row
with `entity_type='setting'`, `entity_id=NULL`, `metadata={ key, category, old, new }`.

Gate: `has_permission(auth.uid(), 'settings.update')` (ADMIN+ via existing seeds).

Validates types per key:
- `name`, `fiscal_address` → text non-null/empty (or NULL allowed for fiscal_address)
- `currency`, `timezone`   → text non-null
- `tax_rate`               → numeric 0..1
- `tax_inclusive`          → boolean
- `shift_variance_threshold_pct` → numeric ≥ 0
- `shift_variance_threshold_abs` → numeric ≥ 0

Unknown key → `RAISE EXCEPTION 'setting_unknown'` with `ERRCODE='22023'`.

### `holidays`
```
id           UUID PK
name         TEXT NOT NULL
date         DATE NOT NULL
type         TEXT NOT NULL CHECK IN ('national','religious','company')
is_recurring BOOLEAN NOT NULL DEFAULT false
notes        TEXT
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at   TIMESTAMPTZ
```
UNIQUE (`date`, `name`) WHERE `deleted_at IS NULL`.

RLS: SELECT auth; INSERT/UPDATE/DELETE require `settings.holidays.manage`.

Seed: 16 Indonesian 2026 public holidays (national + religious).

### `email_templates`
```
id          UUID PK
code        TEXT UNIQUE
subject     TEXT NOT NULL
body_html   TEXT NOT NULL
body_text   TEXT NOT NULL
variables   JSONB NOT NULL DEFAULT '[]'
is_active   BOOLEAN NOT NULL DEFAULT true
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```
RLS: SELECT auth; INSERT/UPDATE/DELETE require `settings.update`.

Seed 4 templates: `welcome`, `order_complete`, `payment_received`, `password_reset`.

### `receipt_templates`
```
id          UUID PK
name        TEXT UNIQUE
header      TEXT
footer      TEXT
paper_size  TEXT NOT NULL CHECK IN ('58mm','80mm','A4')
show_qr     BOOLEAN NOT NULL DEFAULT false
show_logo   BOOLEAN NOT NULL DEFAULT true
custom_css  TEXT
is_default  BOOLEAN NOT NULL DEFAULT false
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```
Partial UNIQUE INDEX enforces at most one `is_default = true`.

Seed: 1 default 80mm template.

## Migrations (3)

1. `20260517000190_create_get_settings_by_category_rpc.sql` — both RPCs.
2. `20260517000191_init_holidays.sql` — table + RLS + 16-row 2026 seed.
3. `20260517000192_init_email_receipt_templates.sql` — both tables + seeds.

## BO surface

Create `apps/backoffice/src/features/settings/`:
- `hooks/useSettings.ts`         — `get_settings_by_category_v1`.
- `hooks/useSetSetting.ts`       — `set_setting_v1`.
- `hooks/useHolidays.ts`         — list / create / update / delete soft.
- `hooks/useEmailTemplates.ts`   — list / upsert.
- `hooks/useReceiptTemplates.ts` — list / upsert.
- `components/*` — forms, modals, preview panels.

Pages:
- `pages/settings/SettingsGeneralPage.tsx`
- `pages/settings/SettingsHolidaysPage.tsx`
- `pages/settings/SettingsEmailTemplatesPage.tsx`
- `pages/settings/SettingsReceiptTemplatesPage.tsx`
- `pages/settings/SettingsPermissionsPage.tsx`  (read-only matrix)

Routing: replace existing `/backoffice/settings` ComingSoon stub with a routed
shell under `/backoffice/settings/{general,holidays,templates/email,templates/receipt,permissions}`.

Sidebar: nest 5 child links under existing `Settings` entry (`indent: 1`).

## Tests

- `supabase/tests/settings.test.sql` (pgTAP) —
  - holidays table exists + 16 seed rows present;
  - email_templates has 4 seeds with non-empty subject/body;
  - receipt_templates has 1 default 80mm row;
  - `get_settings_by_category_v1('business')` returns expected keys;
  - `set_setting_v1` audit row matches `entity_type='setting'` + metadata diff;
  - unknown-key RAISE branch exercised.

- BO smoke tests:
  - `SettingsGeneralPage.smoke.test.tsx`
  - `SettingsHolidaysPage.smoke.test.tsx`
  - `SettingsEmailTemplatesPage.smoke.test.tsx`
  - `SettingsReceiptTemplatesPage.smoke.test.tsx`
  - `SettingsPermissionsPage.smoke.test.tsx`

## DoD

- [ ] 3 migrations applied on `ikcyvlovptebroadgtvd`.
- [ ] `types.generated.ts` regenerated and committed.
- [ ] `pnpm typecheck` green.
- [ ] BO smoke + pgTAP suites green.
- [ ] Routes + sidebar updated.
- [ ] Commits squash-mergeable; Claude co-author.

## Open deviations (allocated, may shift)

- D-W5-5C-01: `audit_logs.entity_id` is UUID — setting key in `metadata.key`.
- D-W5-5C-02: `business_config` is the singleton — no new generic `app_settings` table.
- D-W5-5C-03: Permissions page is **read-only** in 5.C; full RBAC editing deferred to 5.D.
- D-W5-5C-04: `email_templates` here is **distinct** from any `notification_templates`
  that Phase 5.B (notifications) may ship — customer-facing marketing vs system events.
