// apps/pos/src/features/cart/__tests__/fire-to-stations.smoke.test.tsx
//
// Session 34 / W4 — smoke test for SendToKitchenButton → useFireToStations.
//
// Scenario: cart with one barista item + one kitchen item.
// Both stations have printers in the map.
// After clicking "Send to Kitchen":
//   • getMockPrintBuffer() has two 'prep' entries (one per station).
//   • cartStore.printedItemIds includes both line ids.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const BARISTA_PRINTER = { ip_address: '192.168.1.11', port: 9100, name: 'Barista' };
const KITCHEN_PRINTER = { ip_address: '192.168.1.12', port: 9100, name: 'Kitchen' };

const PRINTERS_MAP = new Map([
  ['barista', BARISTA_PRINTER],
  ['kitchen', KITCHEN_PRINTER],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

const PRODUCTS = [
  { id: 'p-barista', name: 'Latte', dispatch_station: 'barista' },
  { id: 'p-kitchen', name: 'Omelette', dispatch_station: 'kitchen' },
];

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: PRODUCTS }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Pre-seed products cache so useFireToStations mutationFn reads it.
  qc.setQueryData(['products'], PRODUCTS);
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SendToKitchenButton — fire to stations smoke', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();

    // Cart: one barista item + one kitchen item, both unprinted.
    useCartStore.setState({
      cart: {
        items: [
          { id: 'line-barista', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
          { id: 'line-kitchen', product_id: 'p-kitchen', name: 'Omelette', unit_price: 45_000, quantity: 1, modifiers: [] },
        ],
        order_type: 'dine_in',
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
    } as never);
  });

  it('prints prep tickets to both stations and marks both lines as printed', async () => {
    // Lazy import so vi.stubEnv + mocks are in place first.
    const { SendToKitchenButton } = await import('../SendToKitchenButton');

    render(withQuery(<SendToKitchenButton />));

    const btn = screen.getByRole('button', { name: /send to kitchen/i });
    expect(btn).not.toBeDisabled();

    await act(async () => {
      btn.click();
    });

    // Wait for mutation to complete (button returns to non-pending).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send to kitchen/i })).toBeInTheDocument();
    });

    const buf = getMockPrintBuffer();
    const prepEntries = buf.filter((e) => e.kind === 'prep');

    // One prep entry per station.
    expect(prepEntries).toHaveLength(2);

    const stationRoles = prepEntries.map((e) => (e.payload as { role: string }).role);
    expect(stationRoles).toContain('barista');
    expect(stationRoles).toContain('kitchen');

    // Both entries are kind 'prep'.
    for (const entry of prepEntries) {
      expect(entry.kind).toBe('prep');
    }

    // Cart store: both line ids are now in printedItemIds.
    const printed = useCartStore.getState().printedItemIds;
    expect(printed).toContain('line-barista');
    expect(printed).toContain('line-kitchen');
  });
});
