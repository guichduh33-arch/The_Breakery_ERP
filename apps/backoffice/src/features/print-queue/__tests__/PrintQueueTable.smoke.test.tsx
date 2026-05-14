// apps/backoffice/src/features/print-queue/__tests__/PrintQueueTable.smoke.test.tsx
// Session 13 / Phase 5.A — smoke test for the print queue table.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrintQueueTable } from '../components/PrintQueueTable.js';
import * as queueMod from '../hooks/usePrintQueue.js';
import * as cancelMod from '../hooks/useCancelPrintJob.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeQuery(data: unknown, overrides: Partial<any> = {}): any {
  return { data, isLoading: false, error: null, ...overrides };
}

describe('PrintQueueTable', () => {
  it('renders empty state when no rows', () => {
    vi.spyOn(queueMod, 'usePrintQueue').mockReturnValue(fakeQuery([]));
    vi.spyOn(cancelMod, 'useCancelPrintJob').mockReturnValue({
      mutate: vi.fn(), isPending: false, variables: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    render(wrap(<PrintQueueTable />));
    expect(screen.getByText(/No active print jobs/i)).toBeInTheDocument();
  });

  it('renders rows + Cancel button on queued rows', () => {
    vi.spyOn(queueMod, 'usePrintQueue').mockReturnValue(fakeQuery([
      {
        id: 'job-1',
        device_id: null,
        payload: {},
        status: 'queued',
        source: 'pos',
        reference_type: 'order',
        reference_id: 'order-abc',
        priority: 5,
        retries: 0,
        error_message: null,
        queued_at: '2026-05-14T10:00:00Z',
        printed_at: null,
        created_at: '2026-05-14T10:00:00Z',
        updated_at: '2026-05-14T10:00:00Z',
      },
    ]));
    const mutateMock = vi.fn();
    vi.spyOn(cancelMod, 'useCancelPrintJob').mockReturnValue({
      mutate: mutateMock, isPending: false, variables: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    render(wrap(<PrintQueueTable />));
    expect(screen.getByText('queued')).toBeInTheDocument();
    expect(screen.getByText('pos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('hides Cancel button on printing rows', () => {
    vi.spyOn(queueMod, 'usePrintQueue').mockReturnValue(fakeQuery([
      {
        id: 'job-2',
        device_id: null,
        payload: {},
        status: 'printing',
        source: 'kds',
        reference_type: 'order_item',
        reference_id: 'oi-xyz',
        priority: 5,
        retries: 0,
        error_message: null,
        queued_at: '2026-05-14T10:00:00Z',
        printed_at: null,
        created_at: '2026-05-14T10:00:00Z',
        updated_at: '2026-05-14T10:00:00Z',
      },
    ]));
    vi.spyOn(cancelMod, 'useCancelPrintJob').mockReturnValue({
      mutate: vi.fn(), isPending: false, variables: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    render(wrap(<PrintQueueTable />));
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });
});
