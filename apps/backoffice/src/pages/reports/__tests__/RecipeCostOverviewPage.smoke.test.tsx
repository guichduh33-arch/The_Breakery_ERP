// apps/backoffice/src/pages/reports/__tests__/RecipeCostOverviewPage.smoke.test.tsx
// Session 18 — Phase 2.A — RecipeCostOverviewPage render smoke.
//
// Mocks supabase.rpc to return controlled OverviewRow fixtures and asserts:
//   1. Empty state renders the "no movement" message when RPC returns 0 rows.
//   2. Table renders when RPC returns rows.
//   3. Row click navigates to /backoffice/reports/recipe-cost/<product_id>.
//   4. delta_pct > 20 gets text-red-600 class on the delta cell.
//   5. Export CSV button is disabled when 0 rows, enabled when ≥ 1 row.
//
// RPC mock pattern mirrors ProductionYieldPage.smoke.test.tsx (S15).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import RecipeCostOverviewPage from '@/pages/reports/RecipeCostOverviewPage.js';

// --- Fixtures ---

const OVERVIEW_ROWS = [
  {
    product_id:    'prod-a',
    product_name:  'Croissant',
    cost_per_unit: 5.00,
    baseline_cost: 4.00,
    delta_pct:     25.00,   // > 20 → text-red-600
    change_count:  3,
    created_at:    '2026-05-10T08:00:00Z',
  },
  {
    product_id:    'prod-b',
    product_name:  'Baguette',
    cost_per_unit: 2.50,
    baseline_cost: 2.40,
    delta_pct:     4.17,   // ≤ 5 → text-emerald-600
    change_count:  1,
    created_at:    '2026-05-09T08:00:00Z',
  },
];

// --- Supabase mock (rpc-based) ---

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

// --- React Router mock ---

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// --- Helpers ---

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><RecipeCostOverviewPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// --- Tests ---

describe('RecipeCostOverviewPage smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Empty state
  it('renders empty-state message when RPC returns 0 rows', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    renderPage();
    expect(
      await screen.findByTestId('empty-overview'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('overview-table')).toBeNull();
  });

  // 2. Table renders rows
  it('renders the overview table with a row per product', async () => {
    mockRpc.mockResolvedValue({ data: OVERVIEW_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('overview-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('overview-row-prod-a')).toBeInTheDocument();
    expect(screen.getByTestId('overview-row-prod-b')).toBeInTheDocument();
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Baguette')).toBeInTheDocument();
  });

  // 3. Row click navigates to drill-down
  it('navigates to /backoffice/reports/recipe-cost/<id> on row click', async () => {
    mockRpc.mockResolvedValue({ data: OVERVIEW_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('overview-row-prod-a')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('overview-row-prod-a'));
    expect(mockNavigate).toHaveBeenCalledWith('/backoffice/reports/recipe-cost/prod-a');
  });

  // 4. delta_pct > 20 gets text-red-600
  it('applies text-red-600 class on the delta cell when delta_pct > 20', async () => {
    mockRpc.mockResolvedValue({ data: OVERVIEW_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('overview-row-prod-a')).toBeInTheDocument();
    });
    const rowA = screen.getByTestId('overview-row-prod-a');
    // The delta cell shows "+25.00%" — find it by text
    const deltaCell = Array.from(rowA.querySelectorAll('td')).find(
      (td) => td.textContent?.includes('+25.00%'),
    );
    expect(deltaCell).toBeTruthy();
    expect(deltaCell!.className).toContain('text-red-600');
  });

  // 5. CSV button disabled when empty, enabled when rows present
  it('disables Export CSV when 0 rows and enables it when rows are present', async () => {
    // --- empty case ---
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { unmount } = renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('overview-export-csv')).toBeDisabled();
    });
    unmount();

    // --- rows case ---
    mockRpc.mockResolvedValue({ data: OVERVIEW_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('overview-export-csv')).not.toBeDisabled();
    });
  });

  // 6. Error state renders alert
  it('renders an error alert when RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert').textContent).toContain('permission denied');
  });
});
