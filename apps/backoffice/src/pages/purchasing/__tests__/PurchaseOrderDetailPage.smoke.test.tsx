// apps/backoffice/src/pages/purchasing/__tests__/PurchaseOrderDetailPage.smoke.test.tsx
//
// Session 14 / Phase 5.A — smoke for the rebuilt PO detail page. Mocks the
// detail hook + receive/cancel mutations and asserts header, financial
// summary card, ordered items table, and action gating render correctly.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PurchaseOrderDetailPage from '@/pages/purchasing/PurchaseOrderDetailPage.js';
import type { PurchaseOrderDetail } from '@/features/purchasing/hooks/usePurchaseOrderDetail.js';

const PO: PurchaseOrderDetail = {
  id:               'po-1',
  po_number:        'PO-202604-0001',
  supplier_id:      'sup-1',
  status:           'pending',
  payment_terms:    'credit',
  subtotal:         600000,
  vat_amount:       60000,
  total_amount:     660000,
  order_date:       '2026-04-17',
  expected_date:    '2026-04-17',
  received_date:    null,
  notes:            null,
  cancel_reason:    null,
  import_reference: null,
  is_historical_import: false,
  cancelled_at:     null,
  cancelled_by:     null,
  received_by:      null,
  created_by:       null,
  created_at:       '2026-04-17T00:00:00Z',
  updated_at:       '2026-04-17T00:00:00Z',
  deleted_at:       null,
  metadata:         {},
  idempotency_key:  null,
  suppliers:        { code: 'CGS', name: 'CAKRA GEMILANG SEJAHTERA', payment_terms_days: 30 },
  purchase_order_items: [
    {
      id:                 'poi-1',
      po_id:              'po-1',
      product_id:         'p-1',
      quantity:           10,
      received_quantity:  0,
      unit:               'kg',
      unit_cost:          60000,
      subtotal:           600000,
      vat_amount:         60000,
      total:              660000,
      created_at:         '2026-04-17T00:00:00Z',
      updated_at:         '2026-04-17T00:00:00Z',
      products:           { sku: 'SEE-003', name: 'Almond Ground', unit: 'kg' },
    } as unknown as PurchaseOrderDetail['purchase_order_items'][number],
  ],
  goods_receipt_notes: [],
};

vi.mock('@/features/purchasing/hooks/usePurchaseOrderDetail.js', () => ({
  usePurchaseOrderDetail: () => ({ data: PO, isLoading: false, isError: false, error: null }),
}));

vi.mock('@/features/purchasing/hooks/useReceivePurchaseOrder.js', () => ({
  useReceivePurchaseOrder: () => ({ mutateAsync: () => Promise.resolve({}), isPending: false }),
}));

vi.mock('@/features/purchasing/hooks/useCancelPurchaseOrder.js', () => ({
  useCancelPurchaseOrder: () => ({ mutateAsync: () => Promise.resolve({}), isPending: false }),
}));

vi.mock('@/features/purchasing/components/ReceiveDialog.js', () => ({
  ReceiveDialog: () => null,
}));
vi.mock('@/features/purchasing/components/CancelDialog.js', () => ({
  CancelDialog: () => null,
}));
vi.mock('@/features/purchasing/components/POPrintView.js', () => ({
  POPrintView: () => null,
}));

let currentPerms = new Set<string>([
  'purchasing.po.read',
  'purchasing.po.receive',
  'purchasing.po.cancel',
]);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/purchasing/purchase-orders/po-1']}>
        <Routes>
          <Route path="/backoffice/purchasing/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PurchaseOrderDetailPage (Phase 5.A rewrite)', () => {
  it('renders the PO header, financial summary card, and ordered items', () => {
    currentPerms = new Set(['purchasing.po.read', 'purchasing.po.receive', 'purchasing.po.cancel']);
    renderPage();
    expect(screen.getByRole('heading', { name: /PO-202604-0001/i })).toBeInTheDocument();
    expect(screen.getAllByText(/CAKRA GEMILANG SEJAHTERA/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Order Information/i)).toBeInTheDocument();
    expect(screen.getByText(/Financial Summary/i)).toBeInTheDocument();
    expect(screen.getByText(/Almond Ground/i)).toBeInTheDocument();
  });

  it('shows Receive + Cancel actions when the PO is pending and the user is allowed', () => {
    currentPerms = new Set(['purchasing.po.read', 'purchasing.po.receive', 'purchasing.po.cancel']);
    renderPage();
    expect(screen.getByRole('button', { name: /Receive/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('hides Receive + Cancel when only read permission is granted', () => {
    currentPerms = new Set(['purchasing.po.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /^Receive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).not.toBeInTheDocument();
    currentPerms = new Set(['purchasing.po.read', 'purchasing.po.receive', 'purchasing.po.cancel']);
  });

  // Lot 2026-08-18 — la rangée d'actions du bandeau portait TROIS hauteurs de
  // bouton (36 px `size="sm"`, 56 px primitif par défaut, 32 px chaîne de
  // bandeau) et l'écran portait DEUX aplats encre. DESIGN.md § Boutons : la
  // chaîne `TOOLBAR_BTN_*` est du bandeau et de lui seul, et un seul bloc encré
  // par écran (The One Ink Fill Rule). Ces deux tests figent le sens du lot.
  it('ne rend le bandeau que sur la hauteur de la chaîne de bandeau (32 px)', () => {
    currentPerms = new Set([
      'purchasing.po.read', 'purchasing.po.receive',
      'purchasing.po.cancel', 'purchasing.po.edit',
    ]);
    renderPage();
    const header = screen.getByRole('button', { name: /Receive/i }).closest('header');
    expect(header).not.toBeNull();
    const buttons = Array.from(header!.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Back', 'Print', 'Receive', 'Cancel', 'Edit',
    ]);
    for (const b of buttons) {
      // 32 px, et aucun des deux crans du primitif partagé (56 px `md`, 36 px `sm`).
      expect(b.className).toMatch(/(^|\s)h-8(\s|$)/);
      expect(b.className).not.toMatch(/h-touch-comfy|h-touch-large|(^|\s)h-9(\s|$)/);
    }
  });

  it('ne porte qu\'un seul aplat encre : Receive au bandeau, pas Record payment', () => {
    currentPerms = new Set([
      'purchasing.po.read', 'purchasing.po.receive',
      'purchasing.po.cancel', 'purchasing.po.edit', 'purchasing.po.pay',
    ]);
    renderPage();
    const inked = Array.from(document.querySelectorAll('button'))
      .filter((b) => /(^|\s)bg-ink(\s|$)/.test(b.className));
    expect(inked.map((b) => b.textContent?.trim())).toEqual(['Receive']);

    const pay = screen.getByRole('button', { name: /Record payment/i });
    expect(pay.closest('header')).toBeNull();          // il vit dans le rail, pas le bandeau
    expect(pay.className).not.toMatch(/bg-ink/);        // plus d'encre
    expect(pay.className).toMatch(/border-border-strong/); // primitif `secondary`
  });
});
