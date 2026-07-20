// apps/print-bridge/src/hub/cloudSync.ts
// Spec 006x lot 2 — le hub agrège la présence du bus et pousse un heartbeat
// BATCH vers l'EF cloud `lan-heartbeat-batch` toutes les 10 s : un seul
// écrivain cloud remplace N heartbeats individuels (spec §4.3 ONLINE).
// Le secret partagé voyage en header `x-hub-secret` (jamais en query/body).
// Internet down = échec silencieux, retry au tick suivant — le bus LAN
// continue de vivre sans cloud (c'est tout l'objet du hub).

export interface CloudSyncOptions {
  /** Codes des appareils actuellement authentifiés sur le bus. */
  presentCodes: () => string[];
  /** URL complète de l'EF lan-heartbeat-batch. */
  url: string;
  /** Secret partagé (== LAN_HEARTBEAT_SECRET côté EF). */
  secret: string;
  intervalMs?: number;
  /** Injectable pour les tests. */
  fetchFn?: typeof fetch;
}

export interface CloudSyncStatus {
  enabled: boolean;
  last_push_at: string | null;
  last_result: 'ok' | 'error' | null;
  last_error: string | null;
  /** Codes poussés au dernier push réussi. */
  last_pushed: string[];
  /** Codes inconnus du registre lan_devices au dernier push (observabilité). */
  last_unknown: string[];
}

export interface CloudSyncHandle {
  status: () => CloudSyncStatus;
  /** Un tick immédiat (tests + flush au boot). */
  tick: () => Promise<void>;
  stop: () => void;
}

const DEFAULT_INTERVAL_MS = 10_000;
const PUSH_TIMEOUT_MS = 5_000;

export const DISABLED_CLOUD_SYNC_STATUS: CloudSyncStatus = {
  enabled: false,
  last_push_at: null,
  last_result: null,
  last_error: null,
  last_pushed: [],
  last_unknown: [],
};

export function startCloudSync(opts: CloudSyncOptions): CloudSyncHandle {
  const fetchFn = opts.fetchFn ?? fetch;
  const status: CloudSyncStatus = { ...DISABLED_CLOUD_SYNC_STATUS, enabled: true };
  let lastLogged: string | null = null;

  // Log uniquement les TRANSITIONS d'état (ok→erreur, erreur→ok) — pas une
  // ligne toutes les 10 s pendant une coupure internet de 4 h.
  function logTransition(key: string, line: string): void {
    if (lastLogged === key) return;
    lastLogged = key;
    // eslint-disable-next-line no-console
    console.log(`[print-bridge] cloud-sync: ${line}`);
  }

  async function tick(): Promise<void> {
    const codes = [...new Set(opts.presentCodes())];
    if (codes.length === 0) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    try {
      const res = await fetchFn(opts.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hub-secret': opts.secret },
        body: JSON.stringify({ device_codes: codes }),
        signal: controller.signal,
      });
      if (!res.ok) {
        status.last_result = 'error';
        status.last_error = `http_${res.status}`;
        logTransition(`http_${res.status}`, `push failed (HTTP ${res.status})`);
        return;
      }
      const body = (await res.json()) as { touched?: string[]; unknown?: string[] };
      status.last_push_at = new Date().toISOString();
      status.last_result = 'ok';
      status.last_error = null;
      status.last_pushed = body.touched ?? codes;
      status.last_unknown = body.unknown ?? [];
      logTransition('ok', `pushing ${codes.length} device(s) to cloud`);
    } catch (err) {
      status.last_result = 'error';
      status.last_error = err instanceof Error ? err.message : 'unknown';
      logTransition('network_error', `push failed (${status.last_error}) — retrying every tick`);
    } finally {
      clearTimeout(timeout);
    }
  }

  const timer = setInterval(() => { void tick(); }, opts.intervalMs ?? DEFAULT_INTERVAL_MS);

  return {
    status: () => ({ ...status, last_pushed: [...status.last_pushed], last_unknown: [...status.last_unknown] }),
    tick,
    stop: () => clearInterval(timer),
  };
}
