/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { printReceipt, openCashDrawer } from '@/services/print/printService';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { SuccessModal, type SuccessModalProps } from '../SuccessModal';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) } }, supabaseUrl: 'http://x' }));
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({ useStationPrinters: () => ({ data: new Map([['cashier', { ip_address: '1.1.1.1', port: 9100, name: 'C' }]]) }) }));
vi.mock('@/services/print/printService', () => ({ printReceipt: vi.fn().mockResolvedValue({ success: true }), openCashDrawer: vi.fn().mockResolvedValue({ success: true }), getMockPrintBuffer: () => [], clearMockPrintBuffer: () => undefined }));

const printMock = vi.mocked(printReceipt);
const drawerMock = vi.mocked(openCashDrawer);

function props(p?: Partial<SuccessModalProps>): SuccessModalProps {
  return { open: true, orderNumber: 'O1', total: 1000, changeGiven: 0, pointsEarned: 0, cashReceived: 1000, cashierName: 'C',
    cart: { items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
    paymentMethod: 'cash', onNewOrder: vi.fn(), ...p };
}
function wrap(n: React.ReactElement) { return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>; }

beforeEach(() => { vi.clearAllMocks(); usePosSettingsStore.setState({ printerUrl: '', autoPrint: true, autoOpenDrawer: true }); });

describe('SuccessModal auto toggles', () => {
  it('autoPrint=false skips printReceipt on mount', async () => {
    usePosSettingsStore.setState({ autoPrint: false, autoOpenDrawer: true });
    render(wrap(<SuccessModal {...props()} />));
    await waitFor(() => expect(drawerMock).toHaveBeenCalled());
    expect(printMock).not.toHaveBeenCalled();
  });

  it('autoOpenDrawer=false skips openCashDrawer on mount', async () => {
    usePosSettingsStore.setState({ autoPrint: true, autoOpenDrawer: false });
    render(wrap(<SuccessModal {...props()} />));
    await waitFor(() => expect(printMock).toHaveBeenCalled());
    expect(drawerMock).not.toHaveBeenCalled();
  });
});
