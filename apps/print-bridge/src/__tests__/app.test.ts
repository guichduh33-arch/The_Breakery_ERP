import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { PrinterTarget, ReceiptPayload, StationTicketPayload } from '@breakery/domain';
import { createApp } from '../app.js';
import type { sendToPrinter } from '../transport.js';

// Type-friction adaptation (documented in the report): the brief's literal
// `(p: unknown) => void` render param is contravariantly incompatible with
// `AppDeps.send`'s real `(p: PrinterLike) => void` signature under strict
// function types. Typing the mock from `typeof sendToPrinter` keeps the same
// runtime double (a resolved-void jest mock, never touching node-thermal-printer)
// while satisfying the compiler.
const send = vi.fn<typeof sendToPrinter>().mockResolvedValue();
const kick = vi.fn<(t: PrinterTarget) => Promise<void>>().mockResolvedValue();
const probe = vi.fn().mockResolvedValue(12);
const scan = vi.fn().mockResolvedValue([{ ip: '192.168.1.60', port: 9100, latencyMs: 8 }]);

function app(receiptPrinter: PrinterTarget | null = { ip_address: '192.168.1.50', port: 9100 }) {
  return createApp({
    config: {
      port: 3001, receiptPrinter, hubToken: null, hubBufferFile: 'hub-buffer.jsonl',
      hubCloudUrl: null, hubCloudSecret: null, posDistDir: null,
    },
    send, kick, probe, scan,
  });
}

// supertest's Response.body is `any` — narrow it once here instead of
// scattering unsafe member accesses across every assertion below.
function body(res: { body: unknown }): Record<string, unknown> {
  return res.body as Record<string, unknown>;
}

const RECEIPT: ReceiptPayload = {
  business: { name: 'B', address: 'A' },
  order: { order_number: '1', created_at: '2026-07-06T00:00:00Z', cashier_name: 'C', order_type: 'take_out' },
  items: [{ name: 'X', quantity: 1, unit_price: 1000, line_total: 1000 }],
  totals: { items_total: 1000, redemption_amount: 0, total: 1000, tax_amount: 100 },
  payment: { method: 'cash', amount: 1000 },
};
const TICKET: StationTicketPayload = {
  kind: 'prep', role: 'kitchen', order_number: '1',
  created_at: '2026-07-06T00:00:00Z', server_name: 'S',
  items: [{ name: 'X', quantity: 1 }],
};

beforeEach(() => { send.mockClear(); kick.mockClear(); probe.mockClear(); scan.mockClear(); send.mockResolvedValue(); });

describe('GET /health', () => {
  it('200 ok', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(body(res).status).toBe('ok');
  });
});

describe('GET /hub/status', () => {
  it('enabled:false when no hub is attached', async () => {
    const res = await request(app()).get('/hub/status');
    expect(res.status).toBe(200);
    expect(body(res)).toEqual({ enabled: false });
  });

  it('reports presence and buffer stats from the hub', async () => {
    const hub = {
      presence: () => [{
        device_code: 'POS-1', device_type: 'pos', ip: '192.168.1.10',
        connected_at: '2026-07-19T10:00:00Z', last_seen_at: '2026-07-19T10:00:05Z',
      }],
      bufferStats: () => ({ count: 3, oldest_ts: 'a', newest_ts: 'b' }),
      tokenRequired: true,
    };
    const res = await request(createApp({
      config: {
        port: 3001, receiptPrinter: null, hubToken: 's', hubBufferFile: 'b.jsonl',
        hubCloudUrl: null, hubCloudSecret: null, posDistDir: null,
      },
      send, kick, probe, scan, hub,
    })).get('/hub/status');
    expect(res.status).toBe(200);
    const b = body(res);
    expect(b.enabled).toBe(true);
    expect(b.token_required).toBe(true);
    expect((b.devices as unknown[]).length).toBe(1);
    expect(b.buffer).toEqual({ count: 3, oldest_ts: 'a', newest_ts: 'b' });
    // Lot 2 — sans cloud-sync attaché, le statut est explicitement désactivé.
    expect((b.cloud_sync as { enabled: boolean }).enabled).toBe(false);
  });

  it('surfaces the cloud-sync status when attached (lot 2)', async () => {
    const hub = {
      presence: () => [],
      bufferStats: () => ({ count: 0, oldest_ts: null, newest_ts: null }),
      tokenRequired: false,
    };
    const cloudSync = {
      status: () => ({
        enabled: true, last_push_at: '2026-07-19T10:00:00Z', last_result: 'ok' as const,
        last_error: null, last_pushed: ['POS-1'], last_unknown: [],
      }),
    };
    const res = await request(createApp({
      config: {
        port: 3001, receiptPrinter: null, hubToken: null, hubBufferFile: 'b.jsonl',
        hubCloudUrl: 'https://x.supabase.co/functions/v1/lan-heartbeat-batch', hubCloudSecret: 's',
        posDistDir: null,
      },
      send, kick, probe, scan, hub, cloudSync,
    })).get('/hub/status');
    expect(res.status).toBe(200);
    expect(body(res).cloud_sync).toEqual({
      enabled: true, last_push_at: '2026-07-19T10:00:00Z', last_result: 'ok',
      last_error: null, last_pushed: ['POS-1'], last_unknown: [],
    });
  });
});

