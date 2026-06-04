# Session 13 — Phase 6.B — Marketing cascade (segments + birthday + promo ROI)

**Date:** 2026-05-14
**Branch:** `swarm/session-13`
**Wave:** 6
**Complexity:** M (~14-18h)
**Migration block reserved:** `20260517000220..000229`

## Scope

Deliver three slim marketing surfaces backed by SQL RPCs + one pg_cron
job, so the backoffice can run cohort / RFM segment / promotion-ROI
reports and trigger daily birthday notifications.

The three RPCs (`get_customer_cohort_v1`, `get_customer_segments_v1`,
`get_promo_roi_v1`) consume Wave 1-5 data (`orders`, `order_items`,
`customers`, `promotion_applications`) without new aggregates.

Birthday flow piggybacks on the **Phase 5.B notifications pipeline**
(template `customer_birthday`, RPC `enqueue_notification_v1`, EF
`notification-dispatch` already deployed). pg_cron is present on the
project but **pg_net is NOT** — therefore the daily birthday job
**writes directly to `notification_outbox` via `enqueue_notification_v1`**
(no HTTP call from DB). The EF poller `notification-dispatch` (already
scheduled externally) consumes the row and ships the email via Resend.

## Decisions

- **D-W6-6B-01 — `customers.birth_date` added in this phase.** The V3
  `customers` table has no birth column. We add a nullable `DATE birth_date`
  + nullable `BOOLEAN marketing_consent DEFAULT false`, plus a partial
  expression index `(EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date))`
  so the cron can scan O(today's-birthday-rows) instead of full table.
- **D-W6-6B-02 — Birthday cron writes to outbox (not HTTP).** pg_net is
  not enabled on staging. The cron job `birthday-notify-daily` calls a
  PL/pgSQL wrapper `notify_birthday_customers_v1()` which iterates
  matching customers and invokes `enqueue_notification_v1`. The existing
  `notification-dispatch` EF picks up rows on its own polling cadence.
  This removes the EF `birthday-notify-cron` from the deliverable
  surface — the scope's EF requirement is satisfied by direct outbox
  insert (D-W5-5B-02 precedent).
- **D-W6-6B-03 — Cohort by signup month via `customers.created_at`.** No
  separate signup table exists. Cohorts = monthly buckets of
  `date_trunc('month', customers.created_at)`. Retention = customers
  with ≥1 paid order in month N+k. Revenue = sum(orders.total) for
  paid orders in month N+k. Lookback default = 12 months.
- **D-W6-6B-04 — RFM segment buckets are heuristic quintiles.** Recency
  (days since last order), Frequency (paid orders 90d), Monetary (sum
  paid 90d). Segments returned: `champions`, `loyal`, `at_risk`,
  `new`, `lost`, `dormant` — assigned by simple R/F/M thresholds rather
  than a full 1-5 quintile matrix (smaller surface, easier to test).
- **D-W6-6B-05 — Promo ROI `incremental_revenue` proxy.** True
  incrementality requires control-group experiments. We expose
  `total_revenue_with_promo` (sum `orders.total` for orders that hit
  the promo) and `total_discount_given` (sum
  `promotion_applications.amount`); `incremental_revenue` is computed
  as `total_revenue_with_promo - total_discount_given` (i.e. revenue
  the merchant kept). `estimated_cost = total_discount_given`. `roi_pct
  = (incremental_revenue - estimated_cost) / nullif(estimated_cost, 0)
  * 100`. Documented as proxy on the page.
- **D-W6-6B-06 — Only D-W6-6B-02 deviates from the INDEX surface.** All
  other items match the Phase 6.B scope.

## File map

```
supabase/migrations/
  20260517000220_extend_customers_birthday.sql   # birth_date + marketing_consent + index
  20260517000221_create_marketing_rpcs.sql       # 3 RPCs (cohort, segments, promo_roi)
  20260517000222_init_birthday_cron.sql          # wrapper fn + cron.schedule
supabase/tests/
  marketing.test.sql                              # pgTAP T_MKT_01..08
  functions/marketing-cohort.test.ts              # vitest live
  functions/marketing-promo-roi.test.ts           # vitest live
apps/backoffice/src/features/marketing/
  hooks/useCustomerCohorts.ts
  hooks/useCustomerSegments.ts
  hooks/usePromoRoi.ts
  hooks/useBirthdayCustomers.ts
  components/CohortHeatmap.tsx
  components/SegmentList.tsx
  components/PromoRoiSummary.tsx
  components/BirthdayList.tsx
  __tests__/CohortHeatmap.smoke.test.tsx
apps/backoffice/src/pages/marketing/
  CohortReportPage.tsx
  SegmentsPage.tsx
  PromoRoiPage.tsx
  BirthdayPage.tsx
apps/backoffice/src/routes/index.tsx               # add 4 routes
apps/backoffice/src/layouts/BackofficeLayout.tsx   # Marketing group nav
docs/workplan/refs/2026-05-14-session-13-wave-6-deviations.md  # append
```

## TDD plan

1. **Migration 000220** — add columns + index. Smoke via
   `execute_sql` (`SELECT column_name FROM information_schema.columns
   WHERE table_name='customers' AND column_name='birth_date'`).
2. **Migration 000221** — three RPCs (`get_customer_cohort_v1`,
   `get_customer_segments_v1`, `get_promo_roi_v1`). Smoke via direct
   RPC call with no data → returns empty rows / zeroed jsonb.
3. **Migration 000222** — wrapper fn `notify_birthday_customers_v1()`
   + `cron.schedule('birthday-notify-daily', '0 9 * * *', ...)`. Smoke
   by calling the wrapper directly with a seeded birthday customer +
   asserting `notification_outbox` row appears.
4. **pgTAP** `marketing.test.sql` :
   - T_MKT_01 schema (birth_date col, marketing_consent col, index).
   - T_MKT_02 cohort RPC returns retention=0/empty when no orders.
   - T_MKT_03 cohort RPC respects lookback.
   - T_MKT_04 segments RPC returns champions/at_risk thresholds.
   - T_MKT_05 promo ROI returns zero jsonb for unused promo.
   - T_MKT_06 wrapper fn enqueues N rows for N birthday customers.
   - T_MKT_07 wrapper fn skips customers with `marketing_consent=false`.
   - T_MKT_08 cron schedule registered with name `birthday-notify-daily`.
5. **Vitest live** :
   - `marketing-cohort.test.ts` — seed 2 cohort months + assert rows.
   - `marketing-promo-roi.test.ts` — seed promo + 2 paid orders + assert ROI.
6. **BO smoke** — `CohortHeatmap.smoke.test.tsx` renders with mock data
   without crashing.
7. **Types regen** — final `generate_typescript_types` → commit.

## Acceptance

- 3 migrations applied + types regen committed.
- `pnpm typecheck` green (filter @breakery/supabase + backoffice).
- Targeted Vitest filter green
  (`pnpm --filter @breakery/backoffice test marketing`).
- pgTAP file passes when run via execute_sql wrap (`SELECT * FROM
  finish()` returns no failures).
- Backoffice nav shows Marketing > {Cohorts, Segments, Promo ROI,
  Birthdays}.

## Commit plan

- `feat(db): session 13 — phase 6.B — customers.birth_date + marketing_consent`
- `feat(db): session 13 — phase 6.B — marketing RPCs (cohort/segments/promo_roi)`
- `feat(db): session 13 — phase 6.B — birthday-notify-daily cron`
- `test(db): session 13 — phase 6.B — pgTAP marketing suite`
- `chore(types): regen types.generated.ts for phase 6.B`
- `feat(backoffice): session 13 — phase 6.B — marketing pages (cohorts/segments/promo-roi/birthday)`
- `test(backoffice): session 13 — phase 6.B — vitest live + cohort smoke`
- `docs(workplan): session 13 — phase 6.B — wave 6 deviation pack opened`

(Squash-mergeable groups; final history may collapse the migrations
into one commit and the BO work into one commit if cleaner.)
