// apps/backoffice/src/features/accounting/__tests__/fixed-assets-page.smoke.test.tsx
//
// ADR-047 — registre des équipements : liste, totaux des actifs ACTIFS,
// signal des mois refusés (période fermée), bouton d'inscription réservé à
// `accounting.fixed_assets.manage`, états vide / erreur / réponse invalide.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import FixedAssetsPage from '@/features/accounting/pages/FixedAssetsPage.js';

const state = vi.hoisted(() => ({
  perms: new Set<string>(['reports.statements.read', 'accounting.fixed_assets.manage']),
  rpc: vi.fn((_fn: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: [], error: null })),
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => state.rpc(fn, args),
    from: () => ({ select: () => ({ is: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
  },
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => state.perms.has(p) }),
}));

function asset(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'a-1', asset_number: 'FA-0001', name: 'Deck oven', asset_type: 'production_machine',
    tax_group: 'group_1', useful_life_months: 48, account_code: '1610', account_name: 'Production machines',
    in_service_date: '2025-10-01', cost: 28_791_300, monthly_depreciation: 599_818.75, origin: 'opening',
    expense_id: null, expense_number: null, accumulated_depreciation: 7_197_825,
    net_book_value: 21_593_475, months_posted: 0, last_posted_month: null, refused_months: 0,
    status: 'active', disposed_at: null, disposal_reason: null, created_at: '2026-11-25T00:00:00Z',
    ...over,
  };
}

const ROWS = [
  asset({ refused_months: 2 }),
  asset({ id: 'a-2', asset_number: 'FA-0002', name: 'Laptop', asset_type: 'equipment', origin: 'expense',
    expense_id: 'e-1', expense_number: 'EXP-1', cost: 3_000_000, accumulated_depreciation: 62_500,
    net_book_value: 2_937_500, months_posted: 1, last_posted_month: '2026-10-01' }),
  asset({ id: 'a-3', asset_number: 'FA-0003', name: 'Old mixer', status: 'disposed', cost: 5_000_000,
    accumulated_depreciation: 1_000_000, net_book_value: 4_000_000, disposed_at: '2026-11-10', disposal_reason: 'scrap' }),
];

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><FixedAssetsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.perms = new Set(['reports.statements.read', 'accounting.fixed_assets.manage']);
  state.rpc.mockImplementation(() => Promise.resolve({ data: ROWS, error: null }));
});
afterEach(cleanup);

describe('FixedAssetsPage', () => {
  it('lists the assets and totals the ACTIVE ones only', async () => {
    renderPage();
    const table = await screen.findByTestId('fa-table');
    expect(within(table).getByText('Deck oven')).toBeInTheDocument();
    expect(within(table).getAllByText('Group 1 — 4 years')).toHaveLength(3);
    expect(within(table).getByText('Equipment & furniture')).toBeInTheDocument();
    expect(within(table).getAllByText('Disposed').length).toBe(1);
    expect(state.rpc).toHaveBeenCalledWith('get_fixed_assets_v1', undefined);
    // FA-0001 + FA-0002 ; FA-0003, sorti, ne compte plus.
    expect(screen.getByTestId('fa-total-cost')).toHaveTextContent('31.791.300');
    expect(screen.getByTestId('fa-total-accumulated')).toHaveTextContent('7.260.325');
    expect(screen.getByTestId('fa-total-net')).toHaveTextContent('24.530.975');
    expect(screen.getByText('Total of active assets (2)')).toBeInTheDocument();
  });

  it('flags months refused for a closed period on the row', async () => {
    renderPage();
    expect(await screen.findByTestId('fa-refused-FA-0001')).toHaveTextContent('2 months refused (closed period)');
    expect(screen.queryByTestId('fa-refused-FA-0002')).not.toBeInTheDocument();
  });

  it('links each asset number to its card', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Open FA-0002 Laptop' });
    expect(link).toHaveAttribute('href', '/backoffice/accounting/fixed-assets/a-2');
  });

  it('shows the register button only with accounting.fixed_assets.manage', async () => {
    renderPage();
    expect(await screen.findByTestId('fa-register-open')).toBeInTheDocument();
    cleanup();
    state.perms = new Set(['reports.statements.read']);
    renderPage();
    await screen.findByTestId('fa-table');
    expect(screen.queryByTestId('fa-register-open')).not.toBeInTheDocument();
  });

  it('renders the empty state when the register is empty', async () => {
    state.rpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    renderPage();
    expect(await screen.findByText('No fixed assets yet')).toBeInTheDocument();
    expect(screen.queryByTestId('fa-table')).not.toBeInTheDocument();
  });

  it('renders the error banner on a server refusal', async () => {
    state.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'missing permission reports.statements.read' } }));
    renderPage();
    expect(await screen.findByTestId('fa-error')).toBeInTheDocument();
    expect(screen.queryByText('No fixed assets yet')).not.toBeInTheDocument();
  });

  it('refuses an unexpected payload instead of rendering it', async () => {
    state.rpc.mockImplementation(() => Promise.resolve({ data: [{ id: 'a-1', status: 'lost' }], error: null }));
    renderPage();
    expect(await screen.findByTestId('fa-error')).toHaveTextContent('Invalid fixed asset response');
  });
});
