// apps/print-bridge/src/hub/hubServer.ts
// Serveur WebSocket du hub LAN (spec 006x §4, lot 1) : hello-auth, presence,
// relai d'enveloppes + journal ring-buffer pour le rattrapage. Lot 1 = socle :
// aucun flux métier ne passe encore par le bus.
//
// Sécurité (spec §6) : connexions restreintes aux IP privées/loopback
// (ipGuard), token partagé optionnel vérifié dans le hello (déviation actée :
// les navigateurs ne posent pas de header à l'upgrade WS — le token voyage
// dans le premier message, jamais dans l'URL). Aucun secret métier sur le bus.

import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { isPrivateIpv4 } from '../ipGuard.js';
import {
  parseEnvelope, parseHello, parseCatchup, type HubEnvelope,
} from './envelope.js';
import type { HubRingBuffer, HubBufferStats } from './ringBuffer.js';

const HELLO_TIMEOUT_MS = 5_000;
const PING_INTERVAL_MS = 15_000;

export interface HubDevicePresence {
  device_code: string;
  device_type: string;
  ip: string;
  connected_at: string;
  last_seen_at: string;
}

export interface HubOptions {
  token: string | null;
  buffer: HubRingBuffer;
  /** Injectable pour les tests. */
  helloTimeoutMs?: number;
  pingIntervalMs?: number;
}

export interface HubHandle {
  handleUpgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;
  presence: () => HubDevicePresence[];
  bufferStats: () => HubBufferStats;
  tokenRequired: boolean;
  close: () => void;
}

interface ClientState {
  authed: boolean;
  device_code: string;
  device_type: string;
  ip: string;
  connected_at: string;
  last_seen_at: string;
  isAlive: boolean;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/** `::ffff:192.168.1.5` → `192.168.1.5` ; loopback IPv6 accepté tel quel. */
function normalizeIp(remote: string | undefined): string {
  if (remote === undefined) return '';
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote;
}

function isAllowedIp(ip: string): boolean {
  return ip === '::1' || isPrivateIpv4(ip);
}

export function createHub(opts: HubOptions): HubHandle {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientState>();
  const helloTimeout = opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const pingInterval = opts.pingIntervalMs ?? PING_INTERVAL_MS;

  function sendJson(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function relay(from: WebSocket, env: HubEnvelope): void {
    const line = JSON.stringify(env);
    for (const [ws, state] of clients) {
      if (ws !== from && state.authed && ws.readyState === WebSocket.OPEN) ws.send(line);
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = normalizeIp(req.socket.remoteAddress);
    const now = new Date().toISOString();
    const state: ClientState = {
      authed: false, device_code: '', device_type: '', ip,
      connected_at: now, last_seen_at: now, isAlive: true,
    };
    clients.set(ws, state);

    const helloTimer = setTimeout(() => {
      if (!state.authed) ws.close(4001, 'hello_timeout');
    }, helloTimeout);

    ws.on('pong', () => { state.isAlive = true; });

    ws.on('message', (data) => {
      state.last_seen_at = new Date().toISOString();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawToString(data));
      } catch {
        sendJson(ws, { type: 'error', code: 'invalid_json' });
        return;
      }

      if (!state.authed) {
        const hello = parseHello(parsed);
        if (hello === null) {
          ws.close(4002, 'hello_expected');
          return;
        }
        if (opts.token !== null && hello.token !== opts.token) {
          ws.close(4003, 'bad_token');
          return;
        }
        state.authed = true;
        state.device_code = hello.device_code;
        state.device_type = hello.device_type;
        clearTimeout(helloTimer);
        sendJson(ws, { type: 'welcome', buffer: opts.buffer.stats() });
        return;
      }

      const catchup = parseCatchup(parsed);
      if (catchup !== null) {
        sendJson(ws, { type: 'catchup_result', messages: opts.buffer.since(catchup.since_ts) });
        return;
      }

      const env = parseEnvelope(parsed);
      if (env === null) {
        sendJson(ws, { type: 'error', code: 'invalid_envelope' });
        return;
      }
      // presence.heartbeat = éphémère : touche la présence (déjà fait via
      // last_seen_at), ni journalisé ni relayé.
      if (env.topic === 'presence.heartbeat') return;
      opts.buffer.append(env);
      relay(ws, env);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      clients.delete(ws);
    });
    ws.on('error', () => { /* close suit toujours */ });
  });

  const pingTimer = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.isAlive) { ws.terminate(); clients.delete(ws); continue; }
      state.isAlive = false;
      ws.ping();
    }
  }, pingInterval);

  return {
    handleUpgrade(req, socket, head) {
      const url = new URL(req.url ?? '/', 'http://hub.local');
      if (url.pathname !== '/ws') { socket.destroy(); return; }
      if (!isAllowedIp(normalizeIp(req.socket.remoteAddress))) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    presence() {
      return [...clients.values()]
        .filter((s) => s.authed)
        .map(({ device_code, device_type, ip, connected_at, last_seen_at }) => ({
          device_code, device_type, ip, connected_at, last_seen_at,
        }));
    },
    bufferStats: () => opts.buffer.stats(),
    tokenRequired: opts.token !== null,
    close() {
      clearInterval(pingTimer);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}
