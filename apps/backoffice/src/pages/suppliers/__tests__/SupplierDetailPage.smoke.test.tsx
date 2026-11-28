// apps/backoffice/src/pages/suppliers/__tests__/SupplierDetailPage.smoke.test.tsx
//
// Session 14 / Phase 5.A — smoke for the new SupplierDetailPage. We mock the
// detail + purchases hooks and verify the identity card, KPI tiles, the four
// tabs, and the Purchases table render with seeded data.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SupplierDetailPage from '@/pages/suppliers/SupplierDetailPage.js';
import type { SupplierRow } from '@/features/suppliers/hooks/useSuppliersList.js';
import type { SupplierPOListRow } from '@/features/suppliers/hooks/useSupplierPurchases.js';
import type * as SupplierPurchasesHooks from '@/features/suppliers/hooks/useSupplierPurchases.js';
import { formatCurrency } from '@breakery/utils';

const SUPPLIER: SupplierRow = {
  id:                 'sup-1',
  code:               '88',
  name:               '88',
  contact_phone:      '8990235081',
  contact_email:      null,
  address:            'Kota Mataram, Indonesia',
  payment_terms_days: 30,
  notes:              'Mba Putu',
  is_active:          true,
  deleted_at:         null,
  created_at:         '2026-04-01T00:00:00Z',
  updated_at:         '2026-04-01T00:00:00Z',
};

const PURCHASES: SupplierPOListRow[] = [
  {
    id:               'po-1',
    po_number:        'PO-202604-0002',
    supplier_id:      'sup-1',
    status:           'pending',
    payment_terms:    'credit',
    subtotal:         1140909,
    vat_amount:       114091,

    discount_amount: 0,

    delivery_fee: 0,
    total_amount:     1255000,
    order_date:       '2026-04-17',
    expected_date:    '2026-04-18',
    received_date:    null,
    notes:            null,
    cancel_reason:    null,
    import_reference: null,
    financial_import_document_id: null,
    invoice_exempt: false,
    invoice_path: null,
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
    item_count:       1,
    paid_amount:      0,
  },
  {
    id:               'po-2',
    po_number:        'PO-202603-0032',
    supplier_id:      'sup-1',
    status:           'received',
    payment_terms:    'cash',
    subtotal:         550000,
    vat_amount:       55000,

    discount_amount: 0,

    delivery_fee: 0,
    total_amount:     605000,
    order_date:       '2026-03-23',
    expected_date:    '2026-03-23',
    received_date:    '2026-03-23',
    notes:            null,
    cancel_reason:    null,
    import_reference: null,
    financial_import_document_id: null,
    invoice_exempt: false,
    invoice_path: null,
    is_historical_import: false,
    cancelled_at:     null,
    cancelled_by:     null,
    received_by:      null,
    created_by:       null,
    created_at:       '2026-03-23T00:00:00Z',
    updated_at:       '2026-03-23T00:00:00Z',
    deleted_at:       null,
    metadata:         {},
    idempotency_key:  null,
    item_count:       1,
    paid_amount:      0,
  },
];

// S3-07 — la tuile « Unpaid » lit le grand livre par sa propre requête : on
// simule PostgREST, le vrai crochet et la vraie règle tournent. po-1 n'est pas
// reçu (hors encours) ; po-2 est reçu et soldé ; po-3, reçu à crédit, porte
// 500 000 payés sur 2 000 000 → 1 500 000 dus. L'import historique, non soldé,
// reste hors encours comme dans le rapport.
const LEDGER_ROWS = [
  { status: 'pending',  total_amount: 1255000, is_historical_import: false, deleted_at: null, purchase_payments: [] },
  { status: 'received', total_amount: 605000,  is_historical_import: false, deleted_at: null, purchase_payments: [{ amount: 605000 }] },
  { status: 'received', total_amount: 2000000, is_historical_import: false, deleted_at: null, purchase_payments: [{ amount: 300000 }, { amount: '200000' }] },
  { status: 'received', total_amount: 900000,  is_historical_import: true,  deleted_at: null, purchase_payments: [] },
];

vi.mock('@/lib/supabase.js', () => {
  function builder(table: string): Record<string, unknown> {
    const result = { data: table === 'purchase_orders' ? LEDGER_ROWS : [], error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'range', 'limit', 'gte', 'lte']) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  }
  return { supabase: { from: (t: string) => builder(t) } };
});

vi.mock('@/features/suppliers/hooks/useSupplierDetail.js', () => ({
  useSupplierDetail: () => ({ data: SUPPLIER, isLoading: false, error: null }),
}));

vi.mock('@/features/suppliers/hooks/useSupplierPurchases.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SupplierPurchasesHooks>();
  return {
    ...actual,
    useSupplierPurchases: () => ({ data: PURCHASES, isLoading: false, error: null }),
  };
});

vi.mock('@/features/suppliers/hooks/useUpdateSupplier.js', () => ({
  useUpdateSupplier: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/suppliers/components/SupplierFormModal.js', () => ({
  SupplierFormModal: () => null,
}));

let currentPerms = new Set<string>(['suppliers.read', 'suppliers.update']);
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
      <MemoryRouter initialEntries={['/backoffice/suppliers/sup-1']}>
        <Routes>
          <Route path="/backoffice/suppliers/:id" element={<SupplierDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SupplierDetailPage (Phase 5.A)', () => {
  it('renders supplier identity, KPI tiles, and the four tabs', () => {
    currentPerms = new Set(['suppliers.read', 'suppliers.update']);
    renderPage();
    expect(screen.getByRole('heading', { name: /^88$/ })).toBeInTheDocument();
    expect(screen.getByText(/Back to Suppliers/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Total Spent/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: /Purchases/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Price Evolution/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Payments/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Analytics/i })).toBeInTheDocument();
  });

  it('lists the purchase orders inside the Purchases tab', () => {
    currentPerms = new Set(['suppliers.read', 'suppliers.update']);
    renderPage();
    expect(screen.getByRole('link', { name: /PO-202604-0002/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PO-202603-0032/i })).toBeInTheDocument();
  });

  it('shows the ledger outstanding (report rule) in the Unpaid Amount tile', async () => {
    currentPerms = new Set(['suppliers.read', 'suppliers.update']);
    renderPage();
    const tile = screen.getByText('Unpaid Amount').parentElement;
    expect(tile).not.toBeNull();
    await waitFor(() => expect(tile).toHaveTextContent(formatCurrency(1_500_000)));
  });

  it('derives each row payment badge from the ledger, whatever the reception', () => {
    currentPerms = new Set(['suppliers.read', 'suppliers.update']);
    const { container } = renderPage();
    // Harmonisation 2026-11-28 : la pastille est celle de la fiche du bon —
    // le statut de paiement se lit dans le grand livre, reçu ou non. Les deux
    // bons du mock n'ont aucun paiement : tous deux « Unpaid ». L'ancien
    // « awaiting receipt » donnait au même bon deux statuts selon la page.
    const statuses = [...container.querySelectorAll('[data-payment-status]')]
      .map((el) => el.getAttribute('data-payment-status'));
    expect(statuses).toEqual(['unpaid', 'unpaid']);
    expect(screen.queryByText('awaiting receipt')).not.toBeInTheDocument();
  });

  it('hides Edit / Deactivate when the user lacks suppliers.update', () => {
    currentPerms = new Set(['suppliers.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
    currentPerms = new Set(['suppliers.read', 'suppliers.update']);
  });
});
