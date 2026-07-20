// apps/pos/src/pages/__tests__/pos-lan-heartbeat.smoke.test.tsx
//
// Session 59 (21 D1.1) — proves useLanHeartbeat is actually mounted on the
// POS shell (Pos.tsx), not just on KDS/tablet. Every heavy child feature
// (products grid, cart panel, modals…) is stubbed to null — this test only
// exercises the shift/auth wiring PosPage needs to render, plus the
// heartbeat call itself.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args) as unknown },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('@/features/shift/hooks/useShift', () => ({
  useCurrentShift: () => ({ data: { id: 's1', opened_at: new Date().toISOString(), opening_cash: 0 }, isLoading: false }),
}));
vi.mock('@/features/shift/hooks/useShiftCloseSummary', () => ({
  useShiftCloseSummary: () => ({ data: undefined }),
}));

// Stub every heavy child feature — this test only proves the shell wiring.
vi.mock('@/features/products/CategoryNav', () => ({ CategoryNav: () => null }));
vi.mock('@/features/products/ProductTapHandler', () => ({ ProductTapHandler: () => null }));
vi.mock('@/features/nav/SideMenuDrawer', () => ({ SideMenuDrawer: () => null }));
vi.mock('@/features/cart/ActiveOrderPanel', () => ({ ActiveOrderPanel: () => null }));
vi.mock('@/features/cart/BottomActionBar', () => ({ BottomActionBar: () => null }));
vi.mock('@/features/cart/CustomerAttachModal', () => ({ CustomerAttachModal: () => null }));
vi.mock('@/features/shift/OpenShiftModal', () => ({ OpenShiftModal: () => null }));
vi.mock('@/features/shift/components/CloseShiftModal', () => ({ CloseShiftModal: () => null }));
vi.mock('@/features/shift/ShiftClosedState', () => ({ ShiftClosedState: () => null }));
vi.mock('@/features/payment/PaymentTerminal', () => ({ PaymentTerminal: () => null }));
vi.mock('@/features/order-history/OrderHistoryPanel', () => ({ OrderHistoryPanel: () => null }));
vi.mock('@/features/shift/LiveSessionsModal', () => ({ LiveSessionsModal: () => null }));
vi.mock('@/features/auth/ChangePinModal', () => ({ ChangePinModal: () => null }));
vi.mock('@/features/auth/TerminalLockedOverlay', () => ({ TerminalLockedOverlay: () => null }));

import PosPage from '@/pages/Pos';
import { useAuthStore } from '@/stores/authStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('POS shell — LAN heartbeat wiring (session 59, 21 D1.1)', () => {
  beforeEach(() => {
    rpcMock.mockClear();
    usePosSettingsStore.setState({ deviceCode: '' });
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Bob', role_code: 'CASHIER', employee_code: 'E1' },
      sessionToken: 'tok',
      permissions: [],
      isAuthenticated: true,
      isLoading: false,
      error: null,
      isLocked: false,
    });
  });

  it('emits a LAN heartbeat when a device code is configured', async () => {
    usePosSettingsStore.setState({ deviceCode: 'POS-FRONT-01' });
    render(wrapper(<PosPage />));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('update_lan_heartbeat_v2', {
        p_device_codes: ['POS-FRONT-01'],
      });
    });
  });

  it('does not emit a heartbeat when no device code is configured', () => {
    render(wrapper(<PosPage />));
    expect(rpcMock).not.toHaveBeenCalledWith(
      'update_lan_heartbeat_v2',
      expect.anything(),
    );
  });
});
