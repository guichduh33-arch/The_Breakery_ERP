// apps/pos/src/features/lan/hubBusClient.ts
// Spec 006x lot 3 — client du bus LAN (ws://<hub>:3001/ws), partagé par toutes
// les surfaces du POS. Singleton refcounté : useHubPresence start()/stop() au
// mount/unmount (StrictMode double-monte → le refcount évite deux sockets).
//
// Responsabilités :
//   - connexion + hello (token per-terminal), reconnexion backoff 1 s → 30 s ;
//   - `connected` publié dans useHubConnectionStore AU WELCOME (pas à l'open —
//     un hello refusé ne doit pas couper le fallback heartbeat direct, lot 2) ;
//   - presence.heartbeat toutes les 10 s (repris de useHubPresence lot 1) ;
//   - publish(topic, payload) : enveloppe spec §4.2, msg_id UUID client ;
//   - subscribe(topic, cb) : dispatch des enveloppes reçues, DEDUP par msg_id
//     (StrictMode/catchup rejouent — même discipline que les channel names) ;
//   - requestCatchup(sinceTs) : rattrapage du ring-buffer au (re)join ; les
//     messages rejoués passent par le même dispatch dédupliqué.
//
// Aucun secret métier ne transite sur le bus (spec §6).

import { useHubConnectionStore } from './hubConnectionStore';

export const HUB_BUS_PROTOCOL_VERSION = 1;

export type HubBusTopic =
  | 'order.fired'
  | 'order.item_status'
  | 'order.paid_offline'
  | 'cart.mirror'
  | 'presence.heartbeat'
  | 'settings.changed';

export interface HubBusEnvelope {
  v: number;
  msg_id: string;
  device_code: string;
  ts: string;
  topic: HubBusTopic;
  payload: unknown;
}

export interface HubBusStartOptions {
  /** URL ws(s):// complète du hub (dérivée du printerUrl, cf. hubWsUrl). */
  url: string;
  deviceCode: string;
  deviceType: string;
  /** Token per-terminal — omis du hello quand vide. */
  token: string;
}

type Listener = (env: HubBusEnvelope) => void;

const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Dedup LRU — assez large pour un service entier, borné en mémoire. */
const SEEN_CAP = 2_000;

interface ClientState {
  refCount: number;
  opts: HubBusStartOptions | null;
  ws: WebSocket | null;
  heartbeatHandle: number | null;
  reconnectHandle: number | null;
  backoffMs: number;
  welcomed: boolean;
  listeners: Map<HubBusTopic, Set<Listener>>;
  seen: Set<string>;
}

const state: ClientState = {
  refCount: 0,
  opts: null,
  ws: null,
  heartbeatHandle: null,
  reconnectHandle: null,
  backoffMs: RECONNECT_MIN_MS,
  welcomed: false,
  listeners: new Map(),
  seen: new Set(),
};

function markSeen(msgId: string): void {
  state.seen.add(msgId);
  if (state.seen.size > SEEN_CAP) {
    // Set préserve l'ordre d'insertion → éviction des plus anciens.
    for (const id of state.seen) {
      state.seen.delete(id);
      if (state.seen.size <= SEEN_CAP) break;
    }
  }
}

function parseIncomingEnvelope(x: unknown): HubBusEnvelope | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (r.v !== HUB_BUS_PROTOCOL_VERSION) return null;
  if (typeof r.msg_id !== 'string' || r.msg_id === '') return null;
  if (typeof r.device_code !== 'string' || typeof r.ts !== 'string') return null;
  if (typeof r.topic !== 'string' || !('payload' in r)) return null;
  return {
    v: HUB_BUS_PROTOCOL_VERSION,
    msg_id: r.msg_id,
    device_code: r.device_code,
    ts: r.ts,
    topic: r.topic as HubBusTopic,
    payload: r.payload,
  };
}

function dispatch(env: HubBusEnvelope): void {
  if (state.seen.has(env.msg_id)) return;
  markSeen(env.msg_id);
  const subs = state.listeners.get(env.topic);
  if (subs === undefined) return;
  for (const cb of subs) {
    try {
      cb(env);
    } catch {
      // Un listener qui jette ne doit pas priver les autres du message.
    }
  }
}

function clearTimers(): void {
  if (state.heartbeatHandle !== null) {
    window.clearInterval(state.heartbeatHandle);
    state.heartbeatHandle = null;
  }
  if (state.reconnectHandle !== null) {
    window.clearTimeout(state.reconnectHandle);
    state.reconnectHandle = null;
  }
}

function scheduleReconnect(): void {
  if (state.refCount <= 0) return;
  state.reconnectHandle = window.setTimeout(connect, state.backoffMs);
  state.backoffMs = Math.min(state.backoffMs * 2, RECONNECT_MAX_MS);
}

