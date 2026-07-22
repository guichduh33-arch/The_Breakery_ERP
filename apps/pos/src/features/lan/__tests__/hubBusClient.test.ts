// apps/pos/src/features/lan/__tests__/hubBusClient.test.ts
// Spec 006x lot 3 — client du bus LAN : hello/welcome, publish, dispatch
// dédupliqué par msg_id, catchup, refcount.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hubBus, type HubBusEnvelope } from '../hubBusClient';
import { useHubConnectionStore } from '../hubConnectionStore';

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
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  message(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** open + welcome — l'état « sur le bus ». */
  join(): void {
    this.open();
    this.message({ type: 'welcome', buffer: { count: 0 } });
  }
}

const OPTS = { url: 'ws://192.168.1.20:3001/ws', deviceCode: 'POS-1', deviceType: 'pos', token: '' };

function envelope(topic: string, payload: unknown, msgId = crypto.randomUUID()): Record<string, unknown> {
  return { v: 1, msg_id: msgId, device_code: 'KDS-1', ts: new Date().toISOString(), topic, payload };
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  useHubConnectionStore.setState({ connected: false });
});

afterEach(() => {
  hubBus._resetForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('hubBus', () => {
  it('publishes an enveloped message once welcomed, refuses before', () => {
    hubBus.start(OPTS);
    const ws = MockWebSocket.instances[0]!;
    ws.open();
    expect(hubBus.publish('order.fired', { x: 1 })).toBe(false); // pas de welcome

    ws.message({ type: 'welcome', buffer: { count: 0 } });
    expect(useHubConnectionStore.getState().connected).toBe(true);
    expect(hubBus.publish('order.fired', { x: 1 })).toBe(true);

    const sent = JSON.parse(ws.sent.at(-1)!) as HubBusEnvelope;
    expect(sent.v).toBe(1);
    expect(sent.topic).toBe('order.fired');
    expect(sent.device_code).toBe('POS-1');
    expect(sent.payload).toEqual({ x: 1 });
    expect(sent.msg_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('dispatches incoming envelopes to topic subscribers, deduped by msg_id', () => {
    hubBus.start(OPTS);
    const ws = MockWebSocket.instances[0]!;
    ws.join();

    const seen: unknown[] = [];
    const unsub = hubBus.subscribe('order.fired', (env) => seen.push(env.payload));

    const env = envelope('order.fired', { n: 'A' });
    ws.message(env);
    ws.message(env); // doublon (StrictMode / catchup) → ignoré
    expect(seen).toEqual([{ n: 'A' }]);

    unsub();
    ws.message(envelope('order.fired', { n: 'B' }));
    expect(seen).toEqual([{ n: 'A' }]);
  });

  it('replays catchup_result messages through the same deduped dispatch', () => {
    hubBus.start(OPTS);
    const ws = MockWebSocket.instances[0]!;
    ws.join();

    const seen: string[] = [];
    hubBus.subscribe('order.item_status', (env) => seen.push((env.payload as { s: string }).s));

    const live = envelope('order.item_status', { s: 'live' });
    ws.message(live);
    expect(hubBus.requestCatchup('2026-07-20T00:00:00Z')).toBe(true);
    ws.message({ type: 'catchup_result', messages: [live, envelope('order.item_status', { s: 'old' })] });
    expect(seen).toEqual(['live', 'old']); // le doublon `live` n'est pas redélivré
  });

  it('does not replay its own published messages from a catchup', () => {
    hubBus.start(OPTS);
    const ws = MockWebSocket.instances[0]!;
    ws.join();

    hubBus.publish('order.fired', { mine: true });
    const mine = JSON.parse(ws.sent.at(-1)!) as Record<string, unknown>;

    const seen: unknown[] = [];
    hubBus.subscribe('order.fired', (env) => seen.push(env.payload));
    ws.message({ type: 'catchup_result', messages: [mine] });
    expect(seen).toEqual([]);
  });

  // Lot 5 — chaos « hub down » (spec §7.5) : la mort du hub ne jette jamais,
  // publish() dégrade en false (l'outbox durable porte l'intent), et le client
  // rejoint seul au retour du hub (backoff 1 s → 30 s).
  it('chaos hub down: publish degrades to false, reconnects on backoff and rejoins', () => {
    hubBus.start(OPTS);
    const ws = MockWebSocket.instances[0]!;
    ws.join();
    expect(hubBus.publish('order.fired', { x: 1 })).toBe(true);

    ws.close(); // hub tombe
    expect(useHubConnectionStore.getState().connected).toBe(false);
    expect(hubBus.publish('order.fired', { x: 2 })).toBe(false); // pas d'exception

    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1); // pas encore de retry
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2); // retry à 1 s

    const ws2 = MockWebSocket.instances[1]!;
    ws2.join(); // le hub est revenu
    expect(useHubConnectionStore.getState().connected).toBe(true);
    expect(hubBus.publish('order.fired', { x: 3 })).toBe(true);
  });

  it('chaos hub flapping: the backoff doubles while the hub stays down', () => {
    hubBus.start(OPTS);
    MockWebSocket.instances[0]!.join();

    MockWebSocket.instances[0]!.close();
    vi.advanceTimersByTime(1_000); // retry #1 (1 s)
    expect(MockWebSocket.instances).toHaveLength(2);

    // Le retry échoue AVANT open (hub toujours mort) → backoff doublé à 2 s.
    MockWebSocket.instances[1]!.close();
    vi.advanceTimersByTime(1_999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('refcounts start/stop — the socket closes only at zero', () => {
    hubBus.start(OPTS);
    hubBus.start(OPTS);
    const ws = MockWebSocket.instances[0]!;
    ws.join();

    hubBus.stop();
    expect(useHubConnectionStore.getState().connected).toBe(true); // encore 1 utilisateur

    hubBus.stop();
    expect(useHubConnectionStore.getState().connected).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1); // pas de reconnexion
  });
});
