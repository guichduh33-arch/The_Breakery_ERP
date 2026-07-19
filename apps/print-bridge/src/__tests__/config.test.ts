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

  it('hub defaults: no token, hub-buffer.jsonl', () => {
    const c = loadConfig({});
    expect(c.hubToken).toBeNull();
    expect(c.hubBufferFile).toBe('hub-buffer.jsonl');
  });

  it('reads HUB_TOKEN and HUB_BUFFER_FILE, trimming; blank token stays null', () => {
    expect(loadConfig({ HUB_TOKEN: '  s3cret ' }).hubToken).toBe('s3cret');
    expect(loadConfig({ HUB_TOKEN: '   ' }).hubToken).toBeNull();
    expect(loadConfig({ HUB_BUFFER_FILE: 'C:/hub/buf.jsonl' }).hubBufferFile).toBe('C:/hub/buf.jsonl');
  });

  it('cloud-sync defaults to null; reads HUB_CLOUD_URL + HUB_CLOUD_SECRET, trimming (lot 2)', () => {
    const c = loadConfig({});
    expect(c.hubCloudUrl).toBeNull();
    expect(c.hubCloudSecret).toBeNull();
    const set = loadConfig({
      HUB_CLOUD_URL: ' https://x.supabase.co/functions/v1/lan-heartbeat-batch ',
      HUB_CLOUD_SECRET: ' s3cret ',
    });
    expect(set.hubCloudUrl).toBe('https://x.supabase.co/functions/v1/lan-heartbeat-batch');
    expect(set.hubCloudSecret).toBe('s3cret');
    expect(loadConfig({ HUB_CLOUD_SECRET: '   ' }).hubCloudSecret).toBeNull();
  });
});
