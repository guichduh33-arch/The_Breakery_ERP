// apps/backoffice/src/features/marketing/__tests__/CohortHeatmap.smoke.test.tsx
//
// Smoke test : CohortHeatmap renders empty state + populated state
// without crashing.
//
// Session 13 / Phase 6.B.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CohortHeatmap } from '../components/CohortHeatmap.js';
import type { CohortBucket } from '../hooks/useCustomerCohorts.js';

describe('CohortHeatmap — smoke', () => {
  it('renders an empty-state message when no buckets are provided', () => {
    render(<CohortHeatmap buckets={[]} />);
    expect(screen.getByRole('status').textContent).toContain('No data');
  });

  it('renders cohort meta + heatmap row for populated data', () => {
    const buckets: CohortBucket[] = [
      { cohort_month: '2026-01-01', months_since_signup: 0,
        retained_customers: 100, total_revenue: 5_000_000, retention_pct: 100 },
      { cohort_month: '2026-01-01', months_since_signup: 1,
        retained_customers: 60,  total_revenue: 3_000_000, retention_pct: 60 },
      { cohort_month: '2026-01-01', months_since_signup: 2,
        retained_customers: 40,  total_revenue: 1_500_000, retention_pct: 40 },
    ];

    render(<CohortHeatmap buckets={buckets} />);

    expect(screen.getByText(/2026-01-01/)).toBeTruthy();
    // Cohort size = retained_customers at month 0 (100)
    expect(screen.getByText('100')).toBeTruthy();
    // Retention values rendered
    expect(screen.getByText('100.0%')).toBeTruthy();
    expect(screen.getByText('60.0%')).toBeTruthy();
    expect(screen.getByText('40.0%')).toBeTruthy();
  });
});
