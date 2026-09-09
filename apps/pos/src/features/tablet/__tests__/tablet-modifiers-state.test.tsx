import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Product } from '@breakery/domain';
const mocks = vi.hoisted(() => ({
  add: vi.fn(), refetch: vi.fn(), query: { isSuccess: false, isError: false, data: [] },
  product: { id: 'coffee', name: 'Coffee', sku: 'C', retail_price: 10000, is_active: true, current_stock: 10 } as Product,
}));
vi.mock('@/features/products/hooks/useProducts', () => ({ useProducts: () => ({ data: [mocks.product] }) }));
vi.mock('@/features/products/hooks/useCategories', () => ({ useCategories: () => ({ data: [] }) }));
vi.mock('@/features/products/hooks/useActiveLotsByProduct', () => ({ useActiveLotsByProduct: () => ({ data: new Map() }) }));
vi.mock('@/features/products/hooks/useProductModifiers', () => ({ useProductModifiers: () => ({ ...mocks.query, refetch: mocks.refetch }) }));
vi.mock('@/features/combos/components/ComboConfigModal', () => ({ ComboConfigModal: () => null }));
vi.mock('@/features/products/ProductCard', () => ({ ProductCard: ({ product, onSelect }: { product: Product; onSelect: (p: Product) => void }) => <button onClick={() => onSelect(product)}>{product.name}</button> }));
vi.mock('@/stores/tabletCartStore', () => ({ useTabletCartStore: (selector: (state: { items: never[]; addItem: typeof mocks.add }) => unknown) => selector({ items: [], addItem: mocks.add }) }));
import { TabletProductGrid } from '../components/TabletProductGrid';

describe('options tablette — attente et erreur', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.query.isSuccess = false; mocks.query.isError = false; });
  it('ouvre immédiatement un dialogue de chargement annulable sans ajouter', () => {
    render(<TabletProductGrid selectedSlug={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Coffee' }));
    expect(screen.getByRole('dialog', { name: 'Options for Coffee' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading product options');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it('affiche une erreur persistante et Retry pour le produit choisi', () => {
    mocks.query.isError = true;
    render(<TabletProductGrid selectedSlug={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Coffee' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load product options');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
