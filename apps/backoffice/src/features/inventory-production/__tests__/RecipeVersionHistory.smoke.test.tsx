// apps/backoffice/src/features/inventory-production/__tests__/RecipeVersionHistory.smoke.test.tsx
// Session 15 — Phase 2.B — RecipeVersionHistory smoke. Mocks useRecipeVersions
// to return two versions and asserts both render with diff highlights.

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
      { recipe_id: 'r-flour', material_id: 'm-flour', material_name: 'Flour', quantity: 500, unit: 'g' },
      { recipe_id: 'r-salt',  material_id: 'm-salt',  material_name: 'Salt',  quantity: 10,  unit: 'g' },
      { recipe_id: 'r-yeast', material_id: 'm-yeast', material_name: 'Yeast', quantity: 5,   unit: 'g' },
    ],
    created_at: '2026-05-10T10:00:00Z',
    created_by: 'u1',
    created_by_name: 'Alice',
    change_note: 'Increased flour, added yeast',
  },
  {
    id: 'v1',
    product_id: 'p1',
    version_number: 1,
    snapshot: [
      { recipe_id: 'r-flour', material_id: 'm-flour', material_name: 'Flour', quantity: 450, unit: 'g' },
      { recipe_id: 'r-salt',  material_id: 'm-salt',  material_name: 'Salt',  quantity: 10,  unit: 'g' },
    ],
    created_at: '2026-05-01T10:00:00Z',
    created_by: 'u1',
    created_by_name: 'Alice',
    change_note: null,
  },
];

vi.mock('../hooks/useRecipeVersions.js', () => ({
  useRecipeVersions: () => ({
    data: MOCK_ROWS,
    isLoading: false,
    error: null,
  }),
}));

describe('RecipeVersionHistory smoke', () => {
  it('renders both versions with their version_number labels', () => {
    render(<RecipeVersionHistory productId="p1" />);
    expect(screen.getByText(/Version 2/)).toBeInTheDocument();
    expect(screen.getByText(/Version 1/)).toBeInTheDocument();
  });

  it('shows the change_note for v2 and labels v1 as Initial', () => {
    render(<RecipeVersionHistory productId="p1" />);
    expect(screen.getByText(/Increased flour, added yeast/)).toBeInTheDocument();
    expect(screen.getByText(/Initial/i)).toBeInTheDocument();
  });

  it('flags Yeast as added and Flour as changed in v2 vs v1', () => {
    render(<RecipeVersionHistory productId="p1" />);
    // V2 entry contains all three ingredients with diff kinds.
    const v2 = screen.getByLabelText('Recipe version 2');
    expect(v2.textContent ?? '').toMatch(/Yeast/);
    expect(v2.textContent ?? '').toMatch(/added/i);
    expect(v2.textContent ?? '').toMatch(/changed/i);
  });
});
