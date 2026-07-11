// apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx
//
// Session 34 / W4 — SuccessModal routes receipt to cashier printer.
//
// Tests the SuccessModal in isolation (not through the full PaymentTerminal)
// to verify that on mount/open, printReceipt is called with the cashier
// printer from useStationPrinters.
//
// Under VITE_PRINT_MOCK=1, printReceipt pushes to the mock buffer instead
// of making a network call. We inspect the buffer to confirm:
//   • a 'receipt' entry is present.
//   • its `printer` equals the cashier printer target.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import {
  getMockPrintBuffer,
  clearMockPrintBuffer,
} from '@/services/print/printService';
import type { ReceiptPayload } from '@/services/print/printService';
import type { SuccessModalProps } from '../SuccessModal';

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

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({
    data: new Map([['cashier', CASHIER_PRINTER]]),
  }),
}));

// S73 Lot 2 — the auto toggles are org-level (business_config) now; mock them
// resolved-on so the gated mount effect fires immediately (the supabase mock
// above has no .from, the real query would stall the effect past waitFor).
vi.mock('@/features/settings/hooks/useOrgDisplaySettings', () => ({
  useOrgDisplaySettings: () => ({
    displayFooterMessage: '',
    displaySlogan: '',
    autoPrint: true,
    autoOpenDrawer: true,
    isLoading: false,
  }),
}));

// openCashDrawer is a side-effect in SuccessModal. Mock fetch so it doesn't
// hit the network (it runs concurrently with handlePrint on mount).
const originalFetch = globalThis.fetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function buildProps(overrides?: Partial<SuccessModalProps>): SuccessModalProps {
  return {
    open: true,
    orderNumber: 'ORD-999',
    total: 55_000,
    changeGiven: 5_000,
    pointsEarned: 0,
    cashReceived: 60_000,
    cashierName: 'Test Cashier',
    cart: {
      items: [
        { id: 'line-1', product_id: 'p1', name: 'Espresso', unit_price: 25_000, quantity: 1, modifiers: [] },
      ],
      order_type: 'dine_in',
    },
    paymentMethod: 'cash',
    onNewOrder: vi.fn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuccessModal — receipt routed to cashier printer', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();

    // Mock fetch for openCashDrawer (side-effect on mount).
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
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
      permissions: [],
      isAuthenticated: true,
      isLoading: false,
      error: null,
    } as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('places a receipt entry in the mock buffer routed to the cashier printer', async () => {
    const { SuccessModal } = await import('../SuccessModal');
    const props = buildProps();

    render(withQuery(<SuccessModal {...props} />));

    // Wait for the auto-print useEffect to fire and populate the buffer.
    await waitFor(() => {
      const buf = getMockPrintBuffer();
      return buf.some((e) => e.kind === 'receipt');
    });

    const buf = getMockPrintBuffer();
    const receiptEntries = buf.filter((e) => e.kind === 'receipt');

    expect(receiptEntries).toHaveLength(1);

    const entry = receiptEntries[0]!;

    // Routed to the cashier printer.
    expect(entry.printer).toEqual(CASHIER_PRINTER);

    // Payload shape sanity checks — narrow via cast (we know it's a receipt entry).
    const payload = entry.payload as ReceiptPayload;
    expect(payload.order.order_number).toBe('ORD-999');
    expect(payload.payment).toBeDefined();
  });
});
