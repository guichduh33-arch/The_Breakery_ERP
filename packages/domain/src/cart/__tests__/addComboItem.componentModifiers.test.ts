// packages/domain/src/cart/__tests__/addComboItem.componentModifiers.test.ts
//
// ADR-017 — deux combos identiques dont un COMPOSANT est configuré différemment
// (un café chaud, un café glacé) sont deux lignes distinctes.
//
// La signature de ligne ne regardait que le produit et les modifiers de la
// LIGNE — c'est-à-dire les options du combo. Or « Capuccino / Hot » et
// « Capuccino / Iced » choisissent la même option : sans prise en compte des
// modificateurs portés par les composants, les deux fusionneraient en une ligne
// de quantité 2, et la cuisine ne recevrait qu'une seule préparation.
import { describe, it, expect } from 'vitest';
import { addComboItem } from '../mutations.js';
import type { Cart, ComboComponent, Product } from '../../types/index.js';
import type { SelectedModifiers } from '../../modifiers/types.js';

const empty: Cart = { items: [], order_type: 'take_out' };

const combo: Product = {
  id: 'p-combo',
  sku: 'CB-1',
  name: 'test',
  category_id: 'cat',
  retail_price: 50000,
  wholesale_price: 0,
  product_type: 'combo',
  image_url: null,
  current_stock: 0,
  is_active: true,
  is_favorite: false,
  parent_product_id: null,
  has_variants: false,
};

/** Les options du combo — identiques dans les deux configurations comparées. */
const comboOptions: SelectedModifiers = [
  { group_name: 'drink', option_label: 'Capuccino', price_adjustment: 0 },
];

function components(temp: string, adj = 0): ComboComponent[] {
  return [
    { product_id: 'p-capuccino', quantity: 1, modifiers: [
      { group_name: 'HOT/ICED', option_label: temp, price_adjustment: adj },
    ] },
  ];
}

describe('addComboItem — les modificateurs de composants distinguent les lignes', () => {
  it('deux temperatures differentes => deux lignes', () => {
    const c1 = addComboItem(empty, combo, comboOptions, components('Hot'), 1, 50000);
    const c2 = addComboItem(c1, combo, comboOptions, components('Iced'), 1, 50000);
    expect(c2.items).toHaveLength(2);
    expect(c2.items.every((i) => i.quantity === 1)).toBe(true);
  });

  it('deux configurations identiques => une seule ligne de quantite 2', () => {
    const c1 = addComboItem(empty, combo, comboOptions, components('Hot'), 1, 50000);
    const c2 = addComboItem(c1, combo, comboOptions, components('Hot'), 1, 50000);
    expect(c2.items).toHaveLength(1);
    expect(c2.items[0]?.quantity).toBe(2);
  });

  it('l ordre des modificateurs d un composant ne cree pas de ligne en double', () => {
    const a: ComboComponent[] = [{ product_id: 'p-c', quantity: 1, modifiers: [
      { group_name: 'HOT/ICED', option_label: 'Hot', price_adjustment: 0 },
      { group_name: 'Milk', option_label: 'Oat', price_adjustment: 10000 },
    ] }];
    const b: ComboComponent[] = [{ product_id: 'p-c', quantity: 1, modifiers: [
      { group_name: 'Milk', option_label: 'Oat', price_adjustment: 10000 },
      { group_name: 'HOT/ICED', option_label: 'Hot', price_adjustment: 0 },
    ] }];
    const c = addComboItem(addComboItem(empty, combo, comboOptions, a, 1, 60000), combo, comboOptions, b, 1, 60000);
    expect(c.items).toHaveLength(1);
    expect(c.items[0]?.quantity).toBe(2);
  });

  it('un composant different => deux lignes', () => {
    const a: ComboComponent[] = [{ product_id: 'p-capuccino', quantity: 1 }];
    const b: ComboComponent[] = [{ product_id: 'p-affogato', quantity: 1 }];
    const c = addComboItem(addComboItem(empty, combo, comboOptions, a, 1, 50000), combo, comboOptions, b, 1, 50000);
    expect(c.items).toHaveLength(2);
  });

  it('conserve les modificateurs du composant sur la ligne creee', () => {
    const c = addComboItem(empty, combo, comboOptions, components('Iced'), 1, 50000);
    expect(c.items[0]?.combo_components?.[0]?.modifiers).toEqual([
      { group_name: 'HOT/ICED', option_label: 'Iced', price_adjustment: 0 },
    ]);
  });
});
