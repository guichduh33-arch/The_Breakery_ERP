// apps/pos/src/__tests__/print.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { printReceipt, openCashDrawer, checkPrintServer } from '@/services/print/printService';
import type { ReceiptPayload } from '@/services/print/printService';
import { SuccessModal } from '@/features/payment/SuccessModal';
import { useCartStore } from '@/stores/cartStore';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { setSession: vi.fn(), signOut: vi.fn().mockResolvedValue({}) } },
  supabaseUrl: 'http://localhost:54321',
}));

// S73 Lot 2 — SuccessModal's fire-once effect is gated on the org-config
// query resolving (useOrgDisplaySettings). The supabase mock above has no
// .from(), so the real hook would error + retry (~1 s) and push auto-print
// past waitFor's timeout. Mock it resolved, like the auto-toggles smoke.
// Settings §6.A — same gating applies to the business identity read and the
// default receipt template read.
vi.mock('@/features/settings/hooks/useBusinessIdentity', () => ({
  useBusinessIdentity: () => ({ name: 'The Breakery', address: 'Jl. Test No. 1', isLoading: false }),
}));
vi.mock('@/features/settings/hooks/useReceiptTemplate', () => ({
  useReceiptTemplate: () => ({ template: null, isLoading: false }),
}));
vi.mock('@/features/settings/hooks/useOrgDisplaySettings', () => ({
  useOrgDisplaySettings: vi.fn(() => ({
    displayFooterMessage: '',
    displaySlogan: '',
    autoPrint: true,
    autoOpenDrawer: true,
    isLoading: false,
  })),
}));

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const SAMPLE_PAYLOAD: ReceiptPayload = {
  business: { name: 'The Breakery', address: 'Jl. Contoh No. 1' },
  order: {
    order_number: '#0001',
    created_at: '2026-05-06T00:00:00.000Z',
    cashier_name: 'Admin',
    order_type: 'dine_in',
  },
  items: [{ name: 'Americano', quantity: 1, unit_price: 35000, line_total: 35000 }],
  totals: { items_total: 35000, redemption_amount: 0, total: 35000, tax_amount: 3200 },
  payment: { method: 'cash', amount: 35000, cash_received: 50000, change_given: 15000 },
  footer: 'Thank you!',
};

describe('printService unit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('printReceipt posts correct payload shape to /print/receipt', async () => {
    let capturedBody: ReceiptPayload | null = null;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as ReceiptPayload;
      return Promise.resolve({ ok: true });
    }));

    const result = await printReceipt(SAMPLE_PAYLOAD);
    expect(result.success).toBe(true);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.order.order_number).toBe('#0001');
    expect(capturedBody!.totals.items_total).toBe(35000);
    expect(capturedBody!.payment.method).toBe('cash');
  });

  it('printReceipt returns success:false on network error (no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));
    const result = await printReceipt(SAMPLE_PAYLOAD);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
  });

  it('printReceipt returns success:false on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await printReceipt(SAMPLE_PAYLOAD);
    expect(result.success).toBe(false);
    expect(result.error).toBe('HTTP 503');
  });

  it('openCashDrawer posts to /drawer/open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const result = await openCashDrawer();
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/drawer/open',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('openCashDrawer returns success:false on failure (no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const result = await openCashDrawer();
    expect(result.success).toBe(false);
  });

  it('checkPrintServer returns true on 200 /health', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect(await checkPrintServer()).toBe(true);
  });

  it('checkPrintServer returns false on network failure (no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await checkPrintServer()).toBe(false);
  });
});

describe('SuccessModal auto-print integration', () => {
  beforeEach(() => {
    vi.mocked(toast.warning).mockClear();
    useCartStore.setState({
      cart: { items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-fires printReceipt on mount and shows no toast when print server is up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    render(wrapper(
      <SuccessModal
        open
        orderNumber="#0042"
        total={35000}
        changeGiven={15000}
        pointsEarned={35}
        cart={useCartStore.getState().cart}
        paymentMethod="cash"
        cashReceived={50000}
        cashierName="Admin"
        onNewOrder={vi.fn()}
      />
    ));

    await waitFor(() => {
      // S43 E2: FullScreenModal renders an sr-only span title "Payment successful"
      // in addition to the visible <h2> — query by heading role to disambiguate.
      expect(screen.getByRole('heading', { name: /payment successful/i })).toBeInTheDocument();
    });
    expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
  });

  it('shows toast warning when print server fails but order stays completed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    render(wrapper(
      <SuccessModal
        open
        orderNumber="#0043"
        total={35000}
        changeGiven={0}
        cart={useCartStore.getState().cart}
        paymentMethod="cash"
        cashReceived={35000}
        cashierName="Admin"
        onNewOrder={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(vi.mocked(toast.warning)).toHaveBeenCalledWith('Print server unreachable — receipt not printed');
    });
    // Heading query — the sr-only dialog title duplicates the text (S43 E2 a11y).
    expect(screen.getByRole('heading', { name: /payment successful/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reprint/i })).toBeInTheDocument();
  });

  it('shows Reprint button in SuccessModal', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    render(wrapper(
      <SuccessModal
        open
        orderNumber="#0044"
        total={35000}
        changeGiven={0}
        cart={useCartStore.getState().cart}
        paymentMethod="cash"
        cashReceived={35000}
        cashierName="Admin"
        onNewOrder={vi.fn()}
      />
    ));
    expect(screen.getByRole('button', { name: /reprint/i })).toBeInTheDocument();
  });

  it('payload includes loyalty info when points earned', async () => {
    let capturedBody: ReceiptPayload | null = null;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as ReceiptPayload;
      return Promise.resolve({ ok: true });
    }));

    render(wrapper(
      <SuccessModal
        open
        orderNumber="#0045"
        total={35000}
        changeGiven={0}
        pointsEarned={35}
        customerName="Loyal Gold Customer"
        cart={useCartStore.getState().cart}
        paymentMethod="cash"
        cashReceived={35000}
        cashierName="Admin"
        onNewOrder={vi.fn()}
      />
    ));

    await waitFor(() => {
      expect(capturedBody).not.toBeNull();
    });
    expect(capturedBody!.customer?.name).toBe('Loyal Gold Customer');
    expect(capturedBody!.loyalty?.points_earned).toBe(35);
  });
});
