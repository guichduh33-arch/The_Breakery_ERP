// apps/pos/src/services/print/bridgeDiagnostics.ts
//
// ADR-030 — le back-office est publié en HTTPS, il ne peut donc plus appeler un
// `http://` du réseau local. Les gestes de diagnostic du print-bridge quittent
// le BO et vivent ici, dans le POS servi en local : balayage réseau, sonde
// d'imprimante, état du hub.
//
// L'impression métier reste dans `printService` — ce module ne porte que le
// diagnostic, et partage son URL de bridge via `getPrintServerUrl()`.
import { getPrintServerUrl } from './printService';

export interface ScanDeviceHit {
  ip: string;
  port: number;
  latencyMs: number;
}
export interface ScanResponse {
  devices: ScanDeviceHit[];
  hostsScanned: number;
  durationMs: number;
}
export interface ProbeResponse {
  reachable: boolean;
  latencyMs?: number;
}

export interface HubDevicePresence {
  device_code: string;
  device_type: string;
  ip: string;
  connected_at: string;
  last_seen_at: string;
}
export interface HubBufferStats {
  count: number;
  oldest_ts: string | null;
  newest_ts: string | null;
}
export interface HubCloudSyncStatus {
  enabled: boolean;
  last_push_at: string | null;
  last_result: 'ok' | 'error' | null;
  last_error: string | null;
  last_pushed: string[];
  last_unknown: string[];
}
export type HubStatusResponse =
  | { enabled: false }
  | {
      enabled: true;
      version: string;
      uptime_s: number;
      token_required: boolean;
      devices: HubDevicePresence[];
      buffer: HubBufferStats;
      /** Absent sur un bridge antérieur au heartbeat agrégé — traiter comme désactivé. */
      cloud_sync?: HubCloudSyncStatus;
    };

/** Erreur réseau → `bridge_unreachable`, pour un message d'interface unique et actionnable. */
async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${getPrintServerUrl()}${path}`, init);
  } catch {
    throw new Error('bridge_unreachable');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `bridge_http_${res.status}`);
  }
  return res;
}

export async function getHubStatus(): Promise<HubStatusResponse> {
  const res = await bridgeFetch('/hub/status', { method: 'GET' });
  return (await res.json()) as HubStatusResponse;
}

export async function scanPrinters(prefix: string, signal?: AbortSignal): Promise<ScanResponse> {
  const init: RequestInit = { method: 'GET' };
  if (signal) init.signal = signal;
  const res = await bridgeFetch(
    `/scan/printers?prefix=${encodeURIComponent(prefix)}&timeout=500`,
    init,
  );
  return (await res.json()) as ScanResponse;
}

export async function probePrinter(ip: string, port: number): Promise<ProbeResponse> {
  const res = await bridgeFetch(
    `/status/probe?ip=${encodeURIComponent(ip)}&port=${port}`,
    { method: 'GET' },
  );
  return (await res.json()) as ProbeResponse;
}
