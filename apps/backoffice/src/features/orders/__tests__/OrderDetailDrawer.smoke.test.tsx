// apps/backoffice/src/features/orders/__tests__/OrderDetailDrawer.smoke.test.tsx
//
// Audit UX/UI 2026-08-13, lot 6a — le tiroir devient l'APERÇU CANONIQUE.
// Ce que ces cas prouvent, dans l'ordre du lot :
//   · isPaid tient compte de `paid_at` (règlement B2B sans order_payments) ;
//   · le badge de ligne nomme le cycle CUISINE et disparaît hors cuisine ;
//   · les totaux nomment la frontière PB1, dans le même ordre que la page ;
//   · le lien « Open full page » ferme le tiroir ;
//   · Edit items / Void respectent gates ET statuts, et remontent par callback.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── fixture mutable ────────────────────────────────────────────────────────
const BASE_ORDER = {
  id: 'o-1',
  order_number: 'ORD-001',
  status: 'completed',
  order_type: 'dine_in',
  table_number: null,
  created_at: '2026-05-22T10:00:00Z',
  paid_at: '2026-05-22T10:05:00Z',
  sent_to_kitchen_at: null,
  customer_id: null,
  customer_name: null,
  served_by: null,
  served_by_name: null,
  subtotal: 100_000,
  discount_amount: 0,
  tax_amount: 9_000,
  total: 100_000,
  items: [
    {
      id: 'i-1',
      product_id: 'p-1',
      name_snapshot: 'Croissant',
      quantity: 2,
      unit_price: 50_000,
      line_total: 100_000,
      modifiers: null,
      is_cancelled: false,
      kitchen_status: 'pending',
    },
  ],
  payments: [
    {
      id: 'pay-1',
      method: 'cash',
      amount: 100_000,
      cash_received: 100_000,
      change_given: 0,
      paid_at: '2026-05-22T10:05:00Z',
      reference: null,
    },
  ],
  refunds: [],
  promotions: [],
};

let orderOverrides: Record<string, unknown> = {};

vi.mock('@/features/orders/hooks/useOrderDetail.js', () => ({
  useOrderDetail: () => ({ isLoading: false, data: { ...BASE_ORDER, ...orderOverrides } }),
}));

// Gates : accordées par défaut, restreintes cas par cas.
let grantedPerms = new Set(['orders.edit_open', 'orders.void']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (c: string) => boolean }) => unknown) =>
    selector({ hasPermission: (c: string) => grantedPerms.has(c) }),
}));

import { OrderDetailDrawer } from '../components/OrderDetailDrawer.js';

