// apps/backoffice/src/pages/suppliers/__tests__/SupplierDetailPage.smoke.test.tsx
//
// Session 14 / Phase 5.A — smoke for the new SupplierDetailPage. We mock the
// detail + purchases hooks and verify the identity card, KPI tiles, the four
// tabs, and the Purchases table render with seeded data.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SupplierDetailPage from '@/pages/suppliers/SupplierDetailPage.js';
import type { SupplierRow } from '@/features/suppliers/hooks/useSuppliersList.js';
import type { SupplierPOListRow } from '@/features/suppliers/hooks/useSupplierPurchases.js';

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
    total_amount:     1255000,
    order_date:       '2026-04-17',
    expected_date:    '2026-04-18',
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
    item_count:       1,
  },
  {
    id:               'po-2',
    po_number:        'PO-202603-0032',
    supplier_id:      'sup-1',
    status:           'received',
    payment_terms:    'cash',
    subtotal:         550000,
    vat_amount:       55000,
    total_amount:     605000,
    order_date:       '2026-03-23',
    expected_date:    '2026-03-23',
    received_date:    '2026-03-23',
    notes:            null,
    cancel_reason:    null,
    import_reference: null,
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
  },
];

vi.mock('@/features/suppliers/hooks/useSupplierDetail.js', () => ({
  useSupplierDetail: () => ({ data: SUPPLIER, isLoading: false, error: null }),
}));

vi.mock('@/features/suppliers/hooks/useSupplierPurchases.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/suppliers/hooks/useSupplierPurchases.js')>();
  return {
    ...actual,
    useSupplierPurchases: () => ({ data: PURCHASES, isLoading: false, error: null }),
  };
});

vi.mock('@/features/suppliers/hooks/useUpdateSupplier.js', () => ({
  useUpdateSupplier: () => ({ mutate: () => {}, isPending: false }),
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

  it('hides Edit / Deactivate when the user lacks suppliers.update', () => {
    currentPerms = new Set(['suppliers.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
    currentPerms = new Set(['suppliers.read', 'suppliers.update']);
  });
});
