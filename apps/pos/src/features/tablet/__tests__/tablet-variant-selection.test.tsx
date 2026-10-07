import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ModifierGroup, Product } from '@breakery/domain';
import type { POSVariantRow } from '@/features/products/hooks/useProductVariants';
import { useTabletCartStore } from '@/stores/tabletCartStore';

const mocks = vi.hoisted(() => ({
  parent: {
    id: 'juice-parent', name: 'Fresh Juice', sku: 'JUICE-PARENT',
    category_id: 'drinks', retail_price: 30000, wholesale_price: null,
    product_type: 'finished', image_url: null, current_stock: 0,
    is_active: true, is_favorite: false, has_variants: true,
  } satisfies Product,
  variants: [] as POSVariantRow[],
  groups: [] as ModifierGroup[],
  modifiers: vi.fn(),
}));
vi.mock('@/features/products/hooks/useProducts', () => ({ useProducts: () => ({ data: [mocks.parent] }) }));
vi.mock('@/features/products/hooks/useCategories', () => ({ useCategories: () => ({ data: [] }) }));
vi.mock('@/features/products/hooks/useActiveLotsByProduct', () => ({ useActiveLotsByProduct: () => ({ data: new Map() }) }));
vi.mock('@/features/products/hooks/usePrefetchProductModifiers', () => ({ usePrefetchProductModifiers: () => undefined }));
vi.mock('@/features/products/hooks/useProductVariants', () => ({ useProductVariants: () => ({ data: mocks.variants }) }));
vi.mock('@/features/products/hooks/useProductModifiers', () => ({
  useProductModifiers: (args: unknown) => { mocks.modifiers(args); return { data: mocks.groups, isSuccess: true }; },
}));
vi.mock('@/features/combos/components/ComboConfigModal', () => ({ ComboConfigModal: () => null }));
import { TabletProductGrid } from '../components/TabletProductGrid';

const orange: POSVariantRow = {
  id: 'orange', name: 'Fresh Juice Orange', retail_price: 45000,
  variant_label: 'Orange', variant_axis: 'flavor', variant_sort_order: 10,
  is_active: true, current_stock: 0, deduct_stock: false,
};
const apple: POSVariantRow = { ...orange, id: 'apple', name: 'Fresh Juice Apple', variant_label: 'Apple', retail_price: 40000 };

function openParent() {
  render(<StrictMode><TabletProductGrid selectedSlug={null} /></StrictMode>);
  fireEvent.click(screen.getByTestId('product-card-juice-parent'));
}

describe('sélection des variantes depuis la tablette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTabletCartStore.getState().clearCart();
    mocks.variants = [orange, apple];
    mocks.groups = [];
  });

  it('ouvre le sélecteur sans ajouter le parent au panier', () => {
    openParent();
    expect(screen.getByRole('dialog', { name: 'Fresh Juice' })).toBeInTheDocument();
    expect(screen.getByTestId('variant-tile-orange')).toBeEnabled();
    expect(screen.getByTestId('variant-tile-apple')).toBeEnabled();
    expect(useTabletCartStore.getState().items).toEqual([]);
  });

  it('ajoute une seule fois la variante au prix enfant et résout les options dans la catégorie parent', async () => {
    openParent();
    fireEvent.click(screen.getByTestId('variant-tile-orange'));
    await waitFor(() => expect(useTabletCartStore.getState().items).toHaveLength(1));
    expect(useTabletCartStore.getState().items[0]).toMatchObject({ product_id: 'orange', name: orange.name, unit_price: 45000, quantity: 1 });
    expect(mocks.modifiers).toHaveBeenCalledWith({ productId: 'orange', categoryId: 'drinks', enabled: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exige les options de la variante avant son ajout', async () => {
    mocks.groups = [{
      group_name: 'Ice', group_sort_order: 0, group_required: true, group_type: 'single_select',
      options: [{ option_label: 'Extra ice', option_sort_order: 0, price_adjustment: 3000, is_default: false }],
    }];
    openParent();
    fireEvent.click(screen.getByTestId('variant-tile-orange'));
    expect(screen.getByRole('dialog', { name: 'Customize Fresh Juice Orange' })).toBeInTheDocument();
    expect(useTabletCartStore.getState().items).toEqual([]);
    expect(screen.getByTestId('modifier-add-to-cart')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Extra ice + Rp 3.000' }));
    fireEvent.click(screen.getByTestId('modifier-add-to-cart'));
    await waitFor(() => expect(useTabletCartStore.getState().items).toHaveLength(1));
    expect(useTabletCartStore.getState().items[0]).toMatchObject({
      product_id: 'orange', unit_price: 45000, quantity: 1,
      modifiers: [{ group_name: 'Ice', option_label: 'Extra ice', price_adjustment: 3000 }],
    });
  });

  it('préserve le choix automatique unique sans doublon sous StrictMode', async () => {
    mocks.variants = [orange];
    openParent();
    await waitFor(() => expect(useTabletCartStore.getState().items).toHaveLength(1));
    expect(useTabletCartStore.getState().items[0]).toMatchObject({ product_id: 'orange', quantity: 1 });
  });

  it('refuse une variante unique épuisée suivie en stock', () => {
    mocks.variants = [{ ...orange, deduct_stock: true }];
    openParent();
    expect(screen.getByTestId('variant-tile-orange')).toBeDisabled();
    expect(useTabletCartStore.getState().items).toEqual([]);
  });

  it('refuse une variante inactive même si le cache la contient', () => {
    mocks.variants = [{ ...orange, is_active: false }, apple];
    openParent();
    expect(screen.getByTestId('variant-tile-orange')).toBeDisabled();
    expect(useTabletCartStore.getState().items).toEqual([]);
  });

  it('annule le choix sans ajouter de ligne ni charger les options du parent', () => {
    openParent();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useTabletCartStore.getState().items).toEqual([]);
    expect(mocks.modifiers).not.toHaveBeenCalledWith(expect.objectContaining({ productId: 'juice-parent', enabled: true }));
  });
});
