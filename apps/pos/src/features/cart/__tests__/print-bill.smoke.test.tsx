// apps/pos/src/features/cart/__tests__/print-bill.smoke.test.tsx
//
// Session 34 / W4 — PrintBillButton smoke.
//
// Scenario: walk-in order (no tableNumber → role='cashier').
// After clicking "Print Bill":
//   • getMockPrintBuffer() has a 'bill' entry.
//   • The entry targets the cashier printer.
//   • The payload has `totals` present and NO `payment` field.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import {
  getMockPrintBuffer,
  clearMockPrintBuffer,
} from '@/services/print/printService';

// ── Static mocks ──────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
  supabaseUrl: 'http://localhost:54321',
}));

const CASHIER_PRINTER = { ip_address: '192.168.1.10', port: 9100, name: 'Cashier' };

const PRINTERS_MAP = new Map([
  ['cashier', CASHIER_PRINTER],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PrintBillButton — bill targets cashier printer', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();

    // Walk-in order: no tableNumber, no pickedUpOrderId → role='cashier'.
    useCartStore.setState({
      cart: {
        items: [
          { id: 'line-1', product_id: 'p1', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
          { id: 'line-2', product_id: 'p2', name: 'Croissant', unit_price: 25_000, quantity: 2, modifiers: [] },
        ],
        order_type: 'dine_in',
        // No tableNumber → cashier
      },
      printedItemIds: [],
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null, // ← no pickup → cashier role
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
    } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prints a bill entry routed to the cashier printer with totals and no payment field', async () => {
    const { PrintBillButton } = await import('../PrintBillButton');

    render(withQuery(<PrintBillButton />));

    const btn = screen.getByRole('button', { name: /print bill/i });
    expect(btn).not.toBeDisabled();

    await act(async () => {
      btn.click();
    });

    await waitFor(() => {
      const buf = getMockPrintBuffer();
      expect(buf.length).toBeGreaterThan(0);
    });

    const buf = getMockPrintBuffer();
    const billEntries = buf.filter((e) => e.kind === 'bill');

    expect(billEntries).toHaveLength(1);

    const entry = billEntries[0]!;

    // Routed to cashier printer.
    expect(entry.printer).toEqual(CASHIER_PRINTER);

    // Payload has totals.
    expect(entry.payload).toHaveProperty('totals');
    expect(entry.payload.totals).toBeDefined();
    expect(entry.payload.totals?.total).toBeGreaterThan(0);

    // No payment field — this is a pre-payment bill.
    expect(entry.payload).not.toHaveProperty('payment');
  });
});
