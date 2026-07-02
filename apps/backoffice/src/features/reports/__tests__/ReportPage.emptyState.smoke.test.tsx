// apps/backoffice/src/features/reports/__tests__/ReportPage.emptyState.smoke.test.tsx
// S57 D-D1 — verifies the shared ReportPage emptyState branch.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportPage } from '@/features/reports/components/ReportPage.js';

describe('ReportPage emptyState (D-D1)', () => {
  it('renders children when not empty', () => {
    render(
      <ReportPage title="Sales" emptyState={{ title: 'No data' }}>
        <div data-testid="report-body">rows</div>
      </ReportPage>,
    );
    expect(screen.getByTestId('report-body')).toBeInTheDocument();
    expect(screen.queryByText('No data')).toBeNull();
  });

  it('renders the EmptyState primitive instead of children when isEmpty', () => {
    render(
      <ReportPage
        title="Sales"
        isEmpty
        emptyState={{ title: 'No sales', description: 'No sales in the selected range.' }}
      >
        <div data-testid="report-body">rows</div>
      </ReportPage>,
    );
    expect(screen.queryByTestId('report-body')).toBeNull();
    expect(screen.getByText('No sales')).toBeInTheDocument();
    expect(screen.getByText('No sales in the selected range.')).toBeInTheDocument();
  });

  it('falls back to children when isEmpty is true but no emptyState is provided', () => {
    render(
      <ReportPage title="Sales" isEmpty>
        <div data-testid="report-body">rows</div>
      </ReportPage>,
    );
    expect(screen.getByTestId('report-body')).toBeInTheDocument();
  });
});
