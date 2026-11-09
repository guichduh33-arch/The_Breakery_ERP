// S1-21 — la caisse choisit l'imprimante de l'addition, et l'addition est chiffrée.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { StationTicketPayload } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { getMockPrintBuffer, clearMockPrintBuffer } from '@/services/print/printService';
import { PrintBillButton } from '../PrintBillButton';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('@/features/settings/hooks/useTaxConfig', () => ({
  useTaxConfig: () => ({ taxRate: 0.1, taxInclusive: false }),
}));

const CASHIER = { ip_address: '192.168.1.10', port: 9100, name: 'Cashier' };
const WAITER = { ip_address: '192.168.1.11', port: 9100, name: 'Waiter' };
let printers: { data?: Map<string, typeof CASHIER>; isLoading?: boolean } = {};

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => printers,
}));

function renderButton() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PrintBillButton /></QueryClientProvider>);
}

describe('PrintBillButton — printer choice', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    vi.mocked(toast.error).mockClear();
    printers = { data: new Map([['cashier', CASHIER], ['waiter', WAITER]]) };
    useCartStore.setState({
      cart: {
        items: [
          { id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30_000, quantity: 1,
            modifiers: [{ group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5_000 }] },
          { id: 'l2', product_id: 'p2', name: 'Croissant', unit_price: 25_000, quantity: 2, modifiers: [] },
        ],
        order_type: 'dine_in',
        tableNumber: '4',
        promotionTotal: 5_000,
      },
      printedItemIds: [],
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
      isOffline: false,
    });
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'EMP1' },
      sessionToken: 'tok',
      permissions: ['pos.sale.create'],
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it('offers one entry per configured bill printer', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Print bill · Cashier printer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Print bill · Waiter printer' })).toBeEnabled();
  });

  it('prints a priced bill on the printer the user picked, even for a table order', async () => {
    renderButton();
    act(() => { screen.getByRole('button', { name: 'Print bill · Cashier printer' }).click(); });
    await waitFor(() => expect(getMockPrintBuffer().filter((e) => e.kind === 'bill')).toHaveLength(1));
    const entry = getMockPrintBuffer().find((e) => e.kind === 'bill')!;
    expect(entry.printer).toEqual(CASHIER);
    const payload = entry.payload as StationTicketPayload;
    expect(payload.role).toBe('cashier');
    expect(payload.order_number).toBe('Table 4');
    expect(payload.items.map((i) => i.line_total)).toEqual([35_000, 50_000]);
    // Exclusive : 85 000 − 5 000 = 80 000, taxe 8 000, total 88 000.
    expect(payload.totals).toEqual({ subtotal: 85_000, discount: 5_000, tax: 8_000, tax_inclusive: false, total: 88_000 });
    expect(payload).not.toHaveProperty('payment');
  });

  it('routes to the waiter printer when that entry is chosen', async () => {
    renderButton();
    act(() => { screen.getByRole('button', { name: 'Print bill · Waiter printer' }).click(); });
    await waitFor(() => expect(getMockPrintBuffer().filter((e) => e.kind === 'bill')).toHaveLength(1));
    expect(getMockPrintBuffer().find((e) => e.kind === 'bill')!.printer).toEqual(WAITER);
  });

  it('shows a single entry when only the waiter printer exists', () => {
    printers = { data: new Map([['waiter', WAITER]]) };
    renderButton();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Print bill · Waiter printer' })).toBeEnabled();
  });

  it('keeps a disabled entry explaining that no bill printer is configured', () => {
    printers = { data: new Map([['kitchen', CASHIER]]) };
    renderButton();
    const btn = screen.getByRole('button', { name: /print bill/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('No cashier or waiter printer configured');
  });

  it('disables the entries when the cart has no live item', () => {
    useCartStore.setState((s) => ({ cart: { ...s.cart, items: [] } }));
    renderButton();
    for (const btn of screen.getAllByRole('button')) expect(btn).toBeDisabled();
  });
});
