// S3-05 — la fiche du bon transmet `purchasing.po.cancel` à la carte des
// réceptions : action visible avec la permission, absente sans.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PurchaseOrderDetailPage from '@/pages/purchasing/PurchaseOrderDetailPage.js';
import type { PurchaseOrderDetail } from '@/features/purchasing/hooks/usePurchaseOrderDetail.js';

const PO = {
  id: 'po-1', po_number: 'PO-1', supplier_id: 'sup-1', status: 'received', payment_terms: 'credit',
  subtotal: 600000, vat_amount: 60000, total_amount: 660000, order_date: '2026-11-17',
  expected_date: '2026-11-18', received_date: '2026-11-18', notes: null, cancel_reason: null,
  financial_import_document_id: null, invoice_exempt: true, invoice_path: null,
  cancelled_at: null, created_at: '2026-11-17T00:00:00Z',
  suppliers: { code: 'S', name: 'Supplier', payment_terms_days: 30 },
  purchase_order_items: [],
  goods_receipt_notes: [{
    id: 'grn-1', grn_number: 'GRN-0001', po_id: 'po-1', received_date: '2026-11-18T03:00:00Z',
    subtotal: 600000, vat_amount: 60000, total: 660000, payment_terms: 'credit',
    cancelled_at: null, cancel_reason: null,
  }],
} as unknown as PurchaseOrderDetail;

// Client inerte : les crochets voisins (paiements, fournisseurs, produits)
// reçoivent une liste vide, sans réseau ni variables d'environnement.
vi.mock('@/lib/supabase.js', () => {
  const empty = Promise.resolve({ data: [], error: null, count: 0 });
  const chain: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => (prop === 'then' ? empty.then.bind(empty) : () => chain),
    apply: () => chain,
  });
  return { supabase: { from: () => chain, rpc: () => empty } };
});
vi.mock('@/features/purchasing/hooks/usePurchaseOrderDetail.js', () => ({
  usePurchaseOrderDetail: () => ({ data: PO, isLoading: false, isError: false, error: null }),
}));
vi.mock('@/features/purchasing/hooks/useCancelGoodsReceipt.js', () => ({
  useCancelGoodsReceipt: () => ({ mutateAsync: () => Promise.resolve({}), isPending: false }),
  cancelReceiptErrorMessage: () => '',
  CancelReceiptError: class extends Error {},
}));
vi.mock('@/features/purchasing/components/POPrintView.js', () => ({ POPrintView: () => null }));

let perms = new Set<string>();
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => perms.has(p) }),
}));

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/purchasing/purchase-orders/po-1']}>
        <Routes>
          <Route path="/backoffice/purchasing/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PurchaseOrderDetailPage — cancel receipt gating', () => {
  it('shows Cancel receipt with purchasing.po.cancel', () => {
    perms = new Set(['purchasing.po.read', 'purchasing.po.cancel']);
    renderPage();
    expect(screen.getByRole('button', { name: 'Cancel receipt GRN-0001' })).toBeInTheDocument();
  });

  it('hides Cancel receipt without purchasing.po.cancel', () => {
    perms = new Set(['purchasing.po.read', 'purchasing.po.receive']);
    renderPage();
    expect(screen.getByText('GRN-0001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel receipt/ })).not.toBeInTheDocument();
  });
});
