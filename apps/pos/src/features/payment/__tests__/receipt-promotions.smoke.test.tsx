// apps/pos/src/features/payment/__tests__/receipt-promotions.smoke.test.tsx
//
// Task 4 (session 60, fiche 13 D1.1) — the printed receipt payload must carry
// named promotion lines (props.appliedPromotions), not just the aggregate
// promotion_total the server envelope already exposes. Snapshot pattern
// mirrors receipt-payment-method.smoke.test.tsx (VITE_PRINT_MOCK harness).

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
// Settings 6.A - identity is an async business_config read now; mock it resolved
vi.mock('@/features/settings/hooks/useBusinessIdentity', () => ({
  useBusinessIdentity: () => ({ name: 'The Breakery', address: 'Jl. Test No. 1', isLoading: false }),
}));
vi.mock('@/features/settings/hooks/useOrgDisplaySettings', () => ({
  useOrgDisplaySettings: () => ({
    displayFooterMessage: '',
    displaySlogan: '',
    autoPrint: true,
    autoOpenDrawer: true,
    isLoading: false,
  }),
}));

const originalFetch = globalThis.fetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function buildProps(overrides?: Partial<SuccessModalProps>): SuccessModalProps {
  return {
    open: true,
    orderNumber: 'ORD-777',
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

async function renderAndGetReceipt(props: SuccessModalProps): Promise<ReceiptPayload> {
  const { SuccessModal } = await import('../SuccessModal');
  render(withQuery(<SuccessModal {...props} />));
  await waitFor(() => {
    expect(getMockPrintBuffer().some((e) => e.kind === 'receipt')).toBe(true);
  });
  const entry = getMockPrintBuffer().find((e) => e.kind === 'receipt')!;
  return entry.payload as ReceiptPayload;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuccessModal — receipt carries named promotion lines', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

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
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('T1/T2 — a percentage promo becomes a named line + fills totals.promotion_total', async () => {
    const payload = await renderAndGetReceipt(buildProps({
      appliedPromotions: [
        { promotion_id: 'p1', slug: 'happy-hour', name: 'Happy Hour −15%', type: 'percentage', amount: 15_000, description: '' },
      ],
    }));
    expect(payload.promotions).toEqual([{ name: 'Happy Hour −15%', amount: 15_000 }]);
    expect(payload.totals.promotion_total).toBe(15_000);
  });

  it('T3 — no promos → payload.promotions absent or empty', async () => {
    const payload = await renderAndGetReceipt(buildProps());
    expect(payload.promotions ?? []).toEqual([]);
  });

  it('free_product promo (amount=0) is kept and labelled "(free item)"', async () => {
    const payload = await renderAndGetReceipt(buildProps({
      appliedPromotions: [
        { promotion_id: 'p2', slug: 'bogo', name: 'Buy 1 Get 1', type: 'free_product', amount: 0, description: '' },
      ],
    }));
    expect(payload.promotions).toEqual([{ name: 'Buy 1 Get 1 (free item)', amount: 0 }]);
    expect(payload.totals.promotion_total).toBe(0);
  });

  it('a zero/negative non-free_product promo is filtered out', async () => {
    const payload = await renderAndGetReceipt(buildProps({
      appliedPromotions: [
        { promotion_id: 'p3', slug: 'void-promo', name: 'Should Not Appear', type: 'percentage', amount: 0, description: '' },
      ],
    }));
    expect(payload.promotions ?? []).toEqual([]);
  });
});
