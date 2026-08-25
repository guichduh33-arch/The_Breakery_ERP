// apps/pos/src/features/lan/__tests__/HubPresenceMount.test.tsx
//
// Diagnostic 2026-08-25 — effet observateur : la présence bus LAN se monte au
// shell (App.tsx) et doit SURVIVRE à la navigation entre surfaces — en
// particulier vers /pos/settings, la page qui AFFICHE la liste des appareils.
// Reprend aussi la garantie heartbeat cloud des anciens tests par page
// (pos-lan-heartbeat.smoke, kds.smoke, TabletLayout.header — session 59).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { HubPresenceMount } from '../HubPresenceMount';
import { hubBus } from '../hubBusClient';
import { useHubConnectionStore } from '../hubConnectionStore';
import { useAuthStore } from '@/stores/authStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args) as unknown },
  supabaseUrl: 'http://localhost:54321',
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

/** Navigue vers `to` après le premier rendu — simule un changement de page. */
function Driver({ to }: { to: string | null }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (to !== null) void navigate(to);
  }, [to, navigate]);
  return null;
}

function mountAt(path: string, navigateTo: string | null = null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HubPresenceMount />
      <Driver to={navigateTo} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpcMock.mockClear();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  usePosSettingsStore.setState({
    printerUrl: 'http://192.168.1.20:3001', deviceCode: 'POS-FRONT-01', hubToken: '',
  });
  useHubConnectionStore.setState({ connected: false });
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

afterEach(() => {
  hubBus._resetForTests();
  vi.unstubAllGlobals();
});

describe('HubPresenceMount', () => {
  it('joins the bus from /pos with device_type pos', () => {
    mountAt('/pos');
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: 'hello', device_code: 'POS-FRONT-01', device_type: 'pos',
    });
  });

  // LA régression : ouvrir la page qui affiche la liste ne doit plus faire
  // quitter le bus au terminal.
  it('keeps the same socket when navigating /pos → /pos/settings', () => {
    mountAt('/pos', '/pos/settings');
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.readyState).not.toBe(3);
  });

  it('declares kds on /kds and tablet on /tablet/order', () => {
    mountAt('/kds');
    MockWebSocket.instances[0]!.simulateOpen();
    expect(JSON.parse(MockWebSocket.instances[0]!.sent[0]!)).toMatchObject({ device_type: 'kds' });
    hubBus._resetForTests();
    MockWebSocket.instances = [];

    mountAt('/tablet/order');
    MockWebSocket.instances[0]!.simulateOpen();
    expect(JSON.parse(MockWebSocket.instances[0]!.sent[0]!)).toMatchObject({ device_type: 'tablet' });
  });

  it('stays off the bus on /display (kiosk owns its presence)', () => {
    mountAt('/display');
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('stays off the bus when unauthenticated', () => {
    useAuthStore.setState({ isAuthenticated: false });
    mountAt('/pos');
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('stays off the bus without a device code', () => {
    usePosSettingsStore.setState({ deviceCode: '' });
    mountAt('/pos');
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  // Session 59 (21 D1.1) — le heartbeat cloud (repli hub down) vit ici aussi.
  it('emits the cloud heartbeat fallback when a device code is configured', async () => {
    mountAt('/pos');
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('update_lan_heartbeat_v2', {
        p_device_codes: ['POS-FRONT-01'],
      });
    });
  });

  it('does not emit a heartbeat without a device code', () => {
    usePosSettingsStore.setState({ deviceCode: '' });
    mountAt('/pos');
    expect(rpcMock).not.toHaveBeenCalledWith('update_lan_heartbeat_v2', expect.anything());
  });
});
