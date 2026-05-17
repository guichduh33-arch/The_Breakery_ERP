// apps/backoffice/src/pages/reports/__tests__/RecipeCostTimelinePage.smoke.test.tsx
// Session 18 — Phase 2.B — RecipeCostTimelinePage render smoke.
//
// Mocks supabase.rpc to return controlled TimelineRow fixtures and asserts:
//   1. Empty state renders "No cost history" when RPC returns 0 rows.
//   2. 3 versions render table rows + chart wrapper.
//   3. Delta vs prev computed correctly (v1=—, v2=+20.00%, v3=+25.00%).
//   4. CSV button disabled when empty, enabled with data.
//   5. Back link href = /backoffice/reports/recipe-cost.
//   6. Error state renders an alert.
//
// RPC mock pattern mirrors RecipeCostOverviewPage.smoke.test.tsx (S18 Phase 2.A).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import RecipeCostTimelinePage from '@/pages/reports/RecipeCostTimelinePage.js';

// --- Recharts mock — JSDOM has no SVG layout engine; ResponsiveContainer
//     requires width/height from the DOM and throws without it. Replace with
//     a plain div that renders children at a fixed size.

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 300 }}>{children}</div>
    ),
  };
});

// --- Supabase mock ---

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

// --- React Router mock ---
// useParams returns a fixed productId. Link and MemoryRouter come from actual
// to keep router context available (MemoryRouter is added in renderPage()).

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ productId: 'test-product-id' }),
  };
});

// --- Fixtures ---

function makeRow(
  versionNumber: number,
  costPerUnit: number,
  changeNote: string | null = null,
): object {
  return {
    product_id:     'test-product-id',
    product_name:   'Test Croissant',
    version_number: versionNumber,
    created_at:     `2026-05-0${versionNumber}T08:00:00Z`,
    cost_per_unit:  costPerUnit,
    change_note:    changeNote,
  };
}

// 3 rows with costs [100, 120, 150]
// v2 delta = (120-100)/100 * 100 = +20.00%
// v3 delta = (150-120)/120 * 100 = +25.00%
const THREE_ROWS = [
  makeRow(1, 100, 'initial'),
  makeRow(2, 120, 'flour price spike'),
  makeRow(3, 150, null),
];

// --- Helper ---

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <RecipeCostTimelinePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// --- Tests ---

describe('RecipeCostTimelinePage smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Empty state
  it('renders empty-state message when RPC returns 0 rows', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    renderPage();
    expect(await screen.findByTestId('empty-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-table')).toBeNull();
    expect(screen.queryByTestId('timeline-chart')).toBeNull();
  });

  // 2. 3 versions render table rows + chart wrapper
  it('renders table rows and chart wrapper when RPC returns 3 rows', async () => {
    mockRpc.mockResolvedValue({ data: THREE_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('timeline-chart')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-row-v1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-row-v2')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-row-v3')).toBeInTheDocument();
  });

  // 3. Delta vs prev computation
  it('shows — for v1 and correct signed percentages for v2 and v3', async () => {
    mockRpc.mockResolvedValue({ data: THREE_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-row-v1')).toBeInTheDocument();
    });

    const rowV1 = screen.getByTestId('timeline-row-v1');
    const rowV2 = screen.getByTestId('timeline-row-v2');
    const rowV3 = screen.getByTestId('timeline-row-v3');

    // v1 — first row, no prev → em dash
    const cellsV1 = rowV1.querySelectorAll('td');
    // delta cell is index 3 (Version, Date, Cost, Δ vs prev, Change note)
    expect(cellsV1[3]?.textContent).toBe('—');

    // v2 → +20.00%
    const cellsV2 = rowV2.querySelectorAll('td');
    expect(cellsV2[3]?.textContent).toBe('+20.00%');

    // v3 → +25.00%
    const cellsV3 = rowV3.querySelectorAll('td');
    expect(cellsV3[3]?.textContent).toBe('+25.00%');
  });

  // 4. CSV button disabled when empty, enabled with data
  it('disables Export CSV when 0 rows and enables it when rows are present', async () => {
    // Empty case
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { unmount } = renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-export-csv')).toBeDisabled();
    });
    unmount();

    // Rows case
    mockRpc.mockResolvedValue({ data: THREE_ROWS, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('timeline-export-csv')).not.toBeDisabled();
    });
  });

  // 5. Back link href
  it('renders back link pointing to /backoffice/reports/recipe-cost', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    renderPage();
    // Back link is always rendered (outside the empty-state guard)
    const backLink = await screen.findByTestId('timeline-back-link');
    expect(backLink).toBeInTheDocument();
    expect(backLink.getAttribute('href')).toBe('/backoffice/reports/recipe-cost');
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
