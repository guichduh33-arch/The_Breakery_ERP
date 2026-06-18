// apps/backoffice/src/features/products/__tests__/costing-panel.smoke.test.tsx
//
// Session 39 — Wave B2 — CostingPanel smoke tests.
//
// Asserts:
//   T1: header KPI cards render cost / retail / margin correctly.
//   T2: BOM table renders 2 ingredient rows + correct total.
//   T3: open dialog, fill cost + reason → submit → update_cost_price_v1 called
//       with p_new_cost, p_reason, and a UUID p_idempotency_key.
//
// IMPORTANT: All mock data objects are defined inside vi.hoisted() so they have
// stable object references across renders. Defining them inside vi.mock()
// factories returns a new object on every render call, making useEffect deps
// unstable and causing infinite render loops — a lesson from Wave B1.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CostingPanel } from '../components/CostingPanel.js';

// ── Hoisted shared state ───────────────────────────────────────────────────────

const { rpcMock, mockState, BOM_DATA } = vi.hoisted(() => {
  const rpcMock = vi.fn();
  const mockState = {
    hasPerm:   true,
    bomRows:   [] as Array<{
      material_id:   string;
      material_name: string;
      material_unit: string;
      recipe_unit:   string;
      qty_per_unit:  number;
      current_stock: number;
      cost_price:    number;
    }>,
    bomLoading: false,
    bomError:   null as Error | null,
  };

  // Stable BOM data object — created ONCE so useEffect deps don't fire infinitely.
  // material_unit (stock unit) deliberately differs from recipe_unit (per-line
  // unit) so the table must render recipe_unit, matching the Recipe tab.
  // qty_in_base + line_cost are computed server-side (recipe-unit → stock-unit
  // conversion, PR #91); mirrored here so the panel's line_cost sum reconciles.
  const BOM_DATA = [
    {
      material_id:   'mat-1',
      material_name: 'Flour',
      material_unit: 'kg',
      recipe_unit:   'gr',
      qty_per_unit:  0.5,
      current_stock: 100,
      cost_price:    8_000,
      qty_in_base:   0.5,
      line_cost:     4_000,
    },
    {
      material_id:   'mat-2',
      material_name: 'Sugar',
      material_unit: 'kg',
      recipe_unit:   'gr',
      qty_per_unit:  0.2,
      current_stock: 50,
      cost_price:    15_000,
      qty_in_base:   0.2,
      line_cost:     3_000,
    },
  ];

  return { rpcMock, mockState, BOM_DATA };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ hasPermission: (_code: string) => mockState.hasPerm }),
}));

vi.mock('@/features/products/hooks/useRecipeDirectCost.js', () => ({
  useRecipeDirectCost: (_productId: string) => ({
    // Return the stable BOM_DATA reference when there are rows,
    // or mockState.bomRows (empty array) when the test wants no BOM.
    data:      mockState.bomRows.length > 0 ? BOM_DATA : mockState.bomRows,
    isLoading: mockState.bomLoading,
    error:     mockState.bomError,
  }),
}));

vi.mock('@/features/products/hooks/useCorrectCostPrice.js', () => ({
  useCorrectCostPrice: (_productId: string) => ({
    mutateAsync: rpcMock,
    isPending:   false,
  }),
}));

// ── Product fixture ───────────────────────────────────────────────────────────

const PRODUCT = {
  id:           'prod-1',
  cost_price:   10_000,
  retail_price: 25_000,
};

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CostingPanel product={PRODUCT} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CostingPanel [S39 WB2]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.hasPerm    = true;
    mockState.bomRows    = [];
    mockState.bomLoading = false;
    mockState.bomError   = null;
  });

  it('T1: header cards render cost / retail / margin from mock product', () => {
    renderPanel();

    // cost_price = 10_000 → "Rp 10.000" in id-ID locale
    const costCard = screen.getByTestId('costing-card-cost');
    expect(costCard).toHaveTextContent('10.000');

    // retail_price = 25_000 → "Rp 25.000"
    const retailCard = screen.getByTestId('costing-card-retail');
    expect(retailCard).toHaveTextContent('25.000');

    // margin = (25000 - 10000) / 25000 * 100 = 60.0%
    const marginCard = screen.getByTestId('costing-card-margin');
    expect(marginCard).toHaveTextContent('60.0%');
  });

  it('T2: BOM table renders 2 rows + correct total', () => {
    // Make useRecipeBomFull return the stable BOM_DATA (2 rows).
    mockState.bomRows = BOM_DATA as typeof mockState.bomRows;

    renderPanel();

    expect(screen.getByTestId('bom-table')).toBeInTheDocument();

    // 2 ingredient rows
    expect(screen.getByTestId('bom-row-mat-1')).toBeInTheDocument();
    expect(screen.getByTestId('bom-row-mat-2')).toBeInTheDocument();

    // Check ingredient names present
    expect(screen.getByText('Flour')).toBeInTheDocument();
    expect(screen.getByText('Sugar')).toBeInTheDocument();

    // Total = (0.5 × 8000) + (0.2 × 15000) = 4000 + 3000 = 7000 → "7.000"
    const totalCell = screen.getByTestId('bom-total');
    expect(totalCell).toHaveTextContent('7.000');

    // Unit column shows the recipe line unit (gr), NOT the material stock unit (kg).
    const row1 = screen.getByTestId('bom-row-mat-1');
    expect(row1).toHaveTextContent('gr');
    expect(row1).not.toHaveTextContent('kg');
  });

  it('T3: open dialog, fill fields, submit → update_cost_price_v1 called with correct args', async () => {
    // Resolve: dialog opens, form is filled, rpcMock is called with expected args.
    rpcMock.mockResolvedValueOnce({
      movement_id:      'mv-1',
      product_id:       'prod-1',
      old_cost:         10_000,
      new_cost:         12_000,
      idempotent_replay: false,
    });

    renderPanel();

    // "Correct cost price" button is visible (hasPerm = true)
    const triggerBtn = screen.getByTestId('correct-cost-btn');
    expect(triggerBtn).toBeInTheDocument();
    fireEvent.click(triggerBtn);

    // Dialog opens
    await waitFor(() => {
      expect(screen.getByTestId('correct-cost-dialog')).toBeInTheDocument();
    });

    // Fill new cost
    const costInput = screen.getByTestId('correct-cost-new-input');
    fireEvent.change(costInput, { target: { value: '12000' } });

    // Fill reason (min 5 chars)
    const reasonInput = screen.getByTestId('correct-cost-reason-input');
    fireEvent.change(reasonInput, { target: { value: 'Bulk purchase discount applied' } });

    // Submit
    const submitBtn = screen.getByTestId('correct-cost-submit');
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledOnce();
    });

    const [callArg] = rpcMock.mock.calls[0] as [{ newCost: number; reason: string; idempotencyKey: string }];

    expect(callArg.newCost).toBe(12_000);
    expect(callArg.reason).toBe('Bulk purchase discount applied');

    // idempotencyKey must be a valid UUID v4
    expect(callArg.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
