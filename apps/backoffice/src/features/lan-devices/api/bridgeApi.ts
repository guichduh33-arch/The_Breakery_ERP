// apps/backoffice/src/features/lan-devices/api/bridgeApi.ts
// Client HTTP du print-bridge (spec §4.2/§5). Erreur réseau → 'bridge_unreachable'
// pour un message UI unique et actionnable.

export interface ScanDeviceHit { ip: string; port: number; latencyMs: number; }
export interface ScanResponse { devices: ScanDeviceHit[]; hostsScanned: number; durationMs: number; }
export interface ProbeResponse { reachable: boolean; latencyMs?: number; }
export interface BridgePrinterTarget { ip_address: string; port: number; }

// Spec 006x lot 1 — GET /hub/status (panneau « Hub » de LanDevicesPage).
export interface HubDevicePresence {
  device_code: string;
  device_type: string;
  ip: string;
  connected_at: string;
  last_seen_at: string;
}
export interface HubBufferStats { count: number; oldest_ts: string | null; newest_ts: string | null; }
export type HubStatusResponse =
  | { enabled: false }
  | {
      enabled: true;
      version: string;
      uptime_s: number;
      token_required: boolean;
      devices: HubDevicePresence[];
      buffer: HubBufferStats;
    };

async function bridgeFetch(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('bridge_unreachable');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `bridge_http_${res.status}`);
  }
  return res;
}

export async function getHubStatus(bridgeUrl: string): Promise<HubStatusResponse> {
  const res = await bridgeFetch(`${bridgeUrl}/hub/status`, { method: 'GET' });
  return (await res.json()) as HubStatusResponse;
}

export async function scanPrinters(bridgeUrl: string, prefix: string, signal?: AbortSignal): Promise<ScanResponse> {
  const init: RequestInit = { method: 'GET' };
  if (signal) init.signal = signal;
  const res = await bridgeFetch(
    `${bridgeUrl}/scan/printers?prefix=${encodeURIComponent(prefix)}&timeout=500`,
    init,
  );
  return (await res.json()) as ScanResponse;
}

export async function probePrinter(bridgeUrl: string, ip: string, port: number): Promise<ProbeResponse> {
  const res = await bridgeFetch(
    `${bridgeUrl}/status/probe?ip=${encodeURIComponent(ip)}&port=${port}`,
    { method: 'GET' },
  );
  return (await res.json()) as ProbeResponse;
}

export async function sendTestTicket(
  bridgeUrl: string,
  printer: BridgePrinterTarget,
  station: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await bridgeFetch(`${bridgeUrl}/print/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      printer,
      kind: 'prep',
      role: station,
      order_number: 'TEST',
      created_at: new Date().toISOString(),
      server_name: 'Backoffice',
      items: [{ name: 'Test ticket — LAN Devices', quantity: 1 }],
    }),
  });
  return (await res.json()) as { success: boolean; error?: string };
}
