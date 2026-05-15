// apps/backoffice/src/__tests__/transfers-list-kpi.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the KPI strip on the TransfersList page
// matches `14-transfers-list.jpg` (Total / Drafts / In transit / Completed).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

vi.mock('@/features/inventory-transfers/hooks/useInternalTransfers.js', () => ({
  useInternalTransfers: () => ({
    data: [
      { id: 't-1', transfer_number: 'TR-001', status: 'draft',     from_section_id: 's1', to_section_id: 's2',
        created_at: new Date().toISOString(), transferred_at: null, received_at: null, notes: null,
        sections: { code: 'WH', name: 'Warehouse' }, to_section: { code: 'PT', name: 'Pastry' } },
      { id: 't-2', transfer_number: 'TR-002', status: 'received',  from_section_id: 's1', to_section_id: 's2',
        created_at: new Date().toISOString(), transferred_at: null, received_at: new Date().toISOString(), notes: null,
        sections: { code: 'WH', name: 'Warehouse' }, to_section: { code: 'PT', name: 'Pastry' } },
      { id: 't-3', transfer_number: 'TR-003', status: 'in_transit', from_section_id: 's1', to_section_id: 's2',
        created_at: new Date().toISOString(), transferred_at: null, received_at: null, notes: null,
        sections: { code: 'WH', name: 'Warehouse' }, to_section: { code: 'PT', name: 'Pastry' } },
    ],
    isLoading: false,
    error: null,
  }),
  INTERNAL_TRANSFERS_QUERY_KEY: ['internal-transfers'],
}));

vi.mock('@/features/inventory-transfers/hooks/useSections.js', () => ({
  useSections: () => ({ data: [], isLoading: false, error: null }),
}));

function renderPage(Component: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TransfersList page (KPI rebuild)', () => {
  beforeEach(() => { cleanup(); });

  it('renders all 4 KPI tile labels', { timeout: 30_000 }, async () => {
    const TransfersListPage = (await import('@/pages/TransfersList.js')).default;
    renderPage(TransfersListPage);
    expect(screen.getByText(/^Total$/i)).toBeInTheDocument();
    expect(screen.getByText(/Drafts/i)).toBeInTheDocument();
    // "In transit" also appears as a <select> option, so multiple matches are expected.
    expect(screen.getAllByText(/In transit/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Completed/i)).toBeInTheDocument();
  });

  it('renders the Transfer table rows', { timeout: 15_000 }, async () => {
    const TransfersListPage = (await import('@/pages/TransfersList.js')).default;
    renderPage(TransfersListPage);
    expect(screen.getByText('TR-001')).toBeInTheDocument();
    expect(screen.getByText('TR-002')).toBeInTheDocument();
    expect(screen.getByText('TR-003')).toBeInTheDocument();
  });
});
