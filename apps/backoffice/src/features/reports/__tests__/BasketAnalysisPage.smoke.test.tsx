// apps/backoffice/src/features/reports/__tests__/BasketAnalysisPage.smoke.test.tsx
// Phase 6.A smoke for Basket Analysis.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BasketAnalysisPage from '@/pages/reports/BasketAnalysisPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_basket_analysis_v2') {
        return Promise.resolve({
          data: [
            {
              product_id_a: '11111111-1111-1111-1111-111111111111',
              product_a_name: 'Croissant',
              product_id_b: '22222222-2222-2222-2222-222222222222',
              product_b_name: 'Latte',
              co_occurrence_count: 12,
              support_a: 0.18,
              support_b: 0.22,
              support_pair: 0.10,
              confidence: 0.55,
              lift: 2.5,
            },
            {
              product_id_a: '33333333-3333-3333-3333-333333333333',
              product_a_name: 'Bagel',
              product_id_b: '44444444-4444-4444-4444-444444444444',
              product_b_name: 'Espresso',
              co_occurrence_count: 5,
              support_a: 0.08,
              support_b: 0.12,
              support_pair: 0.04,
              confidence: 0.33,
              lift: 1.3,
            },
          ],
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
      <MemoryRouter>
        <BasketAnalysisPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BasketAnalysisPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders heading and top-3 cross-sells from RPC payload', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Basket Analysis', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Latte')).toBeInTheDocument();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_basket_analysis_v2');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string; p_top_n: number }])[1];
      expect(args.p_top_n).toBeGreaterThan(0);
    });
  });
});