function connect(): void {
  const opts = state.opts;
  if (state.refCount <= 0 || opts === null) return;
  if (typeof WebSocket === 'undefined') return;

  let socket: WebSocket;
  try {
    socket = new WebSocket(opts.url);
  } catch {
    scheduleReconnect();
    return;
  }
  state.ws = socket;
  state.welcomed = false;

  socket.onopen = () => {
    state.backoffMs = RECONNECT_MIN_MS;
    socket.send(JSON.stringify({
      type: 'hello',
      device_code: opts.deviceCode,
      device_type: opts.deviceType,
      ...(opts.token !== '' ? { token: opts.token } : {}),
    }));
    state.heartbeatHandle = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(buildEnvelope('presence.heartbeat', { device_type: opts.deviceType })));
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  socket.onmessage = (event: MessageEvent<string>) => {
    let msg: unknown;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const type = (msg as { type?: string }).type;
    if (type === 'welcome') {
      state.welcomed = true;
      useHubConnectionStore.getState().setConnected(true);
      return;
    }
    if (type === 'catchup_result') {
      const messages = (msg as { messages?: unknown[] }).messages ?? [];
      for (const m of messages) {
        const env = parseIncomingEnvelope(m);
        // Ses propres messages reviennent dans le catchup (le hub journalise
        // tout) — le dedup par msg_id les écarte, publish() les marque vus.
        if (env !== null) dispatch(env);
      }
      return;
    }
    const env = parseIncomingEnvelope(msg);
    if (env !== null) dispatch(env);
  };

  socket.onclose = () => {
    state.welcomed = false;
    useHubConnectionStore.getState().setConnected(false);
    clearTimers();
    state.ws = null;
    scheduleReconnect();
  };
  socket.onerror = () => { /* onclose suit toujours */ };
}

function buildEnvelope(topic: HubBusTopic, payload: unknown): HubBusEnvelope {
  return {
    v: HUB_BUS_PROTOCOL_VERSION,
    msg_id: crypto.randomUUID(),
    device_code: state.opts?.deviceCode ?? '',
    ts: new Date().toISOString(),
    topic,
    payload,
  };
}

export const hubBus = {
  /** Monte la connexion (refcounté). Appelé par useHubPresence. */
  start(opts: HubBusStartOptions): void {
    state.refCount += 1;
    if (state.refCount === 1) {
      state.opts = opts;
      state.backoffMs = RECONNECT_MIN_MS;
      connect();
    }
  },

  /** Démonte (refcounté) : le socket ferme quand plus personne ne l'utilise. */
  stop(): void {
    state.refCount = Math.max(0, state.refCount - 1);
    if (state.refCount === 0) {
      clearTimers();
      const ws = state.ws;
      state.ws = null;
      state.opts = null;
      state.welcomed = false;
      ws?.close();
      useHubConnectionStore.getState().setConnected(false);
    }
  },

  /** true entre le welcome et la fermeture du socket. */
  isConnected(): boolean {
    return state.welcomed && state.ws !== null && state.ws.readyState === WebSocket.OPEN;
  },

  /**
   * Publie une enveloppe sur le bus. Retourne false (sans jeter) si le bus
   * n'est pas joignable — l'appelant décide du fallback.
   * Le msg_id publié est marqué vu : un catchup ultérieur ne nous rejouera
   * pas nos propres messages.
   */
  publish(topic: HubBusTopic, payload: unknown): boolean {
    if (!this.isConnected() || state.ws === null) return false;
    const env = buildEnvelope(topic, payload);
    markSeen(env.msg_id);
    state.ws.send(JSON.stringify(env));
    return true;
  },

  /** Abonne un listener à un topic ; retourne le désabonnement. */
  subscribe(topic: HubBusTopic, cb: Listener): () => void {
    let subs = state.listeners.get(topic);
    if (subs === undefined) {
      subs = new Set();
      state.listeners.set(topic, subs);
    }
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  },

  /** Demande le rattrapage du ring-buffer (messages strictement > since_ts). */
  requestCatchup(sinceTs?: string): boolean {
    if (!this.isConnected() || state.ws === null) return false;
    state.ws.send(JSON.stringify({ type: 'catchup', ...(sinceTs !== undefined ? { since_ts: sinceTs } : {}) }));
    return true;
  },

  /** Tests uniquement — remise à zéro complète du singleton. */
  _resetForTests(): void {
    clearTimers();
    state.ws?.close();
    state.refCount = 0;
    state.opts = null;
    state.ws = null;
    state.welcomed = false;
    state.backoffMs = RECONNECT_MIN_MS;
    state.listeners.clear();
    state.seen.clear();
    useHubConnectionStore.getState().setConnected(false);
  },
};
