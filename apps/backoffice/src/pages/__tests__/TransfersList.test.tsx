// apps/backoffice/src/pages/__tests__/TransfersList.test.tsx
// Session 12 — Phase 3 — Smoke test for the TransfersList page.
//
// Verifies:
//   - The page heading + filter bar render under permission.
//   - Mocked rows show up in the table with their transfer numbers and the
//     two section names joined by an arrow.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import TransfersListPage from '@/pages/TransfersList.js';

let currentPerms = new Set<string>(['inventory.read', 'inventory.transfer.create']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const MOCK_SECTIONS = [
  { id: 's-1', code: 'KIT', name: 'Kitchen', kind: 'production', display_order: 1 },
  { id: 's-2', code: 'BAR', name: 'Bar',     kind: 'service',    display_order: 2 },
];

const MOCK_TRANSFERS = [
  {
    id: 'tr-1',
    transfer_number: 'TR-2026-0001',
    status: 'pending',
    from_section_id: 's-1',
    to_section_id:   's-2',
    created_at:      '2026-05-12T10:00:00Z',
    transferred_at:  '2026-05-12T10:00:00Z',
    received_at:     null,
    notes:           null,
    sections:    { code: 'KIT', name: 'Kitchen' },
    to_section:  { code: 'BAR', name: 'Bar'     },
  },
  {
    id: 'tr-2',
    transfer_number: 'TR-2026-0002',
    status: 'received',
    from_section_id: 's-2',
    to_section_id:   's-1',
    created_at:      '2026-05-11T10:00:00Z',
    transferred_at:  '2026-05-11T10:00:00Z',
    received_at:     '2026-05-11T12:00:00Z',
    notes:           'Restock',
    sections:    { code: 'BAR', name: 'Bar'     },
    to_section:  { code: 'KIT', name: 'Kitchen' },
  },
];

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  // Per-table chain. internal_transfers chains: select.order.range.
  // sections chains: select.eq.is.order (terminal).
  function buildChain(table: string): unknown {
    const tableData: RpcResult =
      table === 'sections'           ? { data: MOCK_SECTIONS, error: null } :
      table === 'internal_transfers' ? { data: MOCK_TRANSFERS, error: null } :
      { data: [], error: null };
    const chain = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      ilike:  () => chain,
      order:  () => {
        // internal_transfers awaits .order().range(); sections awaits .order() directly.
        if (table === 'internal_transfers') return chain;
        return Promise.resolve(tableData);
      },
      range:  () => Promise.resolve(tableData),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  () => Promise.resolve({ data: null, error: null }),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TransfersListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TransfersListPage', () => {
  beforeEach(() => {
    currentPerms = new Set(['inventory.read', 'inventory.transfer.create']);
  });

  it('renders the page heading and filter bar', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Transfers/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^From$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^To$/i)).toBeInTheDocument();
    // Wait for transfer rows to land.
    await waitFor(() => {
      expect(screen.getByText('TR-2026-0001')).toBeInTheDocument();
    });
  });

  it('renders transfer rows from the mocked list query', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('TR-2026-0001')).toBeInTheDocument();
      expect(screen.getByText('TR-2026-0002')).toBeInTheDocument();
    });
    // Both Kitchen and Bar appear in the table (each twice — once per row).
    expect(screen.getAllByText(/Kitchen/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Bar/i).length).toBeGreaterThanOrEqual(2);
  });

  it('shows the "New Transfer" link when the user has inventory.transfer.create', async () => {
    renderPage();
    await waitFor(() => screen.getByText('TR-2026-0001'));
    expect(screen.getByRole('link', { name: /New Transfer/i })).toBeInTheDocument();
  });

  it('hides the "New Transfer" link when the user lacks inventory.transfer.create', async () => {
    currentPerms = new Set(['inventory.read']);
    renderPage();
    await waitFor(() => screen.getByText('TR-2026-0001'));
    expect(screen.queryByRole('link', { name: /New Transfer/i })).not.toBeInTheDocument();
  });
});
