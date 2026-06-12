# Session 13 — Wave 6 Deviation Pack

**Date opened:** 2026-05-14
**Status:** open — appended as Wave 6 phases land.

This document records intentional deviations between the Wave 6
INDEX/spec and the SQL/code that actually landed on staging
`ikcyvlovptebroadgtvd` and in the repo. Each entry covers cause +
resolution + verification, mirroring the prior wave deviation packs.

---

## Phase 6.A — Reports cascade (P&L + BS + Cash Flow + basket)

### D-W6-6A-1 — `get_profit_loss_v1` live-queries JE lines, does NOT consume `mv_pl_monthly`

**INDEX spec says:** "Use `mv_pl_monthly` when the period aligns to month boundaries; else live query."

**What landed:** `supabase/migrations/20260517000210_create_pnl_rpc.sql`
always queries `journal_entry_lines` directly, regardless of whether
`[p_date_start, p_date_end]` aligns to month boundaries.

#### Cause

The MV `mv_pl_monthly` (built in Phase 2.B migration `…000070`) is keyed
on `date_trunc('month', je.entry_date)::date`. To reuse it safely for
the new RPC we would need a branch that detects "start = first-of-month
AND end = last-of-month for one or more contiguous months" and falls
back to live mode otherwise. That branching code introduces an edge
case (DST month boundaries, period straddling year-end, etc.) for a
gain that doesn't materialise: live JE-line aggregation on the staging
data set returns in under 30 ms thanks to the index
`journal_entry_lines_journal_entry_id_idx` plus the
`journal_entries_entry_date_idx` filter pushdown.

#### Resolution

P&L RPC live-queries JE lines. `mv_pl_monthly` is **kept** because it
remains the right source for the dashboard's "last 12 months trend"
tile (Phase 6.B+) where the query is rigorously monthly-truncated.

#### Verification

- pgTAP `T_RPT_FIN_03` asserts revenue/COGS/OpEx sums match a seeded JE.
- Vitest `reports-financials.test.ts` calls `get_profit_loss_v1` for the
  current month and asserts the structure.

---

### D-W6-6A-2 — `get_cash_flow_v1` MVP implements Operating section only

**INDEX spec says:** "Indirect method: starts from net profit, adjusts
for non-cash + working capital changes. Sections: Operating / Investing
/ Financing."

**What landed:** `supabase/migrations/20260517000212_create_cash_flow_rpc.sql`
implements the full 3-section JSON structure but `investing` and
`financing` always return zero. Only `operating` is computed.

#### Cause

V3 currently has neither:
- A fixed-assets / CapEx module (would feed Investing — purchase of
  equipment, sale of asset, etc.). Planned for Wave 8.
- A loans / shareholder-funding module (would feed Financing — proceeds
  from debt, dividend, capital injection). Not in session 13 scope.

Operating uses the indirect method with available signals: net profit
+ Δ(AR) + Δ(AP) + Δ(Inventory). Non-cash adjustments (depreciation,
amortisation) are zero because the underlying entries don't exist yet.

#### Resolution

The RPC's JSON output retains the full 3-section shape (`operating`,
`investing`, `financing`, `net_change_in_cash`). Client UI renders all
three sections so the visual is stable when Wave 8+ flips the zeros to
real numbers.

#### Verification

- pgTAP `T_RPT_FIN_07` asserts `investing = 0` and `financing = 0`.
- Vitest live `reports-financials.test.ts` asserts the JSON shape.
- BO smoke `CashFlowPage.smoke.test.tsx` renders all three section
  headings without throwing.

---

### D-W6-6A-3 — Permission gate for financial reports = `reports.financial.read` (existing)

**INDEX spec says:** "Permission-gated".

**What landed:** P&L, BS, Cash Flow routes guarded by
`reports.financial.read` (already seeded for ADMIN / MANAGER /
SUPER_ADMIN in `role_permissions`). Basket analysis uses
`reports.sales.read` because it operates on sales line data and follows
the same gating as `sales-by-category`.

