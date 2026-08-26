// apps/backoffice/src/__tests__/inventory-kpi.smoke.test.tsx
//
// Coquille de la page de stock — ADR-024, archétype LIST.
//
// Ce fichier vérifiait la bande de tuiles KPI. Elle n'existe plus : trois des
// quatre tuiles ne répondaient à aucune question et la quatrième ne comptait
// que la page affichée. Il vérifie désormais ce qui les remplace — des
// compteurs cliquables — et la propriété qui a motivé toute la décision : le
// pied reste lisible quand la liste ne ramène rien.
//
// Les hooks de données sont mockés : on n'exerce que la coquille, sans Supabase.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

// Préfixe `mock` obligatoire : vitest hisse vi.mock au-dessus des déclarations,
// et seules les variables ainsi nommées sont accessibles depuis la fabrique.
let mockRows: unknown[] = [
  {
    product_id: 'p-1', sku: 'BEV-AMER', name: 'Americano',
    category_id: null, category_name: null,
    current_stock: 5, min_stock_threshold: 10, track_inventory: true,
    unit: 'pcs', stock_value: 25_000,
    last_movement_at: null,
  },
  {
    product_id: 'p-2', sku: 'PAS-CROI', name: 'Croissant',
    category_id: null, category_name: null,
    current_stock: 50, min_stock_threshold: 0, track_inventory: true,
    unit: 'pcs', stock_value: 500_000,
    last_movement_at: null,
  },
];

vi.mock('@/features/inventory/hooks/useStockLevels.js', () => ({
  useStockLevels: () => ({ data: mockRows, isLoading: false, error: null, refetch: vi.fn() }),
  STOCK_LEVELS_QUERY_KEY: ['stock-levels'],
}));

vi.mock('@/features/inventory/hooks/useStockCounters.js', () => ({
  useStockCounters: () => ({
    data: { total_count: 318, low_count: 14, zero_count: 3, negative_count: 1, untracked_count: 20 },
    isLoading: false,
    error: null,
  }),
  STOCK_COUNTERS_QUERY_KEY: ['stock-levels', 'counters'],
}));

vi.mock('@/features/inventory/hooks/useInventoryReferenceData.js', () => ({
  useInventoryReferenceData: () => ({
    data: { categories: [], suppliers: [] },
    isLoading: false,
    error: null,
  }),
}));

// Les modales sont stubbées pour ne pas tirer leur arbre de dépendances.
// `ReceiveModal` n'est plus stubbé : le module a été retiré à l'audit du
// 2026-07-27 (la réception passe par /inventory/incoming). Le stub survivait à
// vide et laissait croire à une couverture qui n'existait plus.
vi.mock('@/features/inventory/components/AdjustModal.js', () => ({ AdjustModal: () => null }));
vi.mock('@/features/inventory/components/WasteModal.js',  () => ({ WasteModal:  () => null }));

function renderPage(Component: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Component /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// Les requêtes portent sur le conteneur rendu et non sur `screen`, qui
// interroge tout le document : ce fichier tombait en « Found multiple
// elements » dès qu'un autre fichier de la suite laissait une page montée,
// `cleanup()` ne démontant que ce que CE module a rendu.
describe('Inventory page shell (LIST archetype)', () => {
  beforeEach(() => {
    cleanup();
    mockRows = [
      {
        product_id: 'p-1', sku: 'BEV-AMER', name: 'Americano',
        category_id: null, category_name: null,
        current_stock: 5, min_stock_threshold: 10, track_inventory: true,
        unit: 'pcs', stock_value: 25_000,
        last_movement_at: null,
      },
    ];
  });

  it('renders the page title through the shared PageHeader', { timeout: 30_000 }, async () => {
    const InventoryPage = (await import('@/pages/Inventory.js')).default;
    const w = within(renderPage(InventoryPage).container);
    expect(w.getByRole('heading', { level: 1 })).toHaveTextContent(/Stock\s*&\s*Inventory/i);
  });

  it('renders the five stock buckets as clickable counters', { timeout: 15_000 }, async () => {
    const InventoryPage = (await import('@/pages/Inventory.js')).default;
    const w = within(renderPage(InventoryPage).container);
    for (const [id, label] of [
      ['all', 'All products'], ['low', 'Low stock'], ['zero', 'At zero'],
      ['negative', 'Negative'], ['untracked', 'Not tracked'],
    ] as const) {
      const counter = w.getByTestId(`counter-${id}`);
      expect(counter).toHaveTextContent(new RegExp(label, 'i'));
      // Un compteur d'archétype LIST se clique — sinon c'est un KPI déguisé.
      expect(counter.tagName).toBe('BUTTON');
    }
  });

  // Le cœur de l'ADR-024 : avec l'ancien contrat, le total voyageait sur les
  // lignes et disparaissait donc avec elles. Le pied disait « 0 of 0 », ou ne
  // se rendait pas du tout — au moment précis où l'utilisateur a besoin de
  // savoir que son filtre est trop étroit, et non que l'écran est cassé.
  //
  // Le pied énonçait ces deux faits DEUX FOIS jusqu'au 2026-08-26 (« 0 of 318 »
  // dans son `leading`, « Showing 1–15 of 318 rows » dans le compteur partagé).
  // Le doublon est retiré ; les deux faits que l'ADR protège restent, et ils
  // sont désormais portés chacun par un seul nœud :
  //   · le TOTAL du panier survit à une liste vide — compteur partagé ;
  //   · le compte RÉEL des lignes rendues ne se déduit pas de la tranche, qui
  //     en promet quinze — d'où la mention de page courte.
  it('still counts when the list comes back empty', { timeout: 15_000 }, async () => {
    mockRows = [];
    const InventoryPage = (await import('@/pages/Inventory.js')).default;
    const w = within(renderPage(InventoryPage).container);
    expect(w.getByTestId('list-page-range')).toHaveTextContent('of 318');
    expect(w.getByTestId('stock-levels-short-page')).toHaveTextContent('0 shown');
  });
});
