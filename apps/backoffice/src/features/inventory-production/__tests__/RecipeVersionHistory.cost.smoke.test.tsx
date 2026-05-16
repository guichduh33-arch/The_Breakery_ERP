// apps/backoffice/src/features/inventory-production/__tests__/RecipeVersionHistory.cost.smoke.test.tsx
// Session 16 / Phase 2.B — RecipeVersionHistory cost display smoke.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecipeVersionHistory } from '../components/RecipeVersionHistory.js';
import type { RecipeVersionRow } from '../hooks/useRecipeVersions.js';

const MOCK_ROWS: RecipeVersionRow[] = [
  {
    id: 'v2',
    product_id: 'p1',
    version_number: 2,
    snapshot: [
      { recipe_id: 'r-flour', material_id: 'm-flour', material_name: 'Flour',
        quantity: 500, unit: 'g', material_cost_price: 0.01 },
      { recipe_id: 'r-salt',  material_id: 'm-salt',  material_name: 'Salt',
        quantity: 10,  unit: 'g', material_cost_price: 0.05 },
    ],
    productCostAtVersion: 5.50,
    created_at: '2026-05-16T10:00:00Z',
    created_by: 'u1',
    created_by_name: 'Alice',
    change_note: 'Updated with cost data',
  },
  {
    id: 'v1',
    product_id: 'p1',
    version_number: 1,
    snapshot: [
      { recipe_id: 'r-flour', material_id: 'm-flour', material_name: 'Flour',
        quantity: 450, unit: 'g' },
    ],
    created_at: '2026-05-01T10:00:00Z',
    created_by: 'u1',
    created_by_name: 'Alice',
    change_note: null,
  },
];

vi.mock('../hooks/useRecipeVersions.js', () => ({
  useRecipeVersions: () => ({ data: MOCK_ROWS, isLoading: false, error: null }),
}));

describe('RecipeVersionHistory cost smoke', () => {
  it('renders cost on the new-shape version (v2)', () => {
    render(<RecipeVersionHistory productId="p1" />);
    expect(screen.getByTestId('version-cost-2')).toHaveTextContent('cost 5.50');
  });

  it('renders the legacy placeholder on v1', () => {
    render(<RecipeVersionHistory productId="p1" />);
    expect(screen.getByTestId('version-cost-1-legacy')).toHaveTextContent('cost —');
  });

  it('renders per-material subtotals on v2 rows', () => {
    render(<RecipeVersionHistory productId="p1" />);
    expect(screen.getByText('= 5.00')).toBeInTheDocument();
    expect(screen.getByText('= 0.50')).toBeInTheDocument();
  });

  it('does NOT render subtotals on v1 (legacy) rows', () => {
    render(<RecipeVersionHistory productId="p1" />);
    const allEqMatches = screen.queryAllByText(/^= /);
    expect(allEqMatches).toHaveLength(2);
  });
});
