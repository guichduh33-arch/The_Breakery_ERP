// apps/backoffice/src/pages/purchasing/__tests__/PurchaseOrderDetailPage.degraded.test.tsx
//
// Lot 4 / tâche B — les branches dégradées du détail d'un bon de commande.
// Trois à l'origine ; la quatrième (requête réussie, aucune ligne) a rejoint la
// coquille commune au lot 9.
//
// Avant, chacune rendait une ligne nue :
//   · « You do not have permission to view this purchase order. »
//   · « Loading… »
//   · « Failed to load purchase order. » (en rouge, sans détail ni Retry)
// Un manager qui suivait un lien partagé vers un PO qu'il ne peut pas lire
// perdait l'écran entier, l'orientation et la sortie.
//
// La branche d'erreur est le cas le plus coûteux : le message rouge ne disait
// pas CE QUI a échoué et n'offrait aucun moyen de réessayer — il fallait
// recharger l'onglet. Elle passe désormais par `QueryErrorBanner`, le geste que
// faisait déjà `OpnameDetailPage`.
//
// Fichier séparé du smoke existant, dont le `vi.mock` hissé fige la requête sur
// un succès.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PurchaseOrderDetailPage from '@/pages/purchasing/PurchaseOrderDetailPage.js';

interface DetailStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

const refetch = vi.fn();
let detailStub: DetailStub = {
  data: null, isLoading: true, isError: false, error: null, refetch,
};
let perms = new Set<string>(['purchasing.po.read']);

vi.mock('@/features/purchasing/hooks/usePurchaseOrderDetail.js', () => ({
  usePurchaseOrderDetail: () => detailStub,
}));
vi.mock('@/features/purchasing/hooks/useReceivePurchaseOrder.js', () => ({
  useReceivePurchaseOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/purchasing/hooks/useCancelPurchaseOrder.js', () => ({
  useCancelPurchaseOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/purchasing/hooks/usePoPayments.js', () => ({
  usePoPayments: () => ({ data: { totalPaid: 0, payments: [] }, isLoading: false }),
  // Manquait jusqu'ici : les quatre branches dégradées d'origine renvoient
  // toutes avant l'appel à `derivePaymentStatus` (detail.data reste null).
  // Le cas « PO cancelled », premier de ce fichier à rendre un PO complet,
  // atteint réellement cette ligne — sans ce mock la page plante.
  derivePaymentStatus: (totalPaid: number, totalDue: number): 'unpaid' | 'partial' | 'paid' => {
    if (totalPaid <= 0) return 'unpaid';
    if (totalPaid + 0.005 >= totalDue) return 'paid';
    return 'partial';
  },
}));
vi.mock('@/features/purchasing/hooks/useRecordPoPayment.js', () => ({
  useRecordPoPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/purchasing/hooks/useUpdatePurchaseOrder.js', () => ({
  useUpdatePurchaseOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/purchasing/hooks/useAllProductsForPO.js', () => ({
  useAllProductsForPO: () => ({ data: [] }),
}));
vi.mock('@/features/suppliers/hooks/useSuppliersList.js', () => ({
  useSuppliersList: () => ({ data: [] }),
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => perms.has(p) }),
}));

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/purchasing/purchase-orders/po-1']}>
        <Routes>
          <Route
            path="/backoffice/purchasing/purchase-orders/:id"
            element={<PurchaseOrderDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Le fil d'Ariane, qu'aucune branche dégradée ne doit escamoter — et il est
 * désormais la SEULE sortie.
 *
 * LOT 9 : cette sonde exigeait aussi un « ← Back to purchase orders » rendu
 * sous le titre. C'était le doublon que le lot 8 a proscrit — deux vocabulaires
 * pour le même geste sur le même écran, alors que l'ossature commune
 * (DESIGN.md § Page Archetypes) ne déclare qu'un fil d'Ariane. On vérifie donc
 * les deux moitiés de la règle : le fil est là, ET rien ne le double.
 */
function expectOrientationKept(): void {
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Purchase Orders' })).toHaveAttribute(
    'href',
    '/backoffice/purchasing/purchase-orders',
  );
  expect(screen.queryByRole('link', { name: /back to purchase orders/i })).not.toBeInTheDocument();
}

