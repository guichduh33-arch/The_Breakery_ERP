import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoProductRow } from '@/features/purchasing/hooks/useAllProductsForPO.js';
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), products: [] as PoProductRow[] }));
vi.mock('@/features/purchasing/hooks/useAllProductsForPO.js', () => ({ useAllProductsForPO: () => ({ data: mocks.products }) }));
vi.mock('../hooks/useInventoryReferenceData.js', () => ({ useInventoryReferenceData: () => ({ data: { suppliers: [{ id: 'supplier', name: 'Supplier', code: 'S' }] } }) }));
vi.mock('../hooks/useRecordDirectPurchase.js', async (original) => ({
  ...await original<object>(), useRecordDirectPurchase: () => ({ mutateAsync: mocks.mutate, isPending: false, progress: { poId: 'po-1', poNumber: 'PO-1' } }),
}));
import DirectPurchaseForm from '../components/DirectPurchaseForm.js';

describe('achat direct — prix et reprise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.products = [{ id: 'product', sku: 'FLOUR', name: 'Flour', unit: 'kg', cost_price: 10000,
      defaultPurchaseUnit: 'bag', unitOptions: [{ code: 'kg', factor: 1 }, { code: 'bag', factor: 25 }, { code: 'half', factor: 0.5 }] }];
  });
  function selectProduct() {
    fireEvent.focus(screen.getByRole('combobox', { name: 'Product' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: /Flour/ }));
  }
  it.each([['kg', 10000], ['bag', 250000], ['half', 5000]])('préremplit le coût pour %s', (unit, expected) => {
    mocks.products[0]!.defaultPurchaseUnit = unit;
    render(<DirectPurchaseForm />); selectProduct();
    expect(screen.getByLabelText('Price / unit')).toHaveValue(expected);
  });
  it('convertit un prix saisi selon le ratio des unités', () => {
    render(<DirectPurchaseForm />); selectProduct();
    fireEvent.change(screen.getByLabelText('Price / unit'), { target: { value: '300000' } });
    fireEvent.change(screen.getByLabelText('Purchase unit'), { target: { value: 'kg' } });
    expect(screen.getByLabelText('Price / unit')).toHaveValue(12000);
    fireEvent.change(screen.getByLabelText('Purchase unit'), { target: { value: 'half' } });
    expect(screen.getByLabelText('Price / unit')).toHaveValue(6000);
  });
  it('verrouille les champs et réessaie avec la même clé et le même contenu après erreur', async () => {
    mocks.mutate.mockRejectedValue(new Error('response lost'));
    render(<DirectPurchaseForm />); selectProduct();
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'supplier' } });
    fireEvent.click(screen.getByLabelText('Unpaid (credit)'));
    fireEvent.click(screen.getByRole('button', { name: 'Record purchase' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Quantity')).toBeDisabled();
    expect(screen.getByLabelText('Price / unit')).toBeDisabled();
    expect(screen.getByLabelText('Supplier')).toBeDisabled();
    expect(screen.getByText(/Order confirmed: PO-1/)).toBeInTheDocument();
    const original: unknown = mocks.mutate.mock.calls[0]?.[0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry purchase' }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    expect(mocks.mutate.mock.calls[1]?.[0]).toEqual(original);
  });
});
