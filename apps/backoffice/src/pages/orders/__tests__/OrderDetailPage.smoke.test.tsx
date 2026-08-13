import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderDetailPage } from '../OrderDetailPage.js';

// La fixture est MUTABLE : les preuves de la frise (une étape non franchie)
// exigent un autre statut que le cas nominal.
const BASE_ORDER = {
  order_number: 'ORD-001',
  status: 'completed',
  order_type: 'dine_in',
  table_number: null,
  created_at: '2026-05-22T10:00:00Z',
  paid_at: '2026-05-22T10:05:00Z',
  sent_to_kitchen_at: null,
  customer_id: 'c-1',
  customer_name: 'Café Bali',
  served_by: 'u-1',
  served_by_name: 'Alice Cashier',
  subtotal: 100_000,
  discount_amount: 10_000,
  tax_amount: 9_000,
  total: 99_000,
  items: [
    {
      id: 'i-1',
      product_id: 'p-1',
      name_snapshot: 'Croissant',
      quantity: 2,
      unit_price: 25_000,
      line_total: 50_000,
      modifiers: null,
      is_cancelled: false,
      kitchen_status: 'pending',
    },
  ],
  payments: [
    {
      id: 'pay-1',
      method: 'cash',
      amount: 99_000,
      cash_received: 100_000,
      change_given: 1_000,
      paid_at: '2026-05-22T10:05:00Z',
      reference: null,
    },
  ],
  refunds: [],
  promotions: [{ description: 'Happy Hour −15%', name: 'Happy Hour', amount: 15_000 }],
};

let orderOverrides: Record<string, unknown> = {};

// Seul le hook est doublé. `isOrderDetailPaid` vit dans `statusMeta` (sans IO)
// et n'est PAS mocké : la page se prouve contre la vraie définition partagée.
vi.mock('@/features/orders/hooks/useOrderDetail.js', () => ({
  useOrderDetail: (id: string) => ({
    isLoading: false,
    data: { id, ...BASE_ORDER, ...orderOverrides },
  }),
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/backoffice/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrderDetailPage', () => {
  beforeEach(() => { orderOverrides = {}; });

  it('renders order header with number + status + customer drill', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /ORD-001/ })).toBeInTheDocument());
    expect(screen.getAllByText(/completed/i).length).toBeGreaterThan(0);
    const custLink = screen.getByRole('link', { name: /Café Bali/ });
    expect(custLink.getAttribute('href')).toBe('/backoffice/customers/c-1');
  });

  it('renders items + payments table with product drill', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByText('Croissant')).toBeInTheDocument());
    const prodLink = screen.getByRole('link', { name: /Croissant/ });
    expect(prodLink.getAttribute('href')).toBe('/backoffice/products/p-1');
    expect(screen.getAllByText(/cash/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/99\.000|99,000/).length).toBeGreaterThan(0);
  });

  // Refonte Document (ADR-025) : le bouton « Back » cède au fil d'Ariane —
  // l'invariant C4/BO-12 (retour vers /backoffice/orders, pas /backoffice)
  // est désormais porté par le lien « Orders » du breadcrumb.
  it('T3 (C4/BO-12) breadcrumb Orders link points to /backoffice/orders, not /backoffice', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /ORD-001/ })).toBeInTheDocument());
    const nav = screen.getByRole('navigation', { name: /breadcrumb/i });
    const ordersLink = within(nav).getByRole('link', { name: 'Orders' });
    expect(ordersLink.getAttribute('href')).toBe('/backoffice/orders');
  });

  it('renders a named promotion line between Discount and PB1', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /ORD-001/ })).toBeInTheDocument());
    expect(screen.getByText('Happy Hour −15%')).toBeInTheDocument();
    expect(screen.getAllByText(/15\.000|15,000/).length).toBeGreaterThan(0);
  });

  // ── Audit UX/UI 2026-08-13, lot 6a ────────────────────────────────────────

  // NON-PKP (ADR-005) : la PB1 est INCLUSE. La pile nomme donc la base HORS
  // taxe et le total TAXE COMPRISE — « Subtotal » ne disait ni l'un ni l'autre.
  it('T9 (lot 6a) totals name the PB1 boundary: base excludes it, total includes it', async () => {
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /ORD-001/ })).toBeInTheDocument());
    expect(screen.getByText('Base (excl. PB1)')).toBeInTheDocument();
    expect(screen.getByText('PB1 (included)')).toBeInTheDocument();
    expect(screen.getByText('Total (incl. PB1)')).toBeInTheDocument();
    expect(screen.queryByText('Subtotal')).toBeNull();
    // 100 000 − 9 000 = 91 000, calculé à l'affichage seulement.
    expect(screen.getAllByText(/91\.000|91,000/).length).toBeGreaterThan(0);
  });

  // Une base négative (données legacy) s'affiche TELLE QUELLE : un clamp
  // masquerait l'anomalie au lieu de la montrer.
  it('T10 (lot 6a) a negative base is rendered as-is, never clamped to zero', async () => {
    orderOverrides = { subtotal: 5_000, tax_amount: 9_000 };
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByText('Base (excl. PB1)')).toBeInTheDocument());
    expect(screen.getAllByText(/-\s?(Rp\s?)?4\.000|−\s?(Rp\s?)?4\.000|4,000/).length).toBeGreaterThan(0);
  });

  // « Completedpending » : deux nœuds texte adjacents, séparés par une marge
  // CSS que ni le presse-papier ni un lecteur d'écran ne voient.
  it('T11 (lot 6a) an unreached timeline step carries a TEXTUAL separator', async () => {
    orderOverrides = { status: 'paid' }; // « Completed » reste à franchir
    renderAt('/backoffice/orders/o-1');
    const step = await screen.findByText(/Completed/);
    expect(step.textContent).toContain('— pending');
    expect(step.textContent).not.toContain('Completedpending');
  });

  // L'étape Paid non franchie passe par la MÊME construction.
  it('T12 (lot 6a) the unreached Paid step is separated the same way', async () => {
    orderOverrides = { status: 'draft', paid_at: null, payments: [] };
    renderAt('/backoffice/orders/o-1');
    const step = await screen.findByText(/^Paid/);
    expect(step.textContent).toContain('— pending');
  });

  // Réglé par `paid_at` seul (règlement B2B, zéro ligne order_payments) :
  // même définition partagée que le tiroir.
  it('T13 (lot 6a) paid_at alone settles the order — no Unpaid badge', async () => {
    orderOverrides = { status: 'draft', payments: [], paid_at: '2026-05-22T10:05:00Z' };
    renderAt('/backoffice/orders/o-1');
    await waitFor(() => expect(screen.getByRole('heading', { name: /ORD-001/ })).toBeInTheDocument());
    expect(screen.queryByText('Unpaid')).toBeNull();
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
  });
});
