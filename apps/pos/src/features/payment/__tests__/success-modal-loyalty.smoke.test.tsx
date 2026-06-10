/// <reference types="@testing-library/jest-dom" />
// apps/pos/src/features/payment/__tests__/success-modal-loyalty.smoke.test.tsx
//
// Session 37 — B3: SuccessModal must use the loyaltyBalanceAfter prop instead
// of the hardcoded 0, and must OMIT the loyalty balance_after field entirely
// when the prop is absent.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { printReceipt } from '@/services/print/printService';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { SuccessModal, type SuccessModalProps } from '../SuccessModal';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) } }, supabaseUrl: 'http://x' }));
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({ useStationPrinters: () => ({ data: new Map([['cashier', { ip_address: '1.1.1.1', port: 9100, name: 'C' }]]) }) }));
vi.mock('@/services/print/printService', () => ({
  printReceipt: vi.fn().mockResolvedValue({ success: true }),
  openCashDrawer: vi.fn().mockResolvedValue({ success: true }), // used via auto-open, kept for completeness
  getMockPrintBuffer: () => [],
  clearMockPrintBuffer: () => undefined,
}));

const printMock = vi.mocked(printReceipt);

function props(p?: Partial<SuccessModalProps>): SuccessModalProps {
  return {
    open: true,
    orderNumber: 'O1',
    total: 50000,
    changeGiven: 0,
    pointsEarned: 10,
    cashReceived: 50000,
    cashierName: 'Alice',
    cart: {
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 50000, quantity: 1, modifiers: [] }],
      order_type: 'dine_in',
    },
    paymentMethod: 'cash',
    onNewOrder: vi.fn(),
    ...p,
  };
}

function wrap(n: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePosSettingsStore.setState({ printerUrl: '', autoPrint: true, autoOpenDrawer: false });
});

describe('SuccessModal — loyalty balance (POS-04)', () => {
  it('uses loyaltyBalanceAfter in the receipt payload when the prop is provided', async () => {
    render(wrap(<SuccessModal {...props({ loyaltyBalanceAfter: 1234 })} />));

    await waitFor(() => expect(printMock).toHaveBeenCalled());

    const payload = printMock.mock.calls[0]?.[0];
    expect(payload?.loyalty).toBeDefined();
    expect(payload?.loyalty?.balance_after).toBe(1234);
  });

  it('omits loyalty.balance_after entirely when loyaltyBalanceAfter is absent', async () => {
    // Do NOT pass loyaltyBalanceAfter prop — old behaviour was balance_after: 0
    render(wrap(<SuccessModal {...props()} />));

    await waitFor(() => expect(printMock).toHaveBeenCalled());

    const payload = printMock.mock.calls[0]?.[0];
    // loyalty section may exist (points_earned) but balance_after must not be 0
    if (payload?.loyalty) {
      expect(payload.loyalty.balance_after).toBeUndefined();
    }
  });
});
