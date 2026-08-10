// apps/backoffice/src/features/inventory-production/__tests__/production-preview-base-unit.test.tsx
//
// L'aperçu de faisabilité vit désormais dans ProductionEntryCard, dont les
// lignes portent une quantité dans l'unité CHOISIE (« 2 dozen »), pas dans
// l'unité de base. Le BOM, lui, est résolu par unité de base : passer la
// quantité saisie telle quelle sous-estimerait le besoin du facteur de
// conversion — un aperçu « OK » suivi d'un refus serveur.
//
// Ce test fige la conversion : 2 dozen (facteur 12) = 24 pcs, et 0,05 kg de
// farine par pièce doit s'afficher 1,2 kg — pas 0,1.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductionEntryCard } from '../components/ProductionEntryCard.js';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

const mockRpc = vi.fn();
const resolvers: Record<string, () => { data: unknown; error: unknown }> = {};

vi.mock('@/lib/supabase.js', () => {
  const methods = ['select', 'eq', 'in', 'is', 'order', 'gte', 'lte', 'limit'] as const;
  function makeChain(table: string) {
    const resolve = () => (resolvers[table] ?? (() => ({ data: [], error: null })))();
    const chain: Record<string, unknown> = {};
    for (const m of methods) chain[m] = () => chain;
    (chain as { then: unknown }).then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR);
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      rpc: (fn: string, args: unknown) =>
        Promise.resolve(mockRpc(fn, args) as { data: unknown; error: unknown }),
    },
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

/** 0,05 kg de farine par pièce produite, 10 kg en stock. */
const FLOUR_LEAF = {
  material_id:   'm-flour',
  material_name: 'Flour',
  material_unit: 'kg',
  recipe_unit:   'kg',
  qty_per_unit:  0.05,
  qty_in_base:   0.05,
  current_stock: 10,
  cost_price:    0,
  line_cost:     0,
};

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProductionEntryCard sectionId="st-1" sectionName="Pastry" selectedDate={new Date('2026-08-10T08:00:00Z')} />
    </QueryClientProvider>,
  );
}

async function addBaguetteRow(): Promise<void> {
  fireEvent.focus(screen.getByTestId('production-search'));
  fireEvent.change(screen.getByTestId('production-search'), { target: { value: 'Bag' } });
  const option = await screen.findByText('Baguette');
  fireEvent.mouseDown(option);
  await waitFor(() => {
    expect(screen.getByTestId('entry-row-SKU-BAG')).toBeInTheDocument();
  });
}

/** Texte de la ligne « Flour » du tableau de l'aperçu. */
function flourRowText(): string {
  const cell = screen.getByText('Flour');
  return cell.closest('tr')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('Aperçu de faisabilité dans ProductionEntryCard', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockImplementation((fn: string) =>
      fn === 'recipe_bom_full_v2'
        ? { data: [FLOUR_LEAF], error: null }
        : { data: null, error: { message: 'unexpected rpc' } },
    );
    resolvers.product_sections = () => ({ data: [{ product_id: 'p-bag' }], error: null });
    resolvers.products = () => ({
      data: [{ id: 'p-bag', sku: 'SKU-BAG', name: 'Baguette', unit: 'pcs', current_stock: 0, product_type: 'finished' }],
      error: null,
    });
    resolvers.recipes = () => ({ data: [{ product_id: 'p-bag' }], error: null });
    resolvers.product_unit_alternatives = () => ({
      data: [{ product_id: 'p-bag', code: 'dozen', factor_to_base: 12, display_order: 1 }],
      error: null,
    });
  });

  it('reste absent tant qu\'aucune ligne n\'est saisie', () => {
    renderCard();
    expect(screen.queryByTestId('ingredient-aggregate-preview')).not.toBeInTheDocument();
  });

  it('affiche le besoin agrégé dès la première ligne, avant toute soumission', async () => {
    renderCard();
    await addBaguetteRow();

    await waitFor(() => {
      expect(screen.getByTestId('ingredient-aggregate-preview')).toBeInTheDocument();
    });
    // Quantité par défaut : 1 pcs → 0,05 kg.
    await waitFor(() => {
      expect(flourRowText()).toMatch(/0\.05 kg/);
    });
    expect(mockRpc).toHaveBeenCalledWith('recipe_bom_full_v2', { p_product_id: 'p-bag', p_max_depth: 5 });
    expect(screen.getByTestId('status-ok')).toBeInTheDocument();
  });

  it('convertit la quantité saisie dans l\'unité de base (2 dozen = 24 pcs)', async () => {
    renderCard();
    await addBaguetteRow();

    fireEvent.change(screen.getByLabelText('Unit for Baguette'), { target: { value: 'dozen' } });
    fireEvent.change(screen.getByLabelText('Quantity for Baguette'), { target: { value: '2' } });

    // 2 × 12 × 0,05 = 1,2 kg — et non 2 × 0,05 = 0,1.
    await waitFor(() => {
      expect(flourRowText()).toMatch(/1\.2 kg/);
    });
    expect(flourRowText()).not.toMatch(/0\.1 kg/);
  });

  it('compte le raté dans le besoin et signale la pénurie avant le serveur', async () => {
    renderCard();
    await addBaguetteRow();

    // 30 dozen = 360 pcs → 18 kg de farine pour 10 kg en stock.
    fireEvent.change(screen.getByLabelText('Unit for Baguette'), { target: { value: 'dozen' } });
    fireEvent.change(screen.getByLabelText('Quantity for Baguette'), { target: { value: '30' } });

    await waitFor(() => {
      expect(screen.getByTestId('status-short')).toBeInTheDocument();
    });
    expect(flourRowText()).toMatch(/18 kg/);
    expect(screen.getByText(/One or more ingredients are short/i)).toBeInTheDocument();

    // Le raté est exprimé dans l'unité de base : +40 pcs → 20 kg.
    fireEvent.change(screen.getByLabelText('Waste for Baguette'), { target: { value: '40' } });
    await waitFor(() => {
      expect(flourRowText()).toMatch(/20 kg/);
    });
  });
});
