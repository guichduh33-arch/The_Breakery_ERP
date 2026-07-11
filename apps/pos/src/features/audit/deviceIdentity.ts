// apps/pos/src/features/audit/deviceIdentity.ts
//
// S72 Lot 2 — stable per-terminal identity for the operational audit journal.
// Each physical device mints one opaque `device_token` on first use and keeps
// it in raw localStorage (durable across reloads/restarts — unlike safeStorage,
// which is sessionStorage on web). The server (`record_pos_events_v1`) resolves
// or auto-provisions a `pos_devices` row from this token; a manager later names
// it via `register_pos_device_v1`.
//
// `nextDeviceSeq()` is a monotonic per-device counter so the audit journal can
// order events emitted on this terminal and detect gaps, independent of clock
// skew or out-of-order flushes.

const TOKEN_KEY = 'pos:device_token';
const SEQ_KEY = 'pos:device_seq';

function randomToken(): string {
  try {
    // Opaque, unguessable, stable. crypto.randomUUID is available in every
    // browser the POS targets; the catch keeps emit non-throwing on exotic hosts.
    return `pd_${crypto.randomUUID()}`;
  } catch {
    return `pd_${Date.now().toString(36)}_${Math.round(Math.random() * 1e9).toString(36)}`;
  }
}

/** Read (or mint + persist) this terminal's opaque device token. Synchronous. */
export function getDeviceToken(): string {
  try {
    const existing = localStorage.getItem(TOKEN_KEY);
    if (existing && existing.length >= 8) return existing;
    const minted = randomToken();
    localStorage.setItem(TOKEN_KEY, minted);
    return minted;
  } catch {
    // localStorage unavailable (private mode edge cases): fall back to a
    // per-tab token so the batch still carries a valid (>= 8 char) token.
    return randomToken();
  }
}

/** Next monotonic sequence number for an event emitted on this device. */
export function nextDeviceSeq(): number {
  try {
    const raw = localStorage.getItem(SEQ_KEY);
    const next = (raw ? parseInt(raw, 10) || 0 : 0) + 1;
    localStorage.setItem(SEQ_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}
