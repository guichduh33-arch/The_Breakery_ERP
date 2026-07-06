// apps/print-bridge/src/__tests__/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  it('defaults: port 3001, no receipt printer', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3001);
    expect(c.receiptPrinter).toBeNull();
  });

  it('reads receipt printer from env', () => {
    const c = loadConfig({ PORT: '3005', RECEIPT_PRINTER_IP: '192.168.1.50', RECEIPT_PRINTER_PORT: '9101' });
    expect(c.port).toBe(3005);
    expect(c.receiptPrinter).toEqual({ ip_address: '192.168.1.50', port: 9101 });
  });

  it('falls back to 9100 when RECEIPT_PRINTER_PORT is garbage', () => {
    const c = loadConfig({ RECEIPT_PRINTER_IP: '10.0.0.9', RECEIPT_PRINTER_PORT: 'abc' });
    expect(c.receiptPrinter).toEqual({ ip_address: '10.0.0.9', port: 9100 });
  });
});
