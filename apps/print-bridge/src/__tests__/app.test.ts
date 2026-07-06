import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  return createApp({ config: { port: 3001, receiptPrinter }, send, kick, probe, scan });
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
    expect(res.body.status).toBe('ok');
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
    expect(res.body.success).toBe(false);
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
    expect(res.body.error).toBe('missing_printer');
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
    expect(res.body.devices).toEqual([{ ip: '192.168.1.60', port: 9100, latencyMs: 8 }]);
    expect(res.body.hostsScanned).toBe(254);
    expect(typeof res.body.durationMs).toBe('number');
    expect(scan).toHaveBeenCalledWith(expect.arrayContaining(['192.168.1.1']), 9100, 300, 50);
  });
  it('400 invalid_range on public prefix', async () => {
    const res = await request(app()).get('/scan/printers?prefix=8.8.8');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_range');
  });
  it('400 invalid_range without prefix', async () => {
    const res = await request(app()).get('/scan/printers');
    expect(res.status).toBe(400);
  });
  it('502 when the injected scan rejects', async () => {
    scan.mockRejectedValueOnce(new Error('scan_failed'));
    const res = await request(app()).get('/scan/printers?prefix=192.168.1');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('scan_failed');
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
    expect(res.body.error).toBe('probe_failed');
  });
});
