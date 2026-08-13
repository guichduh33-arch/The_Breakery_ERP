// apps/backoffice/src/pages/purchasing/__tests__/PurchaseOrdersListPage.smoke.test.tsx
//
// Smoke de la liste des bons de commande. Mocks des hooks de données + des
// permissions ; on vérifie l'en-tête, la BANDE DE COMPTEURS (qui a remplacé les
// tuiles de KPI et les pastilles de statut) et les lignes de la table.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PurchaseOrdersListPage from '@/pages/purchasing/PurchaseOrdersListPage.js';
import type { PurchaseOrderListRow } from '@/features/purchasing/hooks/usePurchaseOrdersList.js';
import type * as UsePurchaseOrdersListModule from '@/features/purchasing/hooks/usePurchaseOrdersList.js';
import type * as UseSuppliersListModule from '@/features/suppliers/hooks/useSuppliersList.js';

const ROWS: PurchaseOrderListRow[] = [
  {
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
    suppliers:        { code: 'CGS', name: 'CAKRA GEMILANG SEJAHTERA' },
  },
  {
    id:               'po-2',
    po_number:        'PO-202603-0031',
    supplier_id:      'sup-2',
    status:           'received',
    payment_terms:    'cash',
    subtotal:         90000,
    vat_amount:       0,
    total_amount:     90000,
    order_date:       '2026-03-17',
    expected_date:    '2026-03-17',
    received_date:    '2026-03-17',
    notes:            null,
    cancel_reason:    null,
    import_reference: null,
    is_historical_import: false,
    cancelled_at:     null,
    cancelled_by:     null,
    received_by:      null,
    created_by:       null,
    created_at:       '2026-03-17T00:00:00Z',
    updated_at:       '2026-03-17T00:00:00Z',
    deleted_at:       null,
    metadata:         {},
    idempotency_key:  null,
    suppliers:        { code: 'BU', name: 'Banyu Urip' },
  },
];

vi.mock('@/features/purchasing/hooks/useHistoricalPurchasesExport.js', () => ({
  useHistoricalPurchasesExport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/data-import/components/ImportEntityModal.js', () => ({
  ImportEntityModal: () => null,
}));

vi.mock('@/features/data-import/buildEntityWorkbook.js', () => ({
  buildTemplateWorkbook: vi.fn(),
  buildExportWorkbook: vi.fn(),
  downloadWorkbook: vi.fn(),
}));

vi.mock('@/features/purchasing/import/purchasesImportDef.js', () => ({
  purchasesImportDef: { entity: 'purchases', sheetName: 'Purchases', columns: [], queryKeysToInvalidate: [] },
}));

vi.mock('@/features/purchasing/hooks/usePurchaseOrdersList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof UsePurchaseOrdersListModule>();
  return {
    ...actual,
    usePurchaseOrdersList: () => ({ data: ROWS, isLoading: false, error: null }),
  };
});

vi.mock('@/features/suppliers/hooks/useSuppliersList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof UseSuppliersListModule>();
  return {
    ...actual,
    useSuppliersList: () => ({ data: [], isLoading: false, error: null }),
  };
});

let currentPerms = new Set<string>(['purchasing.po.read', 'purchasing.po.create']);
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
      <MemoryRouter>
        <PurchaseOrdersListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PurchaseOrdersListPage', () => {
  it('renders header, the counter strip, and rows', () => {
    currentPerms = new Set(['purchasing.po.read', 'purchasing.po.create']);
    renderPage();
    expect(screen.getByRole('heading', { name: /Purchase Orders/i })).toBeInTheDocument();
    expect(within(screen.getByTestId('counter-all')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('counter-pending')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('counter-received')).getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PO-202604-0001/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PO-202603-0031/i })).toBeInTheDocument();
    expect(screen.getByText(/CAKRA GEMILANG SEJAHTERA/i)).toBeInTheDocument();
  });

  it('drives the status filter from the counters — no second row of pills', () => {
    currentPerms = new Set(['purchasing.po.read', 'purchasing.po.create']);
    renderPage();
    // Les pastilles `role="tab"` sont mortes : le compteur EST le filtre.
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByTestId('counter-all')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('counter-pending'));
    expect(screen.getByTestId('counter-pending')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('counter-all')).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the New purchase order CTA when create is granted', () => {
    currentPerms = new Set(['purchasing.po.read', 'purchasing.po.create']);
    renderPage();
    expect(screen.getByRole('link', { name: /New purchase order/i })).toBeInTheDocument();
  });

  it('hides the create CTA when only read is granted', () => {
    currentPerms = new Set(['purchasing.po.read']);
    renderPage();
    expect(screen.queryByRole('link', { name: /New purchase order/i })).not.toBeInTheDocument();
    currentPerms = new Set(['purchasing.po.read', 'purchasing.po.create']);
  });
});
