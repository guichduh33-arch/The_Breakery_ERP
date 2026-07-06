// Sweep TCP 9100 (spec §4.2). Seul un process Node sur le LAN peut faire ça —
// c'est LA raison d'être du scan côté bridge (le navigateur est aveugle en TCP brut).
import net from 'node:net';

export interface ScanHit {
  ip: string;
  port: number;
  latencyMs: number;
}

export function probeTcp(ip: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const done = (result: number | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(Date.now() - started));
    socket.once('timeout', () => done(null));
    socket.once('error', () => done(null));
    socket.connect(port, ip);
  });
}

export async function scanHosts(
  hosts: string[],
  port: number,
  timeoutMs: number,
  concurrency = 50,
): Promise<ScanHit[]> {
  const hits: ScanHit[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < hosts.length) {
      const ip = hosts[cursor++];
      if (ip === undefined) return;
      const latencyMs = await probeTcp(ip, port, timeoutMs);
      if (latencyMs !== null) hits.push({ ip, port, latencyMs });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, () => worker()));
  return hits.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

export function hostsForPrefix(prefix: string): string[] {
  return Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
}
