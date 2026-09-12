import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProductionEntryCard } from '../components/ProductionEntryCard.js';
import { validateProductionEntry, type EntryRow } from '../productionEntryValidation.js';

const mutate = vi.fn();
const products = [
  { id: 'a', sku: 'A', name: 'Bread', unit: 'pcs', current_stock: 0, product_type: 'finished', units: [{ code: 'pcs', factor_to_base: 1 }, { code: 'dozen', factor_to_base: 12 }] },
  { id: 'b', sku: 'B', name: 'Bun', unit: 'pcs', current_stock: 0, product_type: 'finished', units: [{ code: 'pcs', factor_to_base: 1 }] },
];
vi.mock('../hooks/useProducibleProductsBySection.js', () => ({
  useProducibleProductsBySection: () => ({ data: products, isLoading: false }),
}));
vi.mock('../hooks/useRecordBatchProduction.js', () => ({
  useRecordBatchProduction: () => ({ mutate, isPending: false }),
  RecordBatchProductionError: class extends Error {},
}));
vi.mock('../components/IngredientAggregatePreview.js', () => ({
  IngredientAggregatePreview: () => null,
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (select: (state: { hasPermission: () => boolean }) => unknown) => select({ hasPermission: () => true }),
}));

function setup() {
  render(<ProductionEntryCard sectionId="station-1" sectionName="Bakery" selectedDate={new Date('2026-09-12T08:00:00Z')} />);
  for (const name of ['Bread', 'Bun']) {
    const search = screen.getByTestId('production-search');
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: name } });
    fireEvent.mouseDown(screen.getByRole('option', { name: new RegExp(name) }));
  }
}

describe('production validates the whole entry', () => {
  beforeEach(() => { mutate.mockReset(); });

  it.each(['', '0', '-1', '1.0001'])('blocks a partial batch with invalid quantity %s', (quantity) => {
    setup();
    fireEvent.change(screen.getByLabelText('Quantity for Bun'), { target: { value: quantity } });
    const submit = screen.getByTestId('submit-production');
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Bun:');
    expect(screen.getByTestId('entry-row-A')).toBeInTheDocument();
    expect(screen.getByTestId('entry-row-B')).toBeInTheDocument();
  });

  it('blocks negative waste and a blank date before creating a payload', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Waste for Bun'), { target: { value: '-1' } });
    expect(screen.getByTestId('submit-production')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('waste must be');
    fireEvent.change(screen.getByLabelText('Waste for Bun'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('production-datetime'), { target: { value: '' } });
    expect(screen.getByTestId('submit-production')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('valid production date');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('sends every line after correction and keeps the unit conversion', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Quantity for Bun'), { target: { value: '' } });
    expect(screen.getByTestId('submit-production')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Quantity for Bun'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Quantity for Bread'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Unit for Bread'), { target: { value: 'dozen' } });
    fireEvent.click(screen.getByTestId('submit-production'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      items: [{ productId: 'a', quantityProduced: 24 }, { productId: 'b', quantityProduced: 3 }],
    });
  });

  it('rejects nonfinite waste and an invalid factor at the validation boundary', () => {
    const row = {
      rowId: 'r', product: products[0], quantity: '1', unitCode: 'pcs', waste: 'Infinity', wasteReason: '', note: '',
    } as EntryRow;
    expect(validateProductionEntry([row], '2026-09-12T08:00').error).toMatch(/waste must/);
    expect(validateProductionEntry([{ ...row, waste: '0', unitCode: 'missing' }], '2026-09-12T08:00').error).toMatch(/valid unit/);
  });
});
