// apps/backoffice/src/pages/marketing/CohortReportPage.tsx
//
// Session 13 / Phase 6.B — Customer cohort retention report.
// Wraps `useCustomerCohorts` and renders via `CohortHeatmap`.

import { useState } from 'react';
import { Input } from '@breakery/ui';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { CohortHeatmap } from '@/features/marketing/components/CohortHeatmap.js';
import { useCustomerCohorts } from '@/features/marketing/hooks/useCustomerCohorts.js';

function firstOfMonth(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export default function CohortReportPage() {
  const [cohortMonth, setCohortMonth] = useState<string>(() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 6);
    return firstOfMonth(d);
  });
  const [lookback, setLookback] = useState<number>(12);

  const { data, isLoading, error } = useCustomerCohorts(cohortMonth, lookback);

  return (
    <ReportPage
      title="Customer Cohort Retention"
      subtitle="Retention + revenue of customers who signed up in a given month, tracked over the following months."
      filters={
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            <span>Cohort month</span>
            <Input
              type="month"
              value={cohortMonth.slice(0, 7)}
              onChange={(e) => setCohortMonth(`${e.target.value}-01`)}
              className="h-9 w-40"
              aria-label="Cohort month"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            <span>Lookback (months)</span>
            <Input
              type="number"
              min={1}
              max={36}
              value={lookback}
              onChange={(e) => setLookback(Math.max(1, Math.min(36, Number(e.target.value))))}
              className="h-9 w-24"
              aria-label="Lookback months"
            />
          </label>
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error.message ?? 'Failed to load cohort report.'}
        </p>
      )}
      {data !== undefined && data !== null && <CohortHeatmap buckets={data} />}
    </ReportPage>
  );
}