function renderDrawer(props: Partial<React.ComponentProps<typeof OrderDetailDrawer>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/orders']}>
        <OrderDetailDrawer orderId="o-1" {...props} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe('OrderDetailDrawer — aperçu canonique (lot 6a)', () => {
  beforeEach(() => {
    orderOverrides = {};
    grantedPerms = new Set(['orders.edit_open', 'orders.void']);
  });

  // ── 2 · isPaid ───────────────────────────────────────────────────────────
  it('T1 paid_at alone settles the order — the drawer no longer reads Unpaid', async () => {
    orderOverrides = { status: 'draft', payments: [], paid_at: '2026-05-22T10:05:00Z' };
    renderDrawer();
    await screen.findByTestId('order-detail-drawer');
    expect(screen.queryByText('Unpaid')).toBeNull();
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
  });

  it('T2 nothing settled — no payment, no paid_at, no settled status', async () => {
    orderOverrides = { status: 'draft', payments: [], paid_at: null };
    renderDrawer();
    await screen.findByTestId('order-detail-drawer');
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
  });

  // ── 3 · badge cuisine ────────────────────────────────────────────────────
  it('T3 an order never sent to the kitchen renders NO kitchen badge', async () => {
    orderOverrides = { sent_to_kitchen_at: null };
    renderDrawer();
    await screen.findByText('Croissant');
    // Le DEFAULT 'pending' de kitchen_status ne doit jamais s'afficher seul.
    expect(screen.queryByText(/Kitchen:/)).toBeNull();
    expect(screen.queryByText('pending')).toBeNull();
  });

  it('T4 an order sent to the kitchen names the dimension: "Kitchen: ready"', async () => {
    orderOverrides = {
      sent_to_kitchen_at: '2026-05-22T10:01:00Z',
      items: [{ ...BASE_ORDER.items[0], kitchen_status: 'ready' }],
    };
    renderDrawer();
    await screen.findByText('Croissant');
    expect(screen.getByText(/Kitchen:\s*ready/)).toBeInTheDocument();
  });

  // ── 4 · totaux ───────────────────────────────────────────────────────────
  it('T5 totals name the PB1 boundary, in the same order as the full page', async () => {
    renderDrawer();
    await screen.findByTestId('order-detail-drawer');
    expect(screen.getByText('Base (excl. PB1)')).toBeInTheDocument();
    expect(screen.getByText('PB1 (included)')).toBeInTheDocument();
    expect(screen.getByText('Total (incl. PB1)')).toBeInTheDocument();
    expect(screen.queryByText('Subtotal')).toBeNull();
    // 100 000 − 9 000 = 91 000
    expect(screen.getAllByText(/91\.000|91,000/).length).toBeGreaterThan(0);
    // Cash received / Change conservés.
    expect(screen.getByText('Cash Received')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();
  });

  // ── 6 · le total est en encre, pas en or ─────────────────────────────────
  it('T6 the total is INK, not gold — gold is a meaning ink, not a fill', async () => {
    renderDrawer();
    const label = await screen.findByText('Total (incl. PB1)');
    const amount = label.nextElementSibling;
    expect(amount?.className).toContain('text-text-primary');
    expect(amount?.className).not.toContain('text-gold');
  });

  // ── 5 · lien vers le document complet ────────────────────────────────────
  it('T7 "Open full page" links to the detail route and closes the drawer', async () => {
    const { onClose } = renderDrawer();
    const link = await screen.findByTestId('drawer-open-full-page');
    expect(link.getAttribute('href')).toBe('/backoffice/orders/o-1');
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  // ── 5 · actions métier, mêmes gates et mêmes statuts que la liste ────────
  it('T8 Void shows on paid/completed and reports the order up by callback', async () => {
    const onVoid = vi.fn();
    renderDrawer({ onVoid });
    const btn = await screen.findByTestId('drawer-void');
    fireEvent.click(btn);
    expect(onVoid).toHaveBeenCalledWith('o-1', 'ORD-001');
    // Une commande complétée ne s'édite pas (ADR-009).
    expect(screen.queryByTestId('drawer-edit-items')).toBeNull();
  });

  it('T9 Edit items shows on draft/pending_payment only', async () => {
    const onEditItems = vi.fn();
    orderOverrides = { status: 'pending_payment' };
    renderDrawer({ onEditItems, onVoid: vi.fn() });
    const btn = await screen.findByTestId('drawer-edit-items');
    fireEvent.click(btn);
    expect(onEditItems).toHaveBeenCalledWith('o-1', 'ORD-001');
    // Le void n'est PAS une sortie de pending_payment.
    expect(screen.queryByTestId('drawer-void')).toBeNull();
  });

  it('T10 without the permission the action is absent, callback or not', async () => {
    grantedPerms = new Set();
    renderDrawer({ onEditItems: vi.fn(), onVoid: vi.fn() });
    await screen.findByTestId('order-detail-drawer');
    expect(screen.queryByTestId('drawer-void')).toBeNull();
    expect(screen.queryByTestId('drawer-edit-items')).toBeNull();
  });

  it('T11 without a callback the drawer stays a read-only preview', async () => {
    renderDrawer(); // ni onEditItems ni onVoid
    await screen.findByTestId('order-detail-drawer');
    await waitFor(() => expect(screen.getByTestId('drawer-open-full-page')).toBeInTheDocument());
    expect(screen.queryByTestId('drawer-void')).toBeNull();
  });
});