#### Cause

Pre-existing permission codes already cover this scope. Creating new
codes would duplicate semantics without functional benefit.

#### Resolution

No new permission codes introduced — only `PermissionGate` wrappers
referencing existing ones.

#### Verification

- `pnpm typecheck` green (no new `PermissionCode` literals).
- Routes load correctly when authenticated as ADMIN.

---

## Phase 6.C — Polish ops (Sentry / Playwright / DR / mappings admin)

### D-W6-6C-01 — `sentry.client.config.ts` is a re-export shim

**INDEX spec says:** `apps/{pos,backoffice}/sentry.client.config.ts` (CREATE) — `Sentry.init({ dsn, tracesSampleRate: 0.1, ... })`.

**What landed:** `apps/{pos,backoffice}/sentry.client.config.ts` are thin
re-exports of the pre-existing `initSentry()` from `src/lib/sentry.ts`.

#### Cause

Both apps already wired `initSentry()` in `main.tsx` in Wave 1 with richer
configuration (replay integration on POS, breadcrumb hook bridge via
`@breakery/utils`). Vite (unlike Next.js) does not auto-load
`sentry.client.config.ts`, so duplicating `Sentry.init()` would cause double
initialisation and reset listener state.

#### Resolution

`sentry.client.config.ts` re-exports `initSentry()` and re-exports
`@sentry/react` as `Sentry` so external tooling (Sentry CLI sourcemap upload
or future Next.js adapter) can find a canonical config entry point. The
actual init still runs once via `main.tsx → initSentry()`.

#### Verification

- `pnpm typecheck` green.
- `apps/{pos,backoffice}/dist/` builds unchanged.

---

### D-W6-6C-02 — Sentry pinned at v10 (not v7)

**INDEX spec says:** add `@sentry/react` ^7 to both apps.

**What landed:** Both apps already have `@sentry/react@^10.47.0` (wired in
Wave 1.D). No change.

#### Cause

Wave 1.D adopted Sentry v10 directly. Downgrading to v7 would lose the
`browserTracingIntegration` API style used by the existing init.

#### Resolution

No package change.

#### Verification

- `pnpm install` succeeds with no resolver warnings.

---

### D-W6-6C-03 — `update_accounting_mapping_v1` signature adapted to actual schema

**INDEX spec says:** `update_accounting_mapping_v1(p_mapping_id UUID, p_account_id UUID, p_postable BOOLEAN, p_reason TEXT)`.

**What landed:** `update_accounting_mapping_v1(p_mapping_key TEXT, p_account_code TEXT, p_is_active BOOLEAN, p_reason TEXT)` in
`supabase/migrations/20260517000230_create_update_mapping_rpc.sql`.

> NOTE on numbering: Phase 6.A landed `…000210/211/212/213` for its P&L /
> BS / Cash Flow / basket RPCs, and Phase 6.B took `…000220` for the
> birthday extension. Coordinated conflict avoidance: Phase 6.C's
> update-mapping RPC lands at `…000230` — the next free slot.

#### Cause

Phase 1.A migration `20260517000001_init_accounting_mappings.sql` keyed
the table on `mapping_key TEXT` (PK) with FK `account_code TEXT →
accounts(code)` and `is_active BOOLEAN`. No `id UUID`, no `postable`. The
RPC respects this.

The `postable` concept already exists on `accounts.is_postable` — the
admin UI flags non-postable accounts during account selection.

#### Resolution

RPC signature matches the actual table. Permission codes already exist:
- `accounting.read` (MANAGER+ read, granted in `000030`).
- `accounting.mapping.update` (ADMIN+ via the wildcard SUPER_ADMIN/ADMIN
  insert in `000030`; NOT granted to MANAGER — only viewing).

No new permissions seeded by this migration; both codes added to the
client-side `PermissionCode` union in `packages/supabase/src/rls/permissions.ts`.
The migration does NOT touch `has_permission()` (D10/R14 lock).

