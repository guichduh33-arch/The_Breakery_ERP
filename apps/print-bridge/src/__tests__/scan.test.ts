import net from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeTcp, scanHosts, hostsForPrefix } from '../scan.js';

let server: net.Server;
let openPort = 0;

beforeAll(async () => {
  server = net.createServer((s) => s.destroy());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  openPort = (server.address() as net.AddressInfo).port;
});
afterAll(() => server.close());

describe('probeTcp', () => {
  it('returns a latency for an open port', async () => {
    const latency = await probeTcp('127.0.0.1', openPort, 1000);
    expect(latency).not.toBeNull();
    expect(latency!).toBeGreaterThanOrEqual(0);
  });
  it('returns null for a closed port', async () => {
    expect(await probeTcp('127.0.0.1', 1, 500)).toBeNull();
  });
});

describe('scanHosts', () => {
  it('finds only the reachable host', async () => {
    const hits = await scanHosts(['127.0.0.1'], openPort, 1000);
    expect(hits).toEqual([{ ip: '127.0.0.1', port: openPort, latencyMs: expect.any(Number) }]);
  });
  it('empty when nothing listens', async () => {
    expect(await scanHosts(['127.0.0.1'], 1, 300)).toEqual([]);
  });
});

describe('hostsForPrefix', () => {
  it('expands prefix.1..254', () => {
    const hosts = hostsForPrefix('192.168.1');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts[253]).toBe('192.168.1.254');
  });
});
