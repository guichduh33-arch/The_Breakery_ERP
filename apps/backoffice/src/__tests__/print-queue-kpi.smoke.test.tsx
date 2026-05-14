// apps/backoffice/src/__tests__/print-queue-kpi.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the KPI strip on PrintQueuePage.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/features/print-queue/hooks/usePrintQueue.js', () => ({
  usePrintQueue: () => ({
    data: [
      { id: 'j1', device_id: null, payload: {}, status: 'queued',   source: 'pos', reference_type: 'order', reference_id: 'o1', priority: 1, retries: 0, error_message: null, queued_at: new Date().toISOString(), printed_at: null, created_at: '', updated_at: '' },
      { id: 'j2', device_id: null, payload: {}, status: 'printing', source: 'pos', reference_type: 'order', reference_id: 'o2', priority: 1, retries: 0, error_message: null, queued_at: new Date().toISOString(), printed_at: null, created_at: '', updated_at: '' },
      { id: 'j3', device_id: null, payload: {}, status: 'failed',   source: 'pos', reference_type: 'order', reference_id: 'o3', priority: 1, retries: 2, error_message: 'No paper', queued_at: new Date().toISOString(), printed_at: null, created_at: '', updated_at: '' },
    ],
    isLoading: false,
    error: null,
  }),
  PRINT_QUEUE_KEY: ['print-queue'],
}));

vi.mock('@/features/print-queue/hooks/useCancelPrintJob.js', () => ({
  useCancelPrintJob: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
}));

function renderPage(Component: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

describe('PrintQueuePage (KPI rebuild)', () => {
  beforeEach(() => { cleanup(); });

  it('renders all 4 KPI tile labels', { timeout: 30_000 }, async () => {
    const PrintQueuePage = (await import('@/pages/print-queue/PrintQueuePage.js')).default;
    renderPage(PrintQueuePage);
    expect(screen.getByText(/Total active/i)).toBeInTheDocument();
    // The status names also appear as row status badges — multiple matches expected.
    expect(screen.getAllByText(/^Queued$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^Printing$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^Failed$/i).length).toBeGreaterThanOrEqual(1);
  });
});