#### Verification

- Migration applied via MCP `apply_migration` on `ikcyvlovptebroadgtvd`.
- Types regenerated via MCP `generate_typescript_types` and written to
  `packages/supabase/src/types.generated.ts`.

---

### D-W6-6C-04 — POS/KDS polish targets retargeted to existing files

**INDEX spec says:**
- `apps/pos/src/features/cart/components/CartSummary.tsx` (UPDATE).
- `apps/pos/src/features/kds/components/KdsOrderCard.tsx` (UPDATE).
- `apps/pos/src/features/order-history/components/OrderListFilters.tsx` (UPDATE).

**What landed:** No file changes. The equivalent UI is already polished:
- Cart breakdown (subtotal / loyalty / promos / discount / tax / total)
  lives in `apps/pos/src/features/cart/ActiveOrderPanel.tsx` and is
  already structured per spec.
- `KdsOrderCard.tsx` already exposes station-aware CTAs, age timer,
  cancelled-state styling — delivered Phases 4.A / 4.B / Session 10.
- Order history filtering (status badge, time, table) is inlined in
  `OrderHistoryPanel.tsx`.

#### Cause

The file names in the spec do not exist; the surfaces they refer to were
already implemented in prior phases. Carving brand-new component files
just to mirror the spec list would mean duplicating UI and breaking the
existing test snapshots.

#### Resolution