describe('PurchaseOrderDetailPage — états dégradés', () => {
  beforeEach(() => {
    refetch.mockClear();
    perms = new Set<string>(['purchasing.po.read']);
  });

  it('droit manquant : bloc restricted nommant la permission, pas une ligne de gris', () => {
    perms = new Set<string>();
    detailStub = { data: null, isLoading: false, isError: false, error: null, refetch };
    renderPage();
    expectOrientationKept();
    const restricted = screen.getByRole('status');
    expect(restricted).toHaveTextContent('Access to this purchase order is restricted.');
    expect(restricted).toHaveTextContent('purchasing.po.read');
    // Un refus n'est pas une panne : rien ne doit être annoncé en alerte.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('chargement : une silhouette annoncée, pas le mot « Loading… »', () => {
    detailStub = { data: null, isLoading: true, isError: false, error: null, refetch };
    renderPage();
    expect(screen.getByLabelText('Loading purchase order')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('échec de requête : détail serveur ET Retry câblé', () => {
    detailStub = {
      data: null,
      isLoading: false,
      isError: true,
      error: new Error('relation "purchase_orders" does not exist'),
      refetch,
    };
    renderPage();
    expectOrientationKept();
    const banner = screen.getByTestId('po-detail-error');
    expect(banner).toHaveTextContent('could not be loaded');
    expect(banner).toHaveTextContent('relation "purchase_orders" does not exist');
    screen.getByRole('button', { name: /try again/i }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // LOT 9 — la QUATRIÈME branche, que le lot 4 avait laissée de côté : la
  // requête réussit mais ne rend rien. Elle n'avait ni fil d'Ariane ni titre,
  // et pour seule sortie un « ← Back to purchase orders ». On ne pouvait donc
  // pas retirer ce retour sans l'enfermer : elle passe par la coquille commune.
  it('introuvable : la coquille rend le fil d’Ariane, plus aucun retour en doublon', () => {
    detailStub = { data: null, isLoading: false, isError: false, error: null, refetch };
    renderPage();
    expectOrientationKept();
    expect(screen.getByText('Purchase order not found')).toBeInTheDocument();
  });

  // Fix (dev incident 2026-08-21) — un PO `cancelled` laissait « Record
  // payment » actif ; un clic a réellement écrit un paiement (Rp 6.660,
  // JE-20260821-0057). Le bouton doit rester rendu et désactivé — pas
  // disparaître — avec la raison lisible à l'écran ET reliée au bouton par
  // `aria-describedby` (le `title` seul ne s'affiche pas : le primitif
  // `Button` porte `disabled:pointer-events-none`, qui tue le survol).
  it('PO cancelled : Record payment reste rendu, désactivé, avec la raison visible et reliée par aria-describedby', () => {
    perms = new Set<string>(['purchasing.po.read', 'purchasing.po.pay']);
    detailStub = {
      data: {
        id: 'po-cancelled-1',
        po_number: 'PO-202608-0099',
        supplier_id: 'sup-1',
        status: 'cancelled',
        payment_terms: 'credit',
        subtotal: 600000,
        vat_amount: 60000,
        total_amount: 660000,
        order_date: '2026-08-01',
        expected_date: '2026-08-05',
        received_date: null,
        notes: null,
        cancel_reason: 'Supplier could not deliver',
        import_reference: null,
        is_historical_import: false,
        cancelled_at: '2026-08-21T00:00:00Z',
        cancelled_by: null,
        received_by: null,
        created_by: null,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-21T00:00:00Z',
        deleted_at: null,
        metadata: {},
        idempotency_key: null,
        suppliers: { code: 'CGS', name: 'CAKRA GEMILANG SEJAHTERA', payment_terms_days: 30 },
        purchase_order_items: [
          {
            id: 'poi-1',
            po_id: 'po-cancelled-1',
            product_id: 'p-1',
            quantity: 10,
            received_quantity: 0,
            unit: 'kg',
            unit_cost: 60000,
            subtotal: 600000,
            vat_amount: 60000,
            total: 660000,
            created_at: '2026-08-01T00:00:00Z',
            updated_at: '2026-08-01T00:00:00Z',
            products: { sku: 'SEE-003', name: 'Almond Ground', unit: 'kg' },
          },
        ],
        goods_receipt_notes: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
    renderPage();

    const payButton = screen.getByRole('button', { name: /Record payment/i });
    expect(payButton).toBeDisabled();

    const reasonId = payButton.getAttribute('aria-describedby');
    expect(reasonId).not.toBeNull();
    const reason = document.getElementById(reasonId!);
    expect(reason).toHaveTextContent(
      'This purchase order is cancelled — no payment can be recorded.',
    );
  });
});
