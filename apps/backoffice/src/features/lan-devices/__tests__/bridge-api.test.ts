import { describe, it, expect, vi, afterEach } from 'vitest';
import { scanPrinters, probePrinter, sendTestTicket } from '../api/bridgeApi.js';
import { isPrivatePrefix } from '../utils/ipGuard.js';

afterEach(() => vi.restoreAllMocks());

describe('isPrivatePrefix (client copy)', () => {
  it('accepts 192.168.1, rejects 8.8.8', () => {
    expect(isPrivatePrefix('192.168.1')).toBe(true);
    expect(isPrivatePrefix('8.8.8')).toBe(false);
  });
});

describe('scanPrinters', () => {
  it('GETs the bridge and returns the parsed body', async () => {
    const body = { devices: [{ ip: '192.168.1.60', port: 9100, latencyMs: 8 }], hostsScanned: 254, durationMs: 1200 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
    const res = await scanPrinters('http://localhost:3001', '192.168.1');
    expect(res.devices).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/scan/printers?prefix=192.168.1&timeout=500',
      expect.objectContaining({ method: 'GET' }),
    );
  });
  it('throws bridge_unreachable on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(scanPrinters('http://localhost:3001', '192.168.1')).rejects.toThrow('bridge_unreachable');
  });
});

describe('probePrinter', () => {
  it('returns the probe body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ reachable: true, latencyMs: 5 }), { status: 200 })));
    expect(await probePrinter('http://x', '192.168.1.60', 9100)).toEqual({ reachable: true, latencyMs: 5 });
  });
});

describe('sendTestTicket', () => {
  it('POSTs a prep test ticket to /print/ticket', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await sendTestTicket('http://x', { ip_address: '192.168.1.60', port: 9100 }, 'kitchen');
    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/print/ticket');
    const sent = JSON.parse(init.body as string) as {
      printer: { ip_address: string; port: number };
      kind: string;
      role: string;
      order_number: string;
    };
    expect(sent.printer).toEqual({ ip_address: '192.168.1.60', port: 9100 });
    expect(sent.kind).toBe('prep');
    expect(sent.role).toBe('kitchen');
    expect(sent.order_number).toBe('TEST');
  });
});
