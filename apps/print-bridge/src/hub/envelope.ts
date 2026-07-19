// apps/print-bridge/src/hub/envelope.ts
// Enveloppe du bus LAN (spec 006x §4.2) + messages de contrôle client↔hub.
// Le token voyage dans le hello (les navigateurs ne posent pas de header
// custom à l'upgrade WS), jamais dans l'URL — il ne doit fuiter dans aucun log.

export const HUB_PROTOCOL_VERSION = 1;

export const HUB_TOPICS = [
  'order.fired',
  'order.item_status',
  'order.paid_offline',
  'cart.mirror',
  'presence.heartbeat',
  'settings.changed',
] as const;

export type HubTopic = (typeof HUB_TOPICS)[number];

export interface HubEnvelope {
  v: number;
  msg_id: string;
  device_code: string;
  ts: string;
  topic: HubTopic;
  payload: unknown;
}

export interface HelloMessage {
  type: 'hello';
  device_code: string;
  device_type: string;
  token?: string;
}

export interface CatchupMessage {
  type: 'catchup';
  /** ISO — only envelopes strictly newer are returned. Omit for the full buffer. */
  since_ts?: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

export function parseEnvelope(x: unknown): HubEnvelope | null {
  if (!isRecord(x)) return null;
  if (x.v !== HUB_PROTOCOL_VERSION) return null;
  if (typeof x.msg_id !== 'string' || x.msg_id === '') return null;
  if (typeof x.device_code !== 'string' || x.device_code === '') return null;
  if (typeof x.ts !== 'string' || Number.isNaN(Date.parse(x.ts))) return null;
  if (typeof x.topic !== 'string' || !(HUB_TOPICS as readonly string[]).includes(x.topic)) return null;
  if (!('payload' in x)) return null;
  return {
    v: HUB_PROTOCOL_VERSION,
    msg_id: x.msg_id,
    device_code: x.device_code,
    ts: x.ts,
    topic: x.topic as HubTopic,
    payload: x.payload,
  };
}

export function parseHello(x: unknown): HelloMessage | null {
  if (!isRecord(x) || x.type !== 'hello') return null;
  if (typeof x.device_code !== 'string' || x.device_code === '') return null;
  if (typeof x.device_type !== 'string' || x.device_type === '') return null;
  if ('token' in x && typeof x.token !== 'string') return null;
  const hello: HelloMessage = { type: 'hello', device_code: x.device_code, device_type: x.device_type };
  if (typeof x.token === 'string') hello.token = x.token;
  return hello;
}

export function parseCatchup(x: unknown): CatchupMessage | null {
  if (!isRecord(x) || x.type !== 'catchup') return null;
  if ('since_ts' in x && x.since_ts !== undefined
    && (typeof x.since_ts !== 'string' || Number.isNaN(Date.parse(x.since_ts)))) return null;
  const msg: CatchupMessage = { type: 'catchup' };
  if (typeof x.since_ts === 'string') msg.since_ts = x.since_ts;
  return msg;
}
