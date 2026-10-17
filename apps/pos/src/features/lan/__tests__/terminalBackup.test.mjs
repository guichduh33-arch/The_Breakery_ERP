// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { captureTerminalBackup, encryptTerminalBackup } from '../terminalBackup.ts';

const projectRef = 'getctmbpjnrrjzncaqze';
const storage = (values = {}) => ({ getItem: (key) => values[key] ?? null });
const input = () => ({ projectRef, terminalCode: 'POS-1', origin: 'https://pos.example.com',
  local: storage(), session: storage() });

describe('terminal recovery export', () => {
  it('preserves original payment keys, legacy intents and rejected records without auth secrets', async () => {
    const local = storage({
      'pos:offline_outbox': '[{"kind":"cash_payment","id":"original-key","seq":3}]',
      'pos:offline_quarantine': '[{"id":"rejected-key","reason":"original reason"}]',
      'breakery.payment-attempt.v1': '{"state":"pending","context":{"idempotencyKey":"same-key"}}',
      'breakery-offline-intent-seq': '15', 'lan:device': 'secret', 'breakery-pos-auth': 'token',
    });
    const result = await captureTerminalBackup({ ...input(), local });
    expect(result.local['breakery.payment-attempt.v1']).toContain('"pending"');
    expect(result.local['pos:offline_outbox']).toContain('original-key');
    expect(result.local['pos:offline_quarantine']).toContain('rejected-key');
    expect(result.local['breakery-offline-intent-seq']).toBe('15');
    expect(result.local).not.toHaveProperty('lan:device');
    expect(result.local).not.toHaveProperty('breakery-pos-auth');
  });

  it('refuses concurrent changes instead of claiming a stable snapshot', async () => {
    let sequence = 0;
    await expect(captureTerminalBackup({ ...input(), local: {
      getItem: (key) => key === 'breakery-offline-intent-seq' ? String(sequence++) : null,
    } })).rejects.toThrow('changed');
  });

  it('does not create databases when none exist', async () => {
    const open = vi.fn();
    const factory = { databases: async () => [], open };
    const result = await captureTerminalBackup({ ...input(), factory });
    expect(open).not.toHaveBeenCalled();
    expect(result.databases.every((db) => !db.present)).toBe(true);
  });

  it('fails closed when safe database enumeration is unavailable or storage is inaccessible', async () => {
    await expect(captureTerminalBackup({ ...input(), factory: {} })).rejects.toThrow('enumerate');
    await expect(captureTerminalBackup({ ...input(), local: { getItem: () => { throw new Error('denied'); } } })).rejects.toThrow('denied');
  });

  it('reads both offline stores together in a readonly transaction and closes the handle', async () => {
    const close = vi.fn();
    const transaction = vi.fn((names, mode) => {
      expect(mode).toBe('readonly');
      expect(names).toEqual(['outbox', 'quarantine']);
      const tx = { oncomplete: () => {}, objectStore: (name) => ({ getAll: () => {
        const req = { result: [{ id: `${name}-original` }], onsuccess: () => {} };
        queueMicrotask(() => req.onsuccess()); return req;
      } }) };
      setTimeout(() => tx.oncomplete(), 0); return tx;
    });
    const factory = {
      databases: async () => [{ name: 'breakery-pos-offline', version: 2 }],
      open: () => {
        const request = { onsuccess: () => {}, result: { version: 2, close, transaction,
          objectStoreNames: { contains: () => true }, onversionchange: () => {} } };
        queueMicrotask(() => request.onsuccess()); return request;
      },
    };
    const result = await captureTerminalBackup({ ...input(), factory });
    expect(result.databases[0]?.stores.quarantine).toEqual([{ id: 'quarantine-original' }]);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('aborts creation if a database disappears after enumeration', async () => {
    const abort = vi.fn();
    const factory = {
      databases: async () => [{ name: 'breakery-pos-offline', version: 2 }],
      open: () => {
        const request = { transaction: { abort }, onupgradeneeded: () => {}, onerror: () => {} };
        queueMicrotask(() => { request.onupgradeneeded(); request.onerror(); });
        return request;
      },
    };
    await expect(captureTerminalBackup({ ...input(), factory })).rejects.toThrow('could not be read');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('encrypts a file restorable by the existing recovery toolkit', async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const snapshot = await captureTerminalBackup(input());
    const archive = await encryptTerminalBackup(snapshot, keys.publicKey);
    const directory = mkdtempSync(join(tmpdir(), 'breakery-terminal-export-'));
    try {
      const filename = join(directory, 'terminal.bkb');
      writeFileSync(filename, Buffer.from(await archive.arrayBuffer()));
      const modulePath = '../../../../../../scripts/release/encrypted-backup.mjs';
      const { restoreBackup } = createRequire(import.meta.url)(modulePath);
      const target = join(directory, 'restored');
      expect(restoreBackup(filename, keys.privateKey, target, projectRef).files).toBe(1);
      expect(JSON.parse(readFileSync(join(target, 'terminal-outboxes/snapshot.json'), 'utf8'))).toEqual(snapshot);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('rejects private keys and unidentified terminals', async () => {
    await expect(encryptTerminalBackup(await captureTerminalBackup(input()), '-----BEGIN PRIVATE KEY-----')).rejects.toThrow('PUBLIC');
    await expect(captureTerminalBackup({ ...input(), terminalCode: '' })).rejects.toThrow('explicit');
  });
});
