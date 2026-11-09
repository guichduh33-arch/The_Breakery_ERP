// S1-21 — « Print bill » sur la tablette : commandes ouvertes seulement, choix
// de l'imprimante, montants serveur relus, désactivé hors ligne.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import type { StationTicketPayload } from '@breakery/domain';
import type { TabletConnection } from '../hooks/useTabletConnectionState';
import { useAuthStore } from '@/stores/authStore';
import TabletOrdersPage from '@/pages/tablet/TabletOrdersPage';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const WAITER = { ip_address: '192.168.1.11', port: 9100, name: 'Waiter' };
const CASHIER = { ip_address: '192.168.1.10', port: 9100, name: 'Cashier' };
const PRINTERS = new Map([['cashier', CASHIER], ['waiter', WAITER]]);
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS }),
  getStationPrinters: () => Promise.resolve(PRINTERS),
}));

const runPrintJob = vi.fn<(payload: StationTicketPayload, printer: unknown) => Promise<{ success: boolean; error?: string }>>();
vi.mock('@/services/print/printJobs', () => ({
  runPrintJob: (payload: StationTicketPayload, printer: unknown) => runPrintJob(payload, printer),
}));

let connection: TabletConnection;
vi.mock('../hooks/useTabletConnectionState', () => ({
  useTabletConnectionState: () => connection,
}));

const ORDERS = [
  { id: 'o-open', order_number: 'T1-0042', table_number: '7', order_type: 'dine_in', status: 'pending_payment',
    sent_to_kitchen_at: '2026-11-09T10:00:00Z', items: [{ id: 'i1', name: 'Latte', quantity: 1, kitchen_status: 'ready' }] },
  { id: 'o-paid', order_number: 'T1-0041', table_number: '2', order_type: 'dine_in', status: 'paid',
    sent_to_kitchen_at: '2026-11-09T09:00:00Z', items: [{ id: 'i2', name: 'Tea', quantity: 1, kitchen_status: 'served' }] },
];
vi.mock('../hooks/useMyTabletOrders', () => ({
  useMyTabletOrders: () => ({ data: ORDERS, isLoading: false }),
}));

// Ligne persistée : 1 latte 35 000 + combo 67 000 + une ligne annulée.
let orderRow: Record<string, unknown>;
const single = vi.fn(() => Promise.resolve({ data: orderRow, error: null }));
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ select })) },
  supabaseUrl: 'http://localhost:54321',
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><TabletOrdersPage /></MemoryRouter></QueryClientProvider>,
  );
}

describe('Tablet — print bill', () => {
  beforeEach(() => {
    runPrintJob.mockReset();
    runPrintJob.mockResolvedValue({ success: true });
    vi.mocked(toast.error).mockClear();
    connection = { state: 'online', isOnline: true, canSendOrders: true, lastSync: null, offlineSince: null };
    orderRow = {
      order_number: 'T1-0042', table_number: '7', status: 'pending_payment',
      subtotal: 102_000, discount_amount: 0, promotion_total: 0, loyalty_redemption_amount: 0,
      tax_amount: 9_300, total: 102_000,
      order_items: [
        { name_snapshot: 'Latte', quantity: 1, line_total: 35_000, is_cancelled: false,
          modifiers: [{ group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5_000 }], combo_components: null },
        { name_snapshot: 'Breakfast combo', quantity: 1, line_total: 67_000, is_cancelled: false, modifiers: [],
          combo_components: [{ name: 'Coffee', product_id: 'p4', quantity: 1,
            modifiers: [{ group_name: 'Size', option_label: 'Large', price_adjustment: 7_000 }] }] },
        { name_snapshot: 'Cake', quantity: 1, line_total: 40_000, is_cancelled: true, modifiers: [], combo_components: null },
      ],
    };
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Ayu', role_code: 'WAITER', employee_code: 'EMP2' },
      sessionToken: 'tok', permissions: [], isAuthenticated: true, isLoading: false, error: null,
    });
  });

  it('offers the printer choice on open orders only', () => {
    renderPage();
    expect(screen.getAllByRole('button', { name: /print bill for order T1-0042/i })).toHaveLength(2);
    // Toute action d'addition de la page, quel que soit son libellé : seule la commande ouverte en porte.
    expect(screen.getAllByRole('button', { name: /print bill/i })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /T1-0041/ })).not.toBeInTheDocument();
  });

  it('prints the server amounts of the order on the chosen printer', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print bill for order T1-0042 on the waiter printer' }));
    await waitFor(() => expect(runPrintJob).toHaveBeenCalledTimes(1));
    const [payload, printer] = runPrintJob.mock.calls[0]!;
    expect(printer).toEqual(WAITER);
    expect(eq).toHaveBeenCalledWith('id', 'o-open');
    expect(payload.kind).toBe('bill');
    expect(payload.role).toBe('waiter');
    expect(payload.order_number).toBe('Order T1-0042');
    expect(payload.server_name).toBe('Ayu');
    expect(payload.items.map((i) => [i.name, i.line_total])).toEqual([['Latte', 35_000], ['Breakfast combo', 67_000]]);
    expect(payload.items[1]!.modifiers).toEqual(['Coffee', 'Coffee: Large']);
    expect(payload.totals).toEqual({ subtotal: 102_000, tax: 9_300, tax_inclusive: true, total: 102_000 });
  });

  it('refuses to print an order that closed in the meantime', async () => {
    orderRow = { ...orderRow, status: 'paid' };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Print bill for order T1-0042 on the cashier printer' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This order is no longer open: no bill to print'));
    expect(runPrintJob).not.toHaveBeenCalled();
  });

  it('is disabled with a clear message when offline, and never queues a bill', () => {
    connection = { state: 'offline_bus', isOnline: false, canSendOrders: true, lastSync: null, offlineSince: new Date() };
    renderPage();
    const btn = screen.getByRole('button', { name: /print bill/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription('Offline: the bill needs a connection to read the order amounts');
    fireEvent.click(btn);
    expect(runPrintJob).not.toHaveBeenCalled();
  });
});
