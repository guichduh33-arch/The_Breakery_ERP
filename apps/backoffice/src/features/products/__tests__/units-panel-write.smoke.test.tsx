// apps/backoffice/src/features/products/__tests__/units-panel-write.smoke.test.tsx
//
// Session 39 — Wave B1 — UnitsPanel write-mode smoke tests.
//
// Asserts:
//   T1: renders with mocked query data (2 real alts) — no SAMPLE data.
//   T2: editing a factor enables Save, click fires set_product_units_v1 with
//       ALL draft alts (REPLACE semantics) + contexts.
//   T3: without products.units.update perm → inputs disabled / no active Save.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { UnitsPanel } from '../components/UnitsPanel.js';
import type { ProductRow } from '../types.js';

// ── Hoisted shared state (available when vi.mock factories execute) ────────────
// IMPORTANT: The mock data objects MUST be defined here (in vi.hoisted) so they
// have stable references across renders. If defined inside the vi.mock factory,
// a new object is returned on every render call, causing useEffect (which
// depends on `data` by reference) to fire in an infinite loop → worker crash.

const { mockState, mutateMock, MOCK_DATA } = vi.hoisted(() => {
  const mutateMock = vi.fn();
  const mockState = { hasPerm: true, isPending: false };

  // Stable reference objects — created once, reused across renders.
  const MOCK_DATA = {
    alternatives: [
      { code: 'kg', factor_to_base: 1,     tags: [] as string[],           display_order: 0  },
      { code: 'g',  factor_to_base: 0.001, tags: ['purchase'] as string[], display_order: 10 },
    ],
    contexts: {
      stock_opname_unit: 'pcs',
      recipe_unit:       'g',
      purchase_unit:     'kg',
      sales_unit:        'pcs',
    },
  };

  return { mockState, mutateMock, MOCK_DATA };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ hasPermission: (_code: string) => mockState.hasPerm }),
}));

vi.mock('@/features/products/hooks/useProductUnits.js', () => ({
  useProductUnits: (_id: string) => ({
    // Stable reference: MOCK_DATA is created once in vi.hoisted, not recreated
    // on every render call. This prevents useEffect infinite-loop.
    data: MOCK_DATA,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/features/products/hooks/useSetProductUnits.js', () => ({
  useSetProductUnits: (_id: string) => ({
    mutate: mutateMock,
    isPending: mockState.isPending,
  }),
}));

// ── Product fixture ───────────────────────────────────────────────────────────

const PRODUCT: ProductRow = {
  id:                   'prod-1',
  name:                 'Flour 1kg',
  sku:                  'FL-1KG',
  category_id:          'cat-1',
  category_name:        'Ingredients',
  category_type:        'raw_material',
  cost_price:           5000,
  retail_price:         12000,
  wholesale_price:      null,
  unit:                 'pcs',
  min_stock_threshold:  5,
  current_stock:        20,
  is_active:            true,
  is_favorite:          false,
  image_url:            null,
  product_type:         'finished',
  allergens:            [],
  description:          null,
  visible_on_pos:       true,
  available_for_sale:   true,
  track_inventory:      true,
  deduct_stock:         true,
  is_semi_finished:     false,
  target_gross_margin_pct: null,
  default_shelf_life_hours: null,
  is_display_item:      false,
  parent_product_id:    null,
  variant_label:        null,
  variant_axis:         null,
  variant_sort_order:   0,
  dispatch_stations:    null,
};

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UnitsPanel product={PRODUCT} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UnitsPanel — write-mode [S39 WB1]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.hasPerm  = true;
    mockState.isPending = false;
  });

  it('T1: renders real alt unit codes from query data — no SAMPLE_ALT_UNITS', () => {
    renderPanel();

    // Real codes from mocked query — use getAllByDisplayValue since 'kg' appears
    // in both the code text-input and the purchase_unit context select.
    expect(screen.getAllByDisplayValue('kg').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByDisplayValue('g').length).toBeGreaterThanOrEqual(1);

    // factor_to_base inputs: 2 alts — verify values present
    const spinButtons = screen.getAllByRole('spinbutton');
    const values = spinButtons.map((el) => (el as HTMLInputElement).value);
    expect(values).toContain('1');
    expect(values).toContain('0.001');

    // "no SAMPLE data" guard — old stub had 'gr' code among 3 rows
    const textInputs = screen.getAllByRole('textbox');
    const codes = textInputs.map((el) => (el as HTMLInputElement).value);
    expect(codes).not.toContain('gr');
    // Only 2 non-empty code text-inputs (the alt unit code fields)
    expect(codes.filter((c) => c !== '')).toHaveLength(2);
  });

  it('T2: editing a factor enables Save and fires set_product_units_v1 with all alts + contexts', async () => {
    renderPanel();

    // Save button is initially disabled (not dirty)
    const saveBtn = screen.getByTestId('units-save-btn');
    expect(saveBtn).toBeDisabled();

    // Edit the factor of the first alt (kg → 1.5)
    const factorInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(factorInputs[0]!, { target: { value: '1.5' } });

    // Save should now be enabled (dirty)
    await waitFor(() => {
      expect(saveBtn).not.toBeDisabled();
    });

    fireEvent.click(saveBtn);

    expect(mutateMock).toHaveBeenCalledOnce();
    const [callPayload] = mutateMock.mock.calls[0] as [{ alts: unknown[]; contexts: unknown }];

    // REPLACE semantics: ALL alts sent (2 rows)
    expect((callPayload.alts).length).toBe(2);

    // First alt has the updated factor
    const firstAlt = (callPayload.alts as { code: string; factor_to_base: number }[])[0]!;
    expect(firstAlt.code).toBe('kg');
    expect(firstAlt.factor_to_base).toBe(1.5);

    // Second alt unchanged
    const secondAlt = (callPayload.alts as { code: string; factor_to_base: number }[])[1]!;
    expect(secondAlt.code).toBe('g');
    expect(secondAlt.factor_to_base).toBe(0.001);

    // Contexts present
    expect(callPayload.contexts).toMatchObject({
      stock_opname_unit: 'pcs',
      recipe_unit:       'g',
      purchase_unit:     'kg',
      sales_unit:        'pcs',
    });
  });

  it('T3: without products.units.update perm → inputs disabled and no active Save', () => {
    mockState.hasPerm = false;
    renderPanel();

    // All text inputs (code fields) must be disabled
    const textInputs = screen.getAllByRole('textbox');
    for (const input of textInputs) {
      expect(input).toBeDisabled();
    }

    // All number inputs (factor fields) must be disabled
    const spinButtons = screen.getAllByRole('spinbutton');
    for (const btn of spinButtons) {
      expect(btn).toBeDisabled();
    }

    // Save button must not be rendered (canWrite = false hides the whole bar)
    expect(screen.queryByTestId('units-save-btn')).not.toBeInTheDocument();

    // Context selects must be disabled
    const select = screen.getByTestId('context-select-stock_opname_unit');
    expect(select).toBeDisabled();
  });
});