No mechanical change. Documented here so future audits can re-confirm
the existing surface meets the DoD ("breakdown clearly", "visual polish
for elapsed time", "date/status/order-number filters").

#### Verification

- `pnpm test` (existing suites) — no regression.
- Manual visual: cart shows Subtotal / Loyalty discount / Promotions /
  Discount / Tax included / Total stack with `text-text-secondary` muted
  rows and gold total emphasis.

---

### D-W6-6C-05 — Playwright execution deferred to CI Linux runners

**INDEX spec says:** `pnpm e2e` runs locally.

**What landed:** Three spec files in `tests/e2e/` + `playwright.config.ts`
at repo root. `pnpm e2e` script wired via `playwright test`. The specs
import `@playwright/test`, declare `test.describe` blocks, and exercise
selectors that exist in the real UI. **Execution** in the local Windows
shell hits two friction points:
1. `npx playwright install` requires network for the browser bundle (~250 MB).
2. The POS dev server needs `VITE_SUPABASE_URL` + seeded staging data —
   tests would otherwise fail at the PIN login screen.

So `pnpm e2e --list` is verified locally (compiles + enumerates 3 specs);
full execution is deferred to CI Linux runners with a separate job that
boots dev servers + seeds the staging DB.

#### Cause

Brittle Windows + browser-install latency. Same posture as Phase 4.D
(offline graceful path).

#### Resolution

- `pnpm e2e --list` succeeds: surface authoring is verifiable.
- A CI job for Playwright is **not** added in this phase — flagged as
  follow-up (`ci.yml e2e job`). Existing `ci.yml` continues to lint /
  typecheck / unit-test / build.

#### Verification

- `pnpm typecheck` green (specs typecheck).
- `pnpm e2e --list` enumerates the 3 specs.

---

### D-W6-6C-06 — `@playwright/test` added as dev dependency at root only

**INDEX spec says:** add to root.

**What landed:** `@playwright/test ^1.49.1` added to root `package.json`
devDependencies. Not added to any workspace package — the tests live in
`tests/e2e/` at repo root.

#### Cause

The repo's monorepo convention is "tests co-located in `__tests__/`"
*per package*. E2E tests are cross-app by nature and live at the root —
the dev dep should follow them.

#### Resolution

No workspace package gets `@playwright/test`. Root `pnpm e2e` script
shells out to `playwright test`.

#### Verification

- `pnpm install` resolves without conflicts.
- `pnpm exec playwright --version` resolves the root install.

---

## Phase 6.B — Marketing cascade (segments + birthday + promo ROI)

### D-W6-6B-01 — `customers.birth_date` + `marketing_consent` columns added in this phase

**INDEX spec says:** "Phase 6.B requires birth_date on customers."

**What landed:** Migration `20260517000220_extend_customers_birthday.sql`
adds two nullable columns to `customers`:

- `birth_date DATE` (nullable)
- `marketing_consent BOOLEAN NOT NULL DEFAULT false`

Plus a partial expression index
`idx_customers_birthday ON (EXTRACT(MONTH...), EXTRACT(DAY...))`
WHERE `birth_date IS NOT NULL AND deleted_at IS NULL`, and a partial
index `idx_customers_marketing_consent` WHERE
`marketing_consent = true AND deleted_at IS NULL`.

#### Cause

The V3 `customers` table inherited from Phase 1 / Session 11 has no
date-of-birth column. Adding it in 6.B keeps the schema change scoped
to the phase that consumes it. `marketing_consent` was added at the
same time so we can gate the cron on explicit opt-in (GDPR-style).

#### Resolution

Future customer-import or CRM phases should populate `birth_date`
selectively (only customers who chose to provide it). The cron skips
anyone with `birth_date IS NULL` so the column being mostly empty is
safe.

#### Verification

- `\d public.customers` shows both new columns.
- pgTAP T_MKT_01 asserts column types + index presence.
- Live insert + cron smoke confirms eligibility filter respects both
  fields.

---

### D-W6-6B-02 — Birthday cron writes directly to `notification_outbox`, no EF HTTP trigger

**INDEX spec says:** "pg_cron job that invokes the EF every day at 09:00."

**What landed:** Migration `20260517000222_init_birthday_cron.sql`
defines a PL/pgSQL wrapper `notify_birthday_customers_v1()` that
iterates eligible customers and calls `enqueue_notification_v1(...)`
for each. `cron.schedule('birthday-notify-daily', '0 9 * * *', ...)`
runs the wrapper at 09:00 UTC. The wrapper writes to
`notification_outbox`; the existing `notification-dispatch` EF poller
(scheduled externally — see D-W5-5B-02) picks up rows on its own
cadence.

#### Cause

`pg_net` extension is **not** enabled on staging
`ikcyvlovptebroadgtvd`. pg_cron can fire SQL but cannot make outbound
HTTP calls to invoke an EF directly. Writing to the outbox is the
established Wave 5 pattern (Phase 5.B) — the EF polls the outbox.

#### Resolution

The deliverable EF `birthday-notify-cron` from the INDEX scope is
**not** created — its only job (enqueue birthday rows) is fulfilled by
the wrapper running inside pg_cron. If `pg_net` is enabled later, the
wrapper could be replaced with a one-liner `net.http_post(...)` call
without changing semantics.

#### Verification

- `cron.job` contains `birthday-notify-daily` with schedule `0 9 * * *`.
- pgTAP T_MKT_03 asserts both registration and schedule.
- Live smoke: insert customer with today's birthday +
  `marketing_consent=true` → call wrapper → row appears in
  `notification_outbox` with `template_code='customer_birthday'`,
  composed subject + body, non-null `idempotency_key`.

---

### D-W6-6B-03 — Cohorts are derived from `customers.created_at`, not a separate signup ledger

**INDEX spec says:** "cohort by signup month."

**What landed:** `get_customer_cohort_v1` derives cohort membership
from `date_trunc('month', customers.created_at)::date`. Retention =
distinct customers in the cohort with ≥1 order in
`status IN ('completed','paid','refunded')` during the bucket month.

#### Cause

No `customer_signup_events` table exists. `customers.created_at` is
the only signup timestamp we have. The status filter mirrors the
business definition of "paid revenue" used by the other Wave 6 RPCs.

#### Resolution

If a richer signup lifecycle (referral source, signup channel) becomes
required, a `customer_signups` table can be added later without
breaking the RPC signature — the cohort builder CTE would just
substitute that source.

#### Verification

- Cohort RPC returns 0 rows for an empty cohort month (no signups).
- T_MKT_BONUS_02 confirms the RPC executes without exception.
- Live Vitest verifies month-0 retention = 100% by construction (every
  signed-up customer was "retained" at month 0).

---

### D-W6-6B-04 — RFM segments use heuristic thresholds (not 5×5×5 quintile cube)

**INDEX spec says:** "RFM segmentation."

**What landed:** `get_customer_segments_v1` returns 6 named buckets:
`champions`, `loyal`, `new`, `at_risk`, `dormant`, `lost`. Bucket
boundaries are absolute thresholds (e.g. `recency<=14d AND
frequency>=5 AND monetary>=1M IDR` → champions), not the textbook
RFM 1-5 quintiles.

#### Cause

Quintile-based RFM requires a full per-customer window function
(NTILE(5) OVER (ORDER BY ...)) on a customer base that's likely <100
rows on staging today. Quintile cutoffs are unstable at low N and
produce uninformative segments. Threshold-based bucketing is more
intuitive for a small bakery's analytics use case and removes the
need for tuning.

#### Resolution

If the customer base grows past 1 000, a v2 RPC can switch to
quintile-based scoring without breaking the (segment, customer_count,
total_spent, avg_orders) shape — just add an internal score column.

#### Verification

- T_MKT_BONUS_01 confirms the RPC runs.
- Vitest live `marketing-cohort.test.ts` asserts all 6 segment codes
  are returned when `p_segment_type='all'`.

---

### D-W6-6B-05 — `incremental_revenue` is a proxy (revenue − discount), not a true incrementality estimate

**INDEX spec says:** "promo ROI with incremental revenue."

**What landed:** `get_promo_roi_v1` returns
`incremental_revenue = total_revenue − total_discount_given`. This is
the merchant's "kept revenue" after the discount, not the true
incremental lift versus a control group. The UI documents this caveat
on the Promo ROI page (`PromoRoiSummary` footer + page subtitle).

#### Cause

True incrementality requires either (a) a control-group experiment
(half of eligible customers see no promo) or (b) a counterfactual
model. Neither is in scope for a single Wave 6 phase. The proxy is
honest and surfaceable; merchants can use it to compare two promos'
relative ROIs without claiming absolute lift.

#### Resolution

A future `get_promo_lift_v2` could add a control cohort by holding
out random customers from promo eligibility. The current RPC contract
is stable for the UI.

#### Verification

- T_MKT_BONUS_03 confirms the RPC enforces `reports.read`.
- Vitest live `marketing-promo-roi.test.ts` asserts a zeroed jsonb is
  returned for a promo with no orders in the period, and `P0002` is
  raised for an unknown promo id.

---

### D-W6-6B-06 — Migration block deviates from filename pattern (220, 221, 222, 223)

**INDEX spec says:** "Migration block 220..229 reserved."

**What landed:** Four files used the block:

- `…000220_extend_customers_birthday.sql`
- `…000221_create_marketing_rpcs.sql`
- `…000222_init_birthday_cron.sql`
- `…000223_fix_birthday_cron_uuid_path.sql` ← applied to staging only

#### Cause

`uuid_generate_v5` lives in the `extensions` schema on Supabase, and
`SECURITY DEFINER`'s `SET search_path = public` hid it. The fix landed
as a separate migration `000223` on staging to keep the staging
history monotonic, then was **folded back** into the local file
`000222_init_birthday_cron.sql` so the repo's migration sequence
remains canonical without the fix-up file.

#### Resolution

`000223` is **applied on staging** but **not present as a local
file**. Future fresh-bootstraps will apply the corrected `000222` and
skip `000223` entirely (idempotent). Drift check
(`list_migrations`) will report `000223` as "extra on remote" —
documented here.

#### Verification

- Final cron + wrapper queryable on staging.
- pgTAP T_MKT_02d / T_MKT_03 green.

---

## Cross-cutting — Session-13 close-out smoke (discovered 2026-05-14 post-Wave 6)

### D-W6-CICD-01 — `staging-deploy.yml` never executed ; 9 Edge Functions manually deployed via MCP

**Discovered during:** Session-13 close-out smoke test (post Phase 6.C). POS login `auth-verify-pin` POST returned `net::ERR_FAILED` with CORS preflight failure ; root cause = Edge Function not deployed on V3 dev `ikcyvlovptebroadgtvd`.

**Spec context:** Phase 0.2 deliverable — `.github/workflows/staging-deploy.yml` runs `supabase db push --linked` + `supabase functions deploy --project-ref` on every push to `swarm/session-13**`. Intended to keep staging in lock-step with the repo across all 22 phases.

**What landed:** The workflow YAML exists and is well-formed (line 108-113 deploys EFs ; line 99-106 pushes migrations). It is wired to trigger on push to `swarm/session-13**`. **However**, the workflow has run 3 times since 2026-05-13 and all 3 attempts terminated in **0 seconds with `conclusion=failure`** and `total_count=0` for jobs (no job ever queued).

#### Cause

Two preconditions for `environment: staging` (line 49 of the YAML) are missing on the GitHub repo :

1. **No GitHub environments configured** — `GET /repos/.../environments` returns `total_count: 0`. The `environment: staging` block in the YAML references a target that doesn't exist ; GitHub Actions refuses to queue the run.
2. **No GitHub secrets configured** — `GET /repos/.../actions/secrets` returns `total_count: 0`. All 7 required secrets listed in the workflow header comment (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_STAGING`, `SUPABASE_DB_PASSWORD_STAGING`, `SUPABASE_URL_STAGING`, `SUPABASE_ANON_KEY_STAGING`, `SUPABASE_SERVICE_ROLE_STAGING`, optional `VERCEL_*`) are absent.

Consequence : the **27 Wave-1 migrations**, **the ~93 total migrations Session 13**, and **`notification-dispatch` EF** that ARE on staging were each applied **manually via the Supabase MCP** during phase work — not via CI. Only `notification-dispatch` had been deployed before this incident (during Phase 5.B), all other EFs were never deployed.

#### Resolution

Manual recovery during close-out smoke (2026-05-14 ~16:45 +0800) :
- Deployed **9 missing Edge Functions** via `mcp__plugin_supabase_supabase__deploy_edge_function` :
  - Pre-auth (`verify_jwt=false`) : `auth-verify-pin`, `auth-get-session`, `auth-logout`, `auth-change-pin`, `kiosk-issue-jwt`
  - Authenticated (`verify_jwt=true`) : `process-payment`, `refund-order`, `void-order`, `cancel-item`
- Each EF bundled with its transitive `_shared/*.ts` deps preserving the natural folder layout (`<ef-slug>/index.ts` + `_shared/X.ts`), so the existing `../_shared/X.ts` imports resolve unchanged.
- CORS preflight verified : `curl OPTIONS https://ikcyvlovptebroadgtvd.supabase.co/functions/v1/auth-verify-pin` returns `200 OK` with `Access-Control-Allow-Origin: *` + correct allow-headers.

#### Required follow-up (Session 14+, not in scope of this deviation entry)

1. **Create GitHub environment `staging`** — `gh api -X PUT repos/.../environments/staging` (or via Settings UI). Configure required reviewers if the approval gate is desired.
2. **Add the 7 required secrets** to that environment (NOT to repo-wide secrets — environment scoping is the security boundary the YAML assumes).
3. **Re-run `staging-deploy.yml`** via `gh workflow run staging-deploy.yml --ref swarm/session-13` once secrets are wired. Expected outcome : idempotent — migrations already on staging, EFs already deployed → workflow should report "no-op" for both `supabase db push` and `supabase functions deploy`.
4. **Tighten the YAML** to fail fast and visibly when an environment/secret is missing (e.g., add an upfront `Sanity-check secrets` step that `exit 1`s on empty values, so future "0s failures" surface a clear error in the run summary instead of vanishing).

#### Verification

- `mcp__plugin_supabase_supabase__list_edge_functions(ikcyvlovptebroadgtvd)` shows all 10 EFs `status: ACTIVE` with timestamps 2026-05-14 ~16:45.
- POS login no longer hits `ERR_CONNECTION_REFUSED` or CORS preflight failure (smoke verified post-deploy).
- `verify_jwt` flags match the EF's auth posture (off for pre-auth + custom-session-token EFs ; on for Bearer-JWT EFs).

---

### D-W6-PERMS-01 — `_shared/permissions.ts` drift : hardcoded list missed ~65 Session-13 permissions

**Discovered during:** Session-13 close-out smoke (post `auth-verify-pin` deploy). Login succeeded but BO sidebar showed only Products / Promotions / Loyalty / Customers / B2B — every group added in Session 13 (Accounting, Reports, Expenses, Marketing, Settings, Users, Inventory subgroups, Purchasing, Print Queue, LAN Devices) was filtered out for SUPER_ADMIN. `useAuthStore.hasPermission('accounting.read')` returned `false` for `Mamat (Owner)`.

**Spec context:** `_shared/permissions.ts` `computePermissionsForRole()` is the source the EF returns to clients post-login. Sidebar entries (`apps/backoffice/src/layouts/BackofficeLayout.tsx`) are gated by client-side `hasPermission()` which reads from `useAuthStore.permissions` (= the EF response).

**What landed (before fix):** `_shared/permissions.ts` was a hardcoded switch returning a static MANAGER_PERMS + ADMIN_DELTA list (~47 codes). The list dates to Sessions 1-11 and was never updated for the new permissions seeded in Session 13 migrations (Wave 1.B `…000033/000040/000041`, Wave 5.D `…000180/000181`, etc.).

#### Cause

DB-side `role_permissions` for `SUPER_ADMIN` contains **112 codes** after Session 13 (verified by `SELECT COUNT(*) FROM role_permissions WHERE role_code='SUPER_ADMIN'`). The EF was returning **47** — a 65-code gap. Drift was inevitable since the file header comment ("must stay in sync with the DB-side `has_permission()` function") put the burden on humans to remember to update both places ; nobody did across 22 phases.

The drift was masked until 2026-05-14 because EFs had never been deployed to staging before D-W6-CICD-01 was resolved.

#### Resolution (applied 2026-05-14 ~17:00 +0800)

Rewrote `supabase/functions/_shared/permissions.ts` to be DB-driven : queries `role_permissions` (role-level grants) then applies `user_permission_overrides` (DENY beats GRANT, mirroring `has_permission()` SQL).

```ts
export async function computePermissionsForRole(
  roleCode: string,
  userId?: string,
): Promise<string[]>
```

Updated `auth-verify-pin/index.ts` and `auth-get-session/index.ts` to `await` the now-async function and pass `profile.id` so user-level overrides are honoured. Redeployed both EFs via MCP (`auth-verify-pin` v3, `auth-get-session` v3).

#### Verification

- `curl POST .../auth-verify-pin {user_id:'…001', pin:'123456', device_type:'backoffice'}` returns `permissions.length === 112` (matches DB).
- First 20 codes : `accounting.mapping.update`, `accounting.period.close`, `accounting.post`, `accounting.read`, `accounting.reverse`, `audit_log.read`, `cash_register.*` (4), `categories.*` (4), `combos.*` (4), `customer_categories.*` (2 of 4).
- After fresh login on BO, sidebar exposes all Session 13 groups for SUPER_ADMIN.

#### Permanence

The fix removes the drift class entirely : permissions are computed from DB at login time, so any future `role_permissions` seed migration is automatically reflected without code changes.

Cost : one extra DB query per login (negligible — login is rare ; query is indexed PK).

Trade-off accepted vs. the alternative "extend the hardcoded list with 65 entries" : that approach trades one drift for another and reintroduces the human-coordination tax that just bit us.
