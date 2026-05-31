// apps/pos/src/features/cart/__tests__/fire-printer-unreachable.smoke.test.tsx
//
// Session 34 / W4 — kitchen printer absent from map.
//
// Scenario: barista printer present, kitchen printer ABSENT.
// After clicking "Send to Kitchen":
//   • toast.error is called mentioning kitchen.
//   • 'line-kitchen' is NOT in printedItemIds.
//   • 'line-barista' IS in printedItemIds.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { clearMockPrintBuffer } from '@/services/print/printService';

// ── Static mocks ──────────────────────────────────────────────────────────────

const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('sonner', () => ({
  toast: toastMock,
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
  supabaseUrl: 'http://localhost:54321',
}));

// Only barista printer — kitchen is absent.
const PRINTERS_MAP_NO_KITCHEN = new Map([
  ['barista', { ip_address: '192.168.1.11', port: 9100, name: 'Barista' }],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP_NO_KITCHEN }),
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
  qc.setQueryData(['products'], PRODUCTS);
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SendToKitchenButton — kitchen printer unreachable', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    toastMock.error.mockReset();

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

  it('toasts kitchen error, keeps kitchen line unprinted, marks barista line printed', async () => {
    const { SendToKitchenButton } = await import('../SendToKitchenButton');

    render(withQuery(<SendToKitchenButton />));

    const btn = screen.getByRole('button', { name: /send to kitchen/i });

    await act(async () => {
      btn.click();
    });

    // Wait for the mutation to settle — button re-enables (firableCount > 0
    // because kitchen item remains unprinted).
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });

    // toast.error should mention 'kitchen'.
    const errorCall = toastMock.error.mock.calls.find((args: unknown[]) =>
      String(args[0]).toLowerCase().includes('kitchen'),
    );
    expect(errorCall).toBeDefined();

    const printed = useCartStore.getState().printedItemIds;

    // Barista succeeded → in printedItemIds.
    expect(printed).toContain('line-barista');

    // Kitchen failed (no printer) → NOT in printedItemIds.
    expect(printed).not.toContain('line-kitchen');
  });
});
