/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { printReceipt, openCashDrawer } from '@/services/print/printService';
import { useOrgDisplaySettings } from '@/features/settings/hooks/useOrgDisplaySettings';
import { SuccessModal, type SuccessModalProps } from '../SuccessModal';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) } }, supabaseUrl: 'http://x' }));
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({ useStationPrinters: () => ({ data: new Map([['cashier', { ip_address: '1.1.1.1', port: 9100, name: 'C' }]]) }) }));
vi.mock('@/services/print/printService', () => ({ printReceipt: vi.fn().mockResolvedValue({ success: true }), openCashDrawer: vi.fn().mockResolvedValue({ success: true }), getMockPrintBuffer: () => [], clearMockPrintBuffer: () => undefined }));
// Settings 6.A - identity is an async business_config read now; mock it resolved
vi.mock('@/features/settings/hooks/useReceiptTemplate', () => ({
  useReceiptTemplate: () => ({ template: null, isLoading: false }),
}));
vi.mock('@/features/settings/hooks/useBusinessIdentity', () => ({
  useBusinessIdentity: () => ({ name: 'The Breakery', address: 'Jl. Test No. 1', isLoading: false }),
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

const printMock = vi.mocked(printReceipt);
const drawerMock = vi.mocked(openCashDrawer);
const useOrgDisplaySettingsMock = vi.mocked(useOrgDisplaySettings);

function props(p?: Partial<SuccessModalProps>): SuccessModalProps {
  return { open: true, orderNumber: 'O1', total: 1000, changeGiven: 0, pointsEarned: 0, cashReceived: 1000, cashierName: 'C',
    cart: { items: [{ id: 'l1', product_id: 'p1', name: 'X', unit_price: 1000, quantity: 1, modifiers: [] }], order_type: 'dine_in' },
    paymentMethod: 'cash', onNewOrder: vi.fn(), ...p };
}
function wrap(n: React.ReactElement) { return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>; }

beforeEach(() => {
  vi.clearAllMocks();
  useOrgDisplaySettingsMock.mockReturnValue({
    displayFooterMessage: '',
    displaySlogan: '',
    autoPrint: true,
    autoOpenDrawer: true,
    isLoading: false,
  });
});

describe('SuccessModal auto toggles', () => {
  it('autoPrint=false skips printReceipt on mount', async () => {
    useOrgDisplaySettingsMock.mockReturnValue({
      displayFooterMessage: '',
      displaySlogan: '',
      autoPrint: false,
      autoOpenDrawer: true,
      isLoading: false,
    });
    render(wrap(<SuccessModal {...props()} />));
    await waitFor(() => expect(drawerMock).toHaveBeenCalled());
    expect(printMock).not.toHaveBeenCalled();
  });

  it('autoOpenDrawer=false skips openCashDrawer on mount', async () => {
    useOrgDisplaySettingsMock.mockReturnValue({
      displayFooterMessage: '',
      displaySlogan: '',
      autoPrint: true,
      autoOpenDrawer: false,
      isLoading: false,
    });
    render(wrap(<SuccessModal {...props()} />));
    await waitFor(() => expect(printMock).toHaveBeenCalled());
    expect(drawerMock).not.toHaveBeenCalled();
  });

  // S73 Lot 2 review fix — the effect must WAIT for the org config to resolve.
  // Firing while isLoading would use the built-in DEFAULTS (true/true) and
  // ignore an org that disabled auto-open-drawer as a fraud control.
  it('waits for org config to resolve, then fires once respecting autoOpenDrawer=false', async () => {
    useOrgDisplaySettingsMock.mockReturnValue({
      displayFooterMessage: '',
      displaySlogan: '',
      autoPrint: true,
      autoOpenDrawer: false,
      isLoading: true,
    });
    const { rerender } = render(wrap(<SuccessModal {...props()} />));
    // Gated: nothing fires while the config is still loading — if the gate
    // were missing, the effect would already have fired at mount.
    await new Promise((r) => setTimeout(r, 50));
    expect(printMock).not.toHaveBeenCalled();
    expect(drawerMock).not.toHaveBeenCalled();

    // Config resolves → the effect fires exactly once with the REAL values:
    // print yes (autoPrint true), drawer NO (org disabled it).
    useOrgDisplaySettingsMock.mockReturnValue({
      displayFooterMessage: '',
      displaySlogan: '',
      autoPrint: true,
      autoOpenDrawer: false,
      isLoading: false,
    });
    rerender(wrap(<SuccessModal {...props()} />));
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
    expect(drawerMock).not.toHaveBeenCalled();
  });
});
