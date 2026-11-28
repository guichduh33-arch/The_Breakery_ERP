// apps/backoffice/src/pages/purchasing/__tests__/PurchaseOrdersListPage.smoke.test.tsx
//
// Smoke de la liste des bons de commande. Mocks des hooks de données + des
// permissions ; on vérifie l'en-tête, la BANDE DE COMPTEURS (qui a remplacé les
// tuiles de KPI et les pastilles de statut) et les lignes de la table.

import { beforeEach, describe, expect, it, vi } from 'vitest';
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

    discount_amount: 0,

    delivery_fee: 0,
    total_amount:     660000,
    order_date:       '2026-04-17',
    expected_date:    '2026-04-17',
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
    po_paid_amount:   0,
    po_payment_status: 'unpaid',
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

    discount_amount: 0,

    delivery_fee: 0,
    total_amount:     90000,
    order_date:       '2026-03-17',
    expected_date:    '2026-03-17',
    received_date:    '2026-03-17',
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
    created_at:       '2026-03-17T00:00:00Z',
    updated_at:       '2026-03-17T00:00:00Z',
    deleted_at:       null,
    metadata:         {},
    idempotency_key:  null,
    po_paid_amount:   90000,
    po_payment_status: 'paid',
    suppliers:        { code: 'BU', name: 'Banyu Urip' },
  },
];
let queryData: PurchaseOrderListRow[] | undefined = ROWS;
let queryError = false;

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
    usePurchaseOrdersList: (f: { paymentStatus?: string }) => {
      const rows = queryData?.filter((r) => f.paymentStatus === undefined || r.po_payment_status === f.paymentStatus);
      return { data: rows === undefined ? undefined : { rows, total: rows.length }, isLoading: queryData === undefined, isError: false, error: null };
    },
    // Les compteurs sont des comptes serveur ; le mock les dérive des lignes.
    usePurchaseOrderCounts: () => {
      if (queryData === undefined || queryError) return { data: undefined, isError: queryError };
      const by = (st: string) => queryData!.filter((r) => r.status === st).length;
      return { data: { all: queryData.length, pending: by('pending'), partial: by('partial'), received: by('received'), cancelled: by('cancelled') }, isError: false };
    },
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
  beforeEach(() => { queryData = ROWS; queryError = false; currentPerms = new Set(['purchasing.po.read']); });
  it('affiche un tiret avant réponse puis zéro seulement pour une réponse vide', () => {
    queryData = undefined;
    const view = renderPage();
    expect(screen.getByTestId('counter-all')).toHaveTextContent('—');
    view.unmount();
    queryData = [];
    renderPage();
    expect(screen.getByTestId('counter-all')).toHaveTextContent('0');
  });
  it('masque un compte en cache quand le refetch échoue', () => {
    queryError = true;
    renderPage();
    expect(screen.getByTestId('counter-all')).toHaveTextContent('—');
    expect(screen.getByTestId('counter-pending')).toHaveTextContent('—');
  });
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

  it('shows reception and payment as two separate columns, and links the supplier', () => {
    renderPage();
    const rowA = screen.getByRole('link', { name: /PO-202604-0001/i }).closest('tr')!;
    expect(within(rowA).getByText('To receive')).toBeInTheDocument();
    expect(within(rowA).getByText('Unpaid')).toBeInTheDocument();
    const rowB = screen.getByRole('link', { name: /PO-202603-0031/i }).closest('tr')!;
    expect(within(rowB).getByText('Received')).toBeInTheDocument();
    expect(within(rowB).getByText('Paid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /CAKRA GEMILANG SEJAHTERA/i })).toHaveAttribute('href', '/backoffice/suppliers/sup-1');
  });

  it('filters by payment status and says so when nothing matches', () => {
    renderPage();
    fireEvent.change(screen.getByTestId('po-payment-filter'), { target: { value: 'partial' } });
    expect(screen.queryByRole('link', { name: /PO-202604-0001/i })).not.toBeInTheDocument();
    expect(screen.getByText('No purchase order matches these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('po-clear-filters'));
    expect(screen.getByRole('link', { name: /PO-202604-0001/i })).toBeInTheDocument();
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
