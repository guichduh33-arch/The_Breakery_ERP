// apps/backoffice/src/pages/reports/__tests__/RecipeCostOverviewPage.smoke.test.tsx
// Session 18 — Phase 2.A — RecipeCostOverviewPage render smoke.
//
// Mocks supabase.rpc to return controlled OverviewRow fixtures and asserts:
//   1. Empty state renders the "no movement" message when RPC returns 0 rows.
//   2. Table renders when RPC returns rows.
//   3. Row click navigates to /backoffice/reports/recipe-cost/<product_id>.
//   4. delta_pct > 20 gets text-danger class on the delta cell.
//   5. Exports absent when 0 rows, CSV + PDF present when ≥ 1 row.
//
// RPC mock pattern mirrors ProductionYieldPage.smoke.test.tsx (S15).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import RecipeCostOverviewPage from '@/pages/reports/RecipeCostOverviewPage.js';
import { useAuthStore } from '@/stores/authStore.js';

// --- Fixtures ---

const OVERVIEW_ROWS = [
  {
    product_id:    'prod-a',
    product_name:  'Croissant',
    cost_per_unit: 5.00,
    baseline_cost: 4.00,
    delta_pct:     25.00,   // > 20 → text-danger
    change_count:  3,
    created_at:    '2026-05-10T08:00:00Z',
  },
  {
    product_id:    'prod-b',
    product_name:  'Baguette',
    cost_per_unit: 2.50,
    baseline_cost: 2.40,
    delta_pct:     4.17,   // ≤ 5 → text-success
    change_count:  1,
    created_at:    '2026-05-09T08:00:00Z',
  },
];

// --- Supabase mock (rpc-based) ---

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) as unknown },
}));

// --- React Router mock ---

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
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

// Audit Reports 2026-08-01, lot C / D3 — <ExportButtons> ne rend rien sans
// `reports.export`, et les pages a export maison desactivent leur bouton. Ce
// test verifie le CABLAGE de l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
});

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
    // Le nom paraît aussi dans la bande de KPI (« Biggest rise » le NOMME) :
    // l'assertion se porte donc sur la table.
    const table = screen.getByTestId('overview-table');
    expect(within(table).getByText('Croissant')).toBeInTheDocument();
    expect(within(table).getByText('Baguette')).toBeInTheDocument();
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

  // 4. delta_pct > 20 gets text-danger
  it('applies text-danger class on the delta cell when delta_pct > 20', async () => {
    mockRpc.mockResolvedValue({ data: OVERVIEW_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('overview-row-prod-a')).toBeInTheDocument();
    });
    const rowA = screen.getByTestId('overview-row-prod-a');
    // The delta cell shows "+25,00%" — find it by text
    const deltaCell = Array.from(rowA.querySelectorAll('td')).find(
      (td) => td.textContent?.includes('+25,00%'),
    );
    expect(deltaCell).toBeTruthy();
    expect(deltaCell!.className).toContain('text-danger');
  });

  // Lot F — le menu d'export du socle ne DISPARAÎT plus quand il n'y a rien à
  // sortir : il se DÉSACTIVE. Masquer un contrôle laisse croire que la fonction
  // n'existe pas ; le désactiver dit qu'il n'y a simplement rien à exporter.
  // Audit R-13 — les deux formats restent offerts, le PDF `recipe_overview`
  // étant précisément le gabarit qui était inatteignable.
  it('disables the export menu when 0 rows and offers CSV + PDF when rows are present', async () => {
    // --- empty case ---
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { unmount } = renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).toBeDisabled();
    });
    unmount();

    // --- rows case ---
    mockRpc.mockResolvedValue({ data: OVERVIEW_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });

  // La bande résume le mouvement : un produit en hausse, un en baisse, et les
  // deux extrêmes nommés — c'est la lecture qu'un classement de deltas doit
  // ouvrir.
  it('summarises the movement in the KPI band', async () => {
    mockRpc.mockResolvedValue({ data: OVERVIEW_ROWS, error: null });
    renderPage();
    const up = await screen.findByTestId('kpi-biggest-up');
    expect(up.textContent).toMatch(/\+25,00%/);
    expect(up.textContent).toMatch(/Croissant/);
    // Aucun produit n'a baissé dans la fixture : on le DIT, on n'affiche pas 0 %.
    expect(screen.getByTestId('kpi-biggest-down').textContent).toMatch(/no recipe went down/);
  });

  // 6. Error state renders alert
  it('renders an error alert when RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('report-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('report-error').textContent).toContain('permission denied');
  });
});
