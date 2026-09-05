// apps/pos/src/features/tablet/__tests__/tablet-tap-combo.smoke.test.tsx
//
// Audit lot 1 P0 n°6 (docs/audits/2026-08-31-audit-pos-flow.md) — lot D du
// plan validé par Mamat le 2026-09-05.
//
// Cloné de apps/pos/src/features/products/__tests__/product-tap-combo.smoke.test.tsx
// (comptoir, ProductTapHandler + ComboConfigModal + cartStore.addCombo) mais
// pour la tablette : `TabletProductGrid` n'a AUCUNE branche combo — un combo
// tapé tombe dans l'auto-ajout nu (`addItem`), et `tabletCartStore` n'a pas
// d'`addCombo`. Ces deux tests sont ROUGES jusqu'à la passe POS qui ajoute la
// branche combo + `useTabletCartStore.addCombo` (miroir de
// `cartStore.addCombo`, apps/pos/src/stores/cartStore.ts:135-140, 285-293).
//
//   T1. Taper la tuile combo ouvre ComboConfigModal (le libellé du groupe
//       s'affiche).
//   T2. Confirmer la modale écrit une ligne `product_type: 'combo'` avec
//       `combo_components` = composants choisis et `unit_price` = base_price
//       dans le VRAI useTabletCartStore (pas un spy — on veut prouver que
//       l'action existe et écrit la bonne forme).
//
// Le store réel est réinitialisé dans beforeEach (persist + sessionStorage
// jsdom) — pas de mock de useTabletCartStore, contrairement au clone comptoir
// qui mocke cartStore : c'est justement l'ABSENCE d'addCombo sur ce store
// qu'on veut voir échouer en rouge, pas une façade qui la simule.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComboDefinition } from '@breakery/domain';
import { useTabletCartStore } from '@/stores/tabletCartStore';

// ---------------------------------------------------------------------------
// All mock data in vi.hoisted so vi.mock factories can reference them safely
// (project memory: project_vitest_hoisted_mock_data / DEV-S39-B1-01).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const COMBO_PRODUCT = {
    id: 'prod-tablet-combo-001',
    sku: 'TABLET-COMBO-001',
    name: 'Tablet Breakfast Set',
    category_id: 'cat-bev',
    retail_price: 75000,
    wholesale_price: null,
    product_type: 'combo' as const,
    image_url: null,
    current_stock: 99,
    is_active: true,
    is_favorite: false,
    parent_product_id: null,
    has_variants: false,
  };

  const COMBO_DEF = {
    combo_product_id: 'prod-tablet-combo-001',
    name: 'Tablet Breakfast Set',
    base_price: 75000,
    groups: [
      {
        id: 'g-tablet-1',
        name: 'Choose a drink',
        group_type: 'single' as const,
        is_required: true,
        min_select: 1,
        max_select: 1,
        sort_order: 0,
        options: [
          {
            id: 'opt-amer-tablet',
            component_product_id: 'prod-amer-tablet',
            label: 'Americano',
            surcharge: 0,
            is_default: true,
            sort_order: 0,
          },
        ],
      },
    ],
  };

  // Objet mutable : beforeEach ne fait que remplacer .data pour préserver
  // l'identité de reference (useEffect dep sur `def` dans ComboConfigModal).
  const comboQuery = {
    isLoading: false,
    isSuccess: true,
    data: COMBO_DEF as ComboDefinition | undefined,
  };

  return { COMBO_PRODUCT, COMBO_DEF, comboQuery };
});

// ---------------------------------------------------------------------------
// Mocks — chemins d'import lus depuis TabletProductGrid.tsx.
// ---------------------------------------------------------------------------

vi.mock('@/features/combos/hooks/useComboConfig', () => ({
  useComboConfig: (_id: string) => mocks.comboQuery,
}));

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: [mocks.COMBO_PRODUCT], isLoading: false, isSuccess: true, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/features/products/hooks/useCategories', () => ({
  useCategories: () => ({ data: [], isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/products/hooks/useActiveLotsByProduct', () => ({
  useActiveLotsByProduct: () => ({ data: new Map(), isLoading: false, isSuccess: true }),
}));

vi.mock('@/features/products/hooks/useProductModifiers', () => ({
  useProductModifiers: () => ({ data: [], isLoading: false, isSuccess: true }),
}));

// ---------------------------------------------------------------------------
// Module import (après l'enregistrement des mocks).
// ---------------------------------------------------------------------------
import { TabletProductGrid } from '../components/TabletProductGrid';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TabletProductGrid — combo flow (audit lot 1 P0 n°6, lot D)', () => {
  beforeEach(() => {
    // Panier réel réinitialisé — pas un spy, le VRAI store de la tablette.
    useTabletCartStore.setState({ items: [] });
    mocks.comboQuery.data = mocks.COMBO_DEF;
    mocks.comboQuery.isLoading = false;
    mocks.comboQuery.isSuccess = true;
  });

  afterEach(() => {
    cleanup();
  });

  it(
    'T1: tapping a combo tile opens ComboConfigModal with the group label',
    async () => {
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <TabletProductGrid selectedSlug={null} />
        </Wrapper>,
      );

      fireEvent.click(screen.getByTestId('product-card-prod-tablet-combo-001'));

      // ROUGE attendu : TabletProductGrid n'a pas de branche combo — le tap
      // tombe dans l'auto-ajout nu (addItem), ComboConfigModal ne s'ouvre
      // jamais et « Choose a drink » n'apparaît pas.
      await screen.findByText('Choose a drink', {}, { timeout: 18000 });
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    },
    20000,
  );

  it(
    'T2: confirming the modal writes a combo cart line via useTabletCartStore',
    async () => {
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <TabletProductGrid selectedSlug={null} />
        </Wrapper>,
      );

      fireEvent.click(screen.getByTestId('product-card-prod-tablet-combo-001'));
      await screen.findByText('Choose a drink', {}, { timeout: 18000 });

      const confirmBtn = screen.getByRole('button', { name: /confirm/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => expect(useTabletCartStore.getState().items.length).toBeGreaterThan(0));

      const line = useTabletCartStore.getState().items[0];
      // ROUGE attendu : sans addCombo, la ligne (si elle existe via
      // l'auto-ajout nu) ne porte ni product_type: 'combo' ni
      // combo_components — c'est exactement le P0.
      expect(line?.product_type).toBe('combo');
      expect(line?.combo_components).toEqual([{ product_id: 'prod-amer-tablet', quantity: 1 }]);
      expect(line?.unit_price).toBe(75000);
    },
    20000,
  );
});
