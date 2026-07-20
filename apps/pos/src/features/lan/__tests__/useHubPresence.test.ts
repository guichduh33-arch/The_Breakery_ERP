// apps/pos/src/features/lan/__tests__/useHubPresence.test.ts
// jsdom n'implémente pas WebSocket : un mock global prouve le protocole
// (hello, heartbeat, reconnexion) sans réseau. Sans mock, le hook doit être
// inerte — c'est aussi le filet des autres smoke tests qui montent les shells.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHubPresence, hubWsUrl } from '../hooks/useHubPresence';
import { useHubConnectionStore } from '../hubConnectionStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

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
  simulateMessage(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  usePosSettingsStore.setState({ printerUrl: 'http://192.168.1.20:3001', hubToken: '' });
  useHubConnectionStore.setState({ connected: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('hubWsUrl', () => {
  it('maps http(s) origins to ws(s) + /ws', () => {
    expect(hubWsUrl('http://192.168.1.20:3001')).toBe('ws://192.168.1.20:3001/ws');
    expect(hubWsUrl('https://hub.local:3001/')).toBe('wss://hub.local:3001/ws');
  });
});

describe('useHubPresence', () => {
  it('no-ops without a device code', () => {
    renderHook(() => useHubPresence({ deviceCode: '', deviceType: 'pos' }));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('no-ops when disabled', () => {
    renderHook(() => useHubPresence({ deviceCode: 'POS-1', deviceType: 'pos', enabled: false }));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('connects to the bridge origin and sends hello on open', () => {
    renderHook(() => useHubPresence({ deviceCode: 'POS-1', deviceType: 'pos' }));
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toBe('ws://192.168.1.20:3001/ws');
    ws.simulateOpen();
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'hello', device_code: 'POS-1', device_type: 'pos' });
  });

  it('includes the per-terminal token in the hello when set', () => {
    usePosSettingsStore.setState({ hubToken: 's3cret' });
    renderHook(() => useHubPresence({ deviceCode: 'POS-1', deviceType: 'pos' }));
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({ type: 'hello', token: 's3cret' });
  });

  it('emits a presence.heartbeat envelope every 10s while open', () => {
    renderHook(() => useHubPresence({ deviceCode: 'KDS-1', deviceType: 'kds' }));
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();
    vi.advanceTimersByTime(10_000);
    const beat = JSON.parse(ws.sent[1]!) as Record<string, unknown>;
    expect(beat.topic).toBe('presence.heartbeat');
    expect(beat.device_code).toBe('KDS-1');
    expect(beat.payload).toEqual({ device_type: 'kds' });
    vi.advanceTimersByTime(10_000);
    expect(ws.sent).toHaveLength(3);
  });

  it('reconnects after a close', () => {
    renderHook(() => useHubPresence({ deviceCode: 'POS-1', deviceType: 'pos' }));
    const first = MockWebSocket.instances[0]!;
    first.simulateOpen();
    first.close();
    vi.advanceTimersByTime(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('flips the connection store on welcome, resets it on close (lot 2)', () => {
    renderHook(() => useHubPresence({ deviceCode: 'POS-1', deviceType: 'pos' }));
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();
    // L'open seul ne suffit pas : un hello refusé ne doit pas couper le
    // fallback heartbeat direct.
    expect(useHubConnectionStore.getState().connected).toBe(false);
    ws.simulateMessage({ type: 'welcome', buffer: { count: 0 } });
    expect(useHubConnectionStore.getState().connected).toBe(true);
    ws.close();
    expect(useHubConnectionStore.getState().connected).toBe(false);
  });

  it('resets the connection store on unmount', () => {
    const { unmount } = renderHook(() => useHubPresence({ deviceCode: 'POS-1', deviceType: 'pos' }));
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();
    ws.simulateMessage({ type: 'welcome', buffer: { count: 0 } });
    expect(useHubConnectionStore.getState().connected).toBe(true);
    unmount();
    expect(useHubConnectionStore.getState().connected).toBe(false);
  });

  it('closes the socket and stops timers on unmount', () => {
    const { unmount } = renderHook(() => useHubPresence({ deviceCode: 'POS-1', deviceType: 'pos' }));
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();
    unmount();
    expect(ws.readyState).toBe(3);
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
