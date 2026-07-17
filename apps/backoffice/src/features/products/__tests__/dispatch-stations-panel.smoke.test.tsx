// apps/backoffice/src/features/products/__tests__/dispatch-stations-panel.smoke.test.tsx
//
// Spec B-1 Ph2 — Task 11 — Override dispatch-station par produit (BO).
//
// Teste la section "Dispatch Routing" de GeneralPanel :
//   T1 : dispatch_stations: null → les 3 cases sont décochées + label "inherit" visible.
//   T2 : Cocher 'kitchen' → onChange({ dispatch_stations: ['kitchen'] }).
//   T3 : Cocher 'kitchen' puis 'display' → dernier onChange({ dispatch_stations: ['kitchen','display'] }).
//   T4 : Prépopulé ['kitchen','display'], décocher les deux → dernier onChange({ dispatch_stations: null }).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GeneralPanel } from '../components/GeneralPanel.js';
import type { ProductRow, CategoryOption } from '../types.js';

// ── Fixture ────────────────────────────────────────────────────────────────────

const BASE_PRODUCT: ProductRow = {
  id:                        'p1',
  name:                      'Sandwich Poulet',
  sku:                       'SAN-POU',
  category_id:               'c1',
  category_name:             'Sandwichs',
  category_type:             'finished',
  cost_price:                0,
  retail_price:              35_000,
  wholesale_price:           null,
  unit:                      'pcs',
  min_stock_threshold:       0,
  current_stock:             0,
  is_active:                 true,
  is_favorite:               false,
  image_url:                 null,
  product_type:              'finished',
  allergens:                 [],
  description:               null,
  visible_on_pos:            true,
  available_for_sale:        true,
  track_inventory:           false,
  deduct_stock:              false,
  is_semi_finished:          false,
  target_gross_margin_pct:   null,
  default_shelf_life_hours:  null,
  is_display_item:           false,
  parent_product_id:         null,
  variant_label:             null,
  variant_axis:              null,
  variant_sort_order:        0,
  dispatch_stations:         null,
};

const CATEGORIES: ReadonlyArray<CategoryOption> = [
  { id: 'c1', name: 'Sandwichs', slug: 'sandwichs', is_active: true, sort_order: 1 },
];

// ── Helper ─────────────────────────────────────────────────────────────────────

function renderPanel(product: ProductRow, onChange = vi.fn()) {
  return {
    onChange,
    ...render(
      <MemoryRouter>
        <GeneralPanel
          product={product}
          categories={CATEGORIES}
          readOnly={false}
          onChange={onChange}
        />
      </MemoryRouter>,
    ),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GeneralPanel — dispatch-station override [Spec B-1 Ph2 / Task 11]', () => {
  it('T1: null → les 3 cases sont décochées et le label inherit est visible', () => {
    renderPanel(BASE_PRODUCT);

    const kitchenCb = screen.getByTestId('dispatch-station-kitchen') as HTMLInputElement;
    const baristaCb = screen.getByTestId('dispatch-station-barista') as HTMLInputElement;
    const displayCb = screen.getByTestId('dispatch-station-display') as HTMLInputElement;

    expect(kitchenCb.checked).toBe(false);
    expect(baristaCb.checked).toBe(false);
    expect(displayCb.checked).toBe(false);

    // Label indique l'héritage depuis la catégorie.
    expect(screen.getByTestId('dispatch-inherit-label')).toBeInTheDocument();
  });

  it('T2: cocher kitchen → onChange({ dispatch_stations: ["kitchen"] })', () => {
    const { onChange } = renderPanel(BASE_PRODUCT);

    const kitchenCb = screen.getByTestId('dispatch-station-kitchen');
    fireEvent.click(kitchenCb);

    expect(onChange).toHaveBeenCalledWith({ dispatch_stations: ['kitchen'] });
  });

  it('T3: cocher kitchen puis display → dernier onChange contient les deux stations', async () => {
    const { onChange } = renderPanel(BASE_PRODUCT);

    const kitchenCb = screen.getByTestId('dispatch-station-kitchen');
    const displayCb = screen.getByTestId('dispatch-station-display');

    fireEvent.click(kitchenCb);

    // Attendre que le state soit mis à jour avant le 2ᵉ clic.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ dispatch_stations: ['kitchen'] }),
    );

    fireEvent.click(displayCb);

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)![0] as { dispatch_stations: string[] };
      expect(lastCall.dispatch_stations).toEqual(expect.arrayContaining(['kitchen', 'display']));
      expect(lastCall.dispatch_stations).toHaveLength(2);
    });
  });

  it('T4: prépopulé ["kitchen","display"], décocher les deux → onChange({ dispatch_stations: null })', async () => {
    const product: ProductRow = { ...BASE_PRODUCT, dispatch_stations: ['kitchen', 'display'] };
    const { onChange } = renderPanel(product);

    const kitchenCb = screen.getByTestId('dispatch-station-kitchen') as HTMLInputElement;
    const displayCb = screen.getByTestId('dispatch-station-display') as HTMLInputElement;

    // Vérifier l'état initial prépopulé.
    expect(kitchenCb.checked).toBe(true);
    expect(displayCb.checked).toBe(true);

    fireEvent.click(kitchenCb);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ dispatch_stations: ['display'] }),
    );

    fireEvent.click(displayCb);
    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)![0];
      expect(lastCall).toEqual({ dispatch_stations: null });
    });
  });
});
