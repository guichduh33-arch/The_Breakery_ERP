// apps/pos/src/features/tablet/__tests__/TabletLayout.header.test.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — the tablet header gains an
// active-table chip, a persistent online/offline pill, and a live order count
// badge on the Orders tab.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args) as unknown },
  supabaseUrl: 'http://localhost:54321',
}));

// Lot D (audit 2026-08-22) — la pastille ne lit plus un ping à elle : elle lit
// les DEUX stores dont dépend isOfflineMode(). On pilote donc les vrais stores
// plutôt qu'un mock de hook, ce qui fait de ce test un test du vrai chemin.
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { useHubConnectionStore } from '@/features/lan/hubConnectionStore';

const ordersMock = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('@/features/tablet/hooks/useMyTabletOrders', () => ({
  useMyTabletOrders: () => ({ data: ordersMock.data }),
}));

function wrap(node: ReactNode): ReactNode {
  return <MemoryRouter initialEntries={['/tablet/order']}>{node}</MemoryRouter>;
}

describe('TabletLayout header (LOT 6)', () => {
  beforeEach(() => {
    rpcMock.mockClear();
    useCloudStatusStore.setState({ cloudOnline: true, lastSyncAt: null, offlineSince: null });
    useHubConnectionStore.setState({ connected: false });
    ordersMock.data = [];
    usePosSettingsStore.setState({ deviceCode: '' });
    useAuthStore.setState({
      user: { id: 'w1', full_name: 'Demo Waiter', role_code: 'waiter', employee_code: 'EMP1' },
      permissions: ['sales.create'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
      // Sans cette remise à zéro, le test du verrou contaminerait les suivants.
      isLocked: false,
      lockReason: null,
    });
    useTabletCartStore.setState({ items: [], tableNumber: null, orderType: 'dine_in' });
  });

  it('shows "No table" when none picked and the active table when set', async () => {
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    const { rerender } = render(wrap(<TabletLayout />));
    expect(screen.getByTestId('tablet-active-table')).toHaveTextContent(/no table/i);

    useTabletCartStore.setState({ tableNumber: 'T7' });
    rerender(wrap(<TabletLayout />));
    expect(screen.getByTestId('tablet-active-table')).toHaveTextContent(/table t7/i);
  });

  it('shows an Online pill when the cloud answers', async () => {
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    const pill = screen.getByTestId('tablet-connection-pill');
    expect(pill).toHaveTextContent(/online/i);
    expect(pill).toHaveAttribute('data-connection-state', 'online');
  });

  // Cloud coupé MAIS hub LAN debout : la commande part quand même en cuisine
  // par le bus et attend en file. La serveuse peut continuer.
  it('shows Offline when the cloud is down but the LAN bus is up', async () => {
    useCloudStatusStore.setState({ cloudOnline: false });
    useHubConnectionStore.setState({ connected: true });
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    const pill = screen.getByTestId('tablet-connection-pill');
    expect(pill).toHaveTextContent(/offline/i);
    expect(pill).toHaveAttribute('data-connection-state', 'offline_bus');
  });

  // Le cas que l'ancienne pastille annonçait à tort comme « Offline » : cloud
  // ET hub coupés. isOfflineMode() vaut false, l'envoi part en ligne et échoue.
  // Rien n'aboutit — la pastille doit le dire autrement.
  it('shows No network when BOTH the cloud and the LAN bus are down', async () => {
    useCloudStatusStore.setState({ cloudOnline: false });
    useHubConnectionStore.setState({ connected: false });
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    const pill = screen.getByTestId('tablet-connection-pill');
    expect(pill).toHaveTextContent(/no network/i);
    expect(pill).toHaveAttribute('data-connection-state', 'no_network');
    // Le mot « Offline » seul rendrait les deux situations indistinguables.
    expect(pill).not.toHaveTextContent(/^offline$/i);
  });

  // Le verrou d'inactivité posait isLocked sur /tablet sans que rien ne
  // s'affiche : la tablette restait entièrement pilotable, sur l'appareil
  // justement laissé sans surveillance.
  it('renders the lock overlay on /tablet when the terminal is locked', async () => {
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Ce que fait vraiment IdleTimeoutMount à l'expiration : il pose l'état dans
    // le store, sans re-monter quoi que ce soit. C'est cette transition-là qui
    // doit faire apparaître l'écran — d'où act(), et non un rerender manuel.
    act(() => {
      // Exactement l'appel d'IdleTimeoutMount : lock() sans argument, donc
      // lockReason = 'manual'.
      useAuthStore.getState().lock();
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toHaveTextContent(/resume terminal/i);
  });

  it('says the session expired when that is the reason', async () => {
    useAuthStore.setState({ isLocked: true, lockReason: 'session_expired' });
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    expect(screen.getByRole('heading', { name: /session expired/i })).toBeInTheDocument();
  });

  it('badges the Orders tab with the live order count', async () => {
    ordersMock.data = [
      { id: 'o1', status: 'pending_payment' },
      { id: 'o2', status: 'pending_payment' },
      { id: 'o3', status: 'draft' },
    ];
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    expect(screen.getByLabelText(/3 orders/i)).toHaveTextContent('3');
  });

  // Le badge comptait tout l'historique : au bout d'un mois il annonçait
  // plusieurs centaines, et cessait d'être regardé. Seul « en vol » compte.
  it('ne compte que les commandes encore en vol, pas l’historique encaissé', async () => {
    ordersMock.data = [
      { id: 'o1', status: 'pending_payment' },
      { id: 'o2', status: 'paid' },
      { id: 'o3', status: 'completed' },
      { id: 'o4', status: 'voided' },
    ];
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    expect(screen.getByLabelText(/1 order$/i)).toHaveTextContent('1');
  });

  it('n’affiche aucun badge quand tout est encaissé', async () => {
    ordersMock.data = [
      { id: 'o1', status: 'paid' },
      { id: 'o2', status: 'completed' },
    ];
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    expect(screen.queryByLabelText(/order[s]?$/i)).not.toBeInTheDocument();
  });

  // Session 59 (21 D1.1) — useLanHeartbeat is now mounted on this shell so BO
  // "LAN Devices" can see the waiter tablet as online.
  it('emits a LAN heartbeat when a device code is configured', async () => {
    usePosSettingsStore.setState({ deviceCode: 'TABLET-01' });
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('update_lan_heartbeat_v2', {
        p_device_codes: ['TABLET-01'],
      });
    });
  });

  it('does not emit a heartbeat when no device code is configured', async () => {
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    expect(screen.getByTestId('tablet-active-table')).toBeInTheDocument();

    expect(rpcMock).not.toHaveBeenCalledWith(
      'update_lan_heartbeat_v2',
      expect.anything(),
    );
  });
});
