// apps/backoffice/src/pages/reports/__tests__/WastagePage.smoke.test.tsx
// S30 Wave 4.3 — Smoke test: WastagePage renders heading, calls RPC, shows export buttons.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import WastagePage from '@/pages/reports/WastagePage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_wastage_report_v1') {
        return Promise.resolve({
          data: {
            period: { start: '2026-04-25', end: '2026-05-25' },
            total_value: 150000,
            lines: [
              {
                id: 'w-1',
                product_id: 'p-1',
                product_name: 'Croissant',
                type: 'expired',
                qty: 12,
                value: 90000,
                created_at: '2026-05-20T08:00:00Z',
                recorded_by: null,
              },
              {
                id: 'w-2',
                product_id: 'p-2',
                product_name: 'Baguette',
                type: 'damaged',
                qty: 5,
                value: 60000,
                created_at: '2026-05-22T09:30:00Z',
                recorded_by: null,
              },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><WastagePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WastagePage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Wastage/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_wastage_report_v1 with p_start and p_end', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_wastage_report_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start: string; p_end: string }])[1];
      expect(args.p_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders product rows once data loads', async () => {
    renderPage();
    expect(await screen.findByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Baguette')).toBeInTheDocument();
  });

  it('shows export CSV and PDF buttons once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
      expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
    });
  });
});
