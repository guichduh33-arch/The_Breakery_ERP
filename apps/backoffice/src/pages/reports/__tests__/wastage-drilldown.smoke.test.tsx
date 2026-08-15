// apps/backoffice/src/pages/reports/__tests__/wastage-drilldown.smoke.test.tsx
//
// S31 — câblage du drill-down produit. Lot F : la fixture porte désormais le
// contrat COMPLET de `useWastageReport` (by_product, ventilation manuel/
// péremption, lot et motif), que le hook sert depuis le lot A1. Une fixture
// partielle testait la page contre une forme de données qui n'existe plus.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WastagePage from '../WastagePage.js';

vi.mock('@/features/reports/hooks/useWastageReport.js', () => ({
  useWastageReport: () => ({
    isLoading: false,
    error: null,
    data: {
      lines: [
        {
          id: 'l-1',
          product_id: 'p-1',
          product_name: 'Croissant',
          type: 'manual_waste',
          qty: 5,
          value: 12_500,
          created_at: '2026-05-22T10:00:00Z',
          recorded_by: null,
          lot_id: null,
          lot_batch_number: null,
          reason: null,
        },
      ],
      by_product: [
        {
          product_id: 'p-1',
          product_name: 'Croissant',
          manual_waste_qty: 5,
          manual_waste_value: 12_500,
          spoilage_qty: 0,
          spoilage_value: 0,
          total_qty: 5,
          total_value: 12_500,
        },
      ],
      total_value: 12_500,
      manual_value: 12_500,
      spoilage_value: 0,
      period: { start: '2026-05-16', end: '2026-05-22' },
      truncated: false,
    },
  }),
}));

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

describe('WastagePage drill-down wiring (S31)', () => {
  it('product cell renders DrilldownLink with /backoffice/products/:id href', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <WastagePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Le lien vit dans la TABLE : le nom paraît aussi sur l'axe du Pareto.
    await waitFor(() => {
      expect(screen.getByTestId('wastage-lines')).toBeInTheDocument();
    });
    const link = within(screen.getByTestId('wastage-lines'))
      .getByRole('link', { name: /Croissant/ });
    expect(link.getAttribute('href')).toBe('/backoffice/products/p-1');
  });
});
