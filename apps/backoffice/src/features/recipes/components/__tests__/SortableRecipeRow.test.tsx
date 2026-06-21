import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { SortableRecipeRow } from '../SortableRecipeRow.js';
import type { RecipeRow } from '@breakery/domain';

const ROW: RecipeRow = {
  recipe_id: 'r1', product_id: 'p1', product_name: 'Bread', product_unit: 'pcs',
  material_id: 'm1', material_name: 'Flour', material_unit: 'kg',
  material_cost_price: 12000, quantity: 500, unit: 'gr', is_active: true, notes: null,
};

function renderRow(readOnly: boolean, onRemove = vi.fn()) {
  return render(
    <table><DndContext><SortableContext items={['r1']}>
      <tbody>
        <SortableRecipeRow row={ROW} readOnly={readOnly} isRemoving={false} onRemove={onRemove} />
      </tbody>
    </SortableContext></DndContext></table>,
  );
}

describe('SortableRecipeRow', () => {
  it('shows the material, quantity, unit and a drag handle + remove when editable', () => {
    renderRow(false);
    expect(screen.getByText('Flour')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('gr')).toBeInTheDocument();
    expect(screen.getByLabelText('Drag Flour')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Flour')).toBeInTheDocument();
  });

  it('hides the drag handle and remove button in readOnly mode', () => {
    renderRow(true);
    expect(screen.getByText('Flour')).toBeInTheDocument();
    expect(screen.queryByLabelText('Drag Flour')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove Flour')).not.toBeInTheDocument();
  });
});