describe('POST /print/receipt', () => {
  it('routes to body.printer when provided', async () => {
    const res = await request(app()).post('/print/receipt')
      .send({ ...RECEIPT, printer: { ip_address: '192.168.1.99', port: 9100 } });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith({ ip_address: '192.168.1.99', port: 9100 }, expect.any(Function));
  });
  it('falls back to env receipt printer', async () => {
    await request(app()).post('/print/receipt').send(RECEIPT);
    expect(send).toHaveBeenCalledWith({ ip_address: '192.168.1.50', port: 9100 }, expect.any(Function));
  });
  it('400 no_receipt_printer_configured when neither', async () => {
    const res = await request(app(null)).post('/print/receipt').send(RECEIPT);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'no_receipt_printer_configured' });
  });
  it('400 on malformed payload', async () => {
    const res = await request(app()).post('/print/receipt').send({ nope: true });
    expect(res.status).toBe(400);
  });
  it('502 when the printer is down', async () => {
    send.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app()).post('/print/receipt').send(RECEIPT);
    expect(res.status).toBe(502);
    expect(body(res).success).toBe(false);
  });
  it('400 invalid_printer_target on a public IP', async () => {
    const res = await request(app()).post('/print/receipt')
      .send({ ...RECEIPT, printer: { ip_address: '8.8.8.8', port: 9100 } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'invalid_printer_target' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('POST /print/ticket', () => {
  it('prints to the body printer', async () => {
    const res = await request(app()).post('/print/ticket')
      .send({ printer: { ip_address: '192.168.1.60', port: 9100 }, ...TICKET });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith({ ip_address: '192.168.1.60', port: 9100 }, expect.any(Function));
  });
  it('400 missing_printer without printer', async () => {
    const res = await request(app()).post('/print/ticket').send(TICKET);
    expect(res.status).toBe(400);
    expect(body(res).error).toBe('missing_printer');
  });
  it('400 invalid_printer_target on a public IP', async () => {
    const res = await request(app()).post('/print/ticket')
      .send({ printer: { ip_address: '8.8.8.8', port: 9100 }, ...TICKET });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'invalid_printer_target' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('POST /drawer/open', () => {
  it('kicks the env receipt printer', async () => {
    const res = await request(app()).post('/drawer/open');
    expect(res.status).toBe(200);
    expect(kick).toHaveBeenCalledWith({ ip_address: '192.168.1.50', port: 9100 });
  });
  it('400 when no receipt printer configured', async () => {
    const res = await request(app(null)).post('/drawer/open');
    expect(res.status).toBe(400);
  });
});

describe('GET /scan/printers', () => {
  it('scans a private prefix', async () => {
    const res = await request(app()).get('/scan/printers?prefix=192.168.1&timeout=300');
    expect(res.status).toBe(200);
    expect(body(res).devices).toEqual([{ ip: '192.168.1.60', port: 9100, latencyMs: 8 }]);
    expect(body(res).hostsScanned).toBe(254);
    expect(typeof body(res).durationMs).toBe('number');
    expect(scan).toHaveBeenCalledWith(expect.arrayContaining(['192.168.1.1']), 9100, 300, 50);
  });
  it('400 invalid_range on public prefix', async () => {
    const res = await request(app()).get('/scan/printers?prefix=8.8.8');
    expect(res.status).toBe(400);
    expect(body(res).error).toBe('invalid_range');
  });
  it('400 invalid_range without prefix', async () => {
    const res = await request(app()).get('/scan/printers');
    expect(res.status).toBe(400);
  });
  it('502 when the injected scan rejects', async () => {
    scan.mockRejectedValueOnce(new Error('scan_failed'));
    const res = await request(app()).get('/scan/printers?prefix=192.168.1');
    expect(res.status).toBe(502);
    expect(body(res).error).toBe('scan_failed');
  });
});

describe('GET /status/probe', () => {
  it('reports reachable + latency', async () => {
    const res = await request(app()).get('/status/probe?ip=192.168.1.60');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reachable: true, latencyMs: 12 });
  });
  it('reports unreachable', async () => {
    probe.mockResolvedValueOnce(null);
    const res = await request(app()).get('/status/probe?ip=192.168.1.61');
    expect(res.body).toEqual({ reachable: false });
  });
  it('400 invalid_range on public ip', async () => {
    const res = await request(app()).get('/status/probe?ip=8.8.8.8');
    expect(res.status).toBe(400);
  });
  it('502 when the injected probe rejects', async () => {
    probe.mockRejectedValueOnce(new Error('probe_failed'));
    const res = await request(app()).get('/status/probe?ip=192.168.1.62');
    expect(res.status).toBe(502);
    expect(body(res).error).toBe('probe_failed');
  });
});

// Spec 006x §4.1 (lot 5) — SPA POS servie en LAN depuis le hub, gatée par
// POS_DIST_DIR. Les routes API gardent la priorité ; tout GET inconnu retombe
// sur index.html (routing client React Router).
describe('POS SPA serving (POS_DIST_DIR)', () => {
  let distDir: string;

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-dist-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html>POS SPA</html>', 'utf8');
    fs.mkdirSync(path.join(distDir, 'assets'));
    fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("pos")', 'utf8');
  });
  afterEach(() => { fs.rmSync(distDir, { recursive: true, force: true }); });

  function spaApp(dir: string | null = null) {
    return createApp({
      config: {
        port: 3001, receiptPrinter: null, hubToken: null, hubBufferFile: 'b.jsonl',
        hubCloudUrl: null, hubCloudSecret: null, posDistDir: dir ?? distDir,
      },
      send, kick, probe, scan,
    });
  }

  it('serves index.html at / and static assets', async () => {
    const root = await request(spaApp()).get('/');
    expect(root.status).toBe(200);
    expect(root.text).toContain('POS SPA');
    const asset = await request(spaApp()).get('/assets/app.js');
    expect(asset.status).toBe(200);
  });

  it('falls back to index.html on unknown GET routes (client routing)', async () => {
    const res = await request(spaApp()).get('/pos/checkout');
    expect(res.status).toBe(200);
    expect(res.text).toContain('POS SPA');
  });

  it('API routes keep priority over the SPA fallback', async () => {
    const res = await request(spaApp()).get('/health');
    expect(res.status).toBe(200);
    expect(body(res).status).toBe('ok');
  });

  it('404 spa_index_not_found when the dist dir has no index.html', async () => {
    fs.rmSync(path.join(distDir, 'index.html'));
    const res = await request(spaApp()).get('/anything');
    expect(res.status).toBe(404);
    expect(body(res).error).toBe('spa_index_not_found');
  });

  it('without POS_DIST_DIR, unknown GETs stay 404 (historic behaviour)', async () => {
    const res = await request(app()).get('/pos/checkout');
    expect(res.status).toBe(404);
  });
});
