// apps/pos/src/features/payment/__tests__/cash-drawer-error-toast.smoke.test.tsx
//
// Fix: pos-cash-drawer-error-toast (2026-06-01).
//
// SuccessModal pops the cash drawer on mount via openCashDrawer(). When the
// drawer fails to open (bridge unreachable / HTTP non-ok), the cashier must
// see a warning toast — but ONLY for cash payments, since card/QRIS never
// expect a drawer pop. These smokes lock in that behaviour:
//   T1 cash + drawer failure  -> toast.warning('Cash drawer did not open ...')
//   T2 card + drawer failure  -> NO drawer toast (false-warning guard)
//   T3 cash + drawer failure  -> modal still renders (receipt not blocked)
//
// openCashDrawer has no VITE_PRINT_MOCK branch, so we module-mock the print
// service to force the drawer result deterministically and keep printReceipt
// green (isolates the drawer toast from the print toast).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { openCashDrawer } from '@/services/print/printService';
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

// Module-mock the print service: printReceipt always succeeds (isolate drawer),
// openCashDrawer is a vi.fn we drive per-test. Mock buffer fns are no-op
// passthroughs so any other importer stays happy.
vi.mock('@/services/print/printService', () => ({
  printReceipt: vi.fn().mockResolvedValue({ success: true }),
  openCashDrawer: vi.fn(),
  getMockPrintBuffer: () => [],
  clearMockPrintBuffer: () => undefined,
}));

const openCashDrawerMock = vi.mocked(openCashDrawer);
const toastWarningMock = vi.mocked(toast.warning);

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

const DRAWER_TOAST = 'Cash drawer did not open — please open it manually';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuccessModal — cash drawer error toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_PRINT_MOCK', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T1: cash payment + drawer failure raises a warning toast', async () => {
    openCashDrawerMock.mockResolvedValue({ success: false, error: 'HTTP 503' });
    const { SuccessModal } = await import('../SuccessModal');

    render(withQuery(<SuccessModal {...buildProps({ paymentMethod: 'cash' })} />));

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith(DRAWER_TOAST);
    });
  });

  it('T2: card payment + drawer failure does NOT raise a drawer toast', async () => {
    openCashDrawerMock.mockResolvedValue({ success: false, error: 'HTTP 503' });
    const { SuccessModal } = await import('../SuccessModal');

    render(withQuery(<SuccessModal {...buildProps({ paymentMethod: 'card' })} />));

    // Give the mount effect a chance to run, then assert no drawer toast.
    await waitFor(() => {
      expect(openCashDrawerMock).toHaveBeenCalled();
    });
    expect(toastWarningMock).not.toHaveBeenCalledWith(DRAWER_TOAST);
  });

  it('T3: drawer failure does not block the modal (receipt not blocked)', async () => {
    openCashDrawerMock.mockResolvedValue({ success: false, error: 'HTTP 503' });
    const { SuccessModal } = await import('../SuccessModal');

    render(withQuery(<SuccessModal {...buildProps({ paymentMethod: 'cash' })} />));

    // The success modal still renders its content despite the drawer failure.
    expect(await screen.findByTestId('receipt-success')).toBeInTheDocument();
  });
});
