import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { executeImport, importPermissions, initialReceipt, packageHash, parseImportPackage, parseReceipt, receiptKey } from '../importPackage.js';
import type { ImportPackage, ImportReceipt, ImportTransport, ReceiptStorage } from '../importPackage.js';

const project = 'yjhhhmjgsmyzyymvixot';
const actor = '10000000-0000-0000-0000-000000000001';
const previewHash = 'a'.repeat(64);
const packageId = 'b'.repeat(64);
function pack(): ImportPackage {
  return { format: 'breakery-historical-financial/1', target_project_ref: project, batches: [1, 2].map((n) => ({
    client_key: `20000000-0000-0000-0000-00000000000${n}`,
    payload: { contract_version: 1, kind: 'sales', stock_mode: 'financial_only', currency: 'IDR', source_system: 'fixture', batch_reference: `test-${n}`,
      documents: [{ source_reference: `SALE-${n}`, stock_mode: 'financial_only' }], payments: [] },
  })) };
}
let storage: ReceiptStorage;
let transport: ImportTransport;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  const saved = new Map<string, string>();
  storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); } };
  transport = { preview: vi.fn().mockResolvedValue({ valid: true, preview_hash: previewHash }),
    apply: vi.fn().mockResolvedValue({ run_id: '30000000-0000-0000-0000-000000000001' }) };
});
const run = (p = pack()) => executeImport({ pack: p, packageId, actor, storage, transport, onProgress: vi.fn() });

describe('historical sales package boundary', () => {
  it('rejects a different database before any network call', () => {
    expect(() => parseImportPackage(JSON.stringify(pack()), 'different-project')).toThrow(/connected database/);
    expect(transport.preview).not.toHaveBeenCalled();
  });
  it('rejects stock-changing payloads and duplicate document identities', () => {
    const p = pack(); p.batches[0]!.payload.stock_mode = 'legacy';
    expect(() => parseImportPackage(JSON.stringify(p), project)).toThrow(/financial batch/);
    const duplicate = pack(); duplicate.batches[1]!.payload.documents = duplicate.batches[0]!.payload.documents;
    expect(() => parseImportPackage(JSON.stringify(duplicate), project)).toThrow(/source reference/);
  });
  it('rejects duplicate idempotency keys and more than 100 documents', () => {
    const p = pack(); p.batches[1]!.client_key = p.batches[0]!.client_key;
    expect(() => parseImportPackage(JSON.stringify(p), project)).toThrow(/batch key/);
    const oversized = pack(); oversized.batches[0]!.payload.documents = Array.from({ length: 101 }, (_, i) => ({ source_reference: String(i) }));
    expect(() => parseImportPackage(JSON.stringify(oversized), project)).toThrow(/financial batch/);
  });
  it('ties recovery to the exact operator, package and database', () => {
    const receipt = initialReceipt(pack(), packageId, actor);
    expect(() => parseReceipt(JSON.stringify(receipt), pack(), packageId, 'different-actor')).toThrow(/does not match/);
    expect(() => parseReceipt(JSON.stringify(receipt), pack(), 'c'.repeat(64), actor)).toThrow(/does not match/);
  });
  it('refuses an attempted receipt without the original preview hash', () => {
    const receipt = initialReceipt(pack(), packageId, actor); receipt.batches[0]!.status = 'attempted';
    expect(() => parseReceipt(JSON.stringify(receipt), pack(), packageId, actor)).toThrow(/preview hash/);
  });
  it('hashes package changes differently', async () => {
    const original = pack(); const changed = pack(); changed.batches[0]!.payload.batch_reference = 'changed';
    expect(await packageHash(original)).not.toBe(await packageHash(changed));
  });
  it('accepts purchases only with all purchase workflow permissions', () => {
    const p = pack(); p.batches.forEach((b) => { b.payload.kind = 'purchases'; });
    const parsed = parseImportPackage(JSON.stringify(p), project);
    expect(importPermissions(parsed)).toEqual(['accounting.je.create_manual', 'purchasing.po.create', 'purchasing.po.receive', 'purchasing.po.pay']);
  });
  it('rejects a document that does not explicitly defer stock', () => {
    const p = pack(); p.batches[0]!.payload.documents = [{ source_reference: 'SALE-1' }];
    expect(() => parseImportPackage(JSON.stringify(p), project)).toThrow(/explicitly defer stock/);
  });
});

describe('historical import execution and recovery', () => {
  it('previews and applies sequentially, using a fresh preview after each applied batch', async () => {
    const calls: string[] = [];
    transport.preview = vi.fn(() => { calls.push('preview'); return Promise.resolve({ valid: true, preview_hash: previewHash }); });
    transport.apply = vi.fn(() => { calls.push('apply'); return Promise.resolve({ run_id: 'run' }); });
    const receipt = await run();
    expect(calls).toEqual(['preview', 'apply', 'preview', 'apply']);
    expect(receipt.batches.every((b) => b.status === 'applied')).toBe(true);
  });
  it('stops before apply when the server refuses the first batch', async () => {
    transport.preview = vi.fn().mockResolvedValue({ valid: false, errors: [{ code: 'insufficient_display_stock' }] });
    await expect(run()).rejects.toThrow(/insufficient_display_stock/);
    expect(transport.preview).toHaveBeenCalledTimes(1);
    expect(transport.apply).not.toHaveBeenCalled();
  });
  it('refuses all money writes when recovery storage is unavailable', async () => {
    storage.setItem = () => { throw new Error('quota'); };
    await expect(run()).rejects.toThrow('quota');
    expect(transport.apply).not.toHaveBeenCalled();
  });
  it('does not apply if storage fails after preview', async () => {
    const save = storage.setItem; let count = 0;
    storage.setItem = (key, value) => { if (++count === 2) throw new Error('quota'); save(key, value); };
    await expect(run()).rejects.toThrow('quota');
    expect(transport.preview).toHaveBeenCalledTimes(1);
    expect(transport.apply).not.toHaveBeenCalled();
  });
  it('retries an uncertain apply with the same key, hash and payload, without another preview', async () => {
    const p = pack(); p.batches = p.batches.slice(0, 1);
    transport.apply = vi.fn().mockRejectedValueOnce(new Error('network timeout')).mockResolvedValue({ run_id: 'run', idempotent_replay: true });
    await expect(run(p)).rejects.toThrow(/timeout/);
    const before = JSON.parse(storage.getItem(receiptKey(project, actor, packageId)) ?? '{}') as ImportReceipt;
    expect(before.batches[0]?.status).toBe('attempted');
    await run(p);
    expect(transport.preview).toHaveBeenCalledTimes(1);
    expect(transport.apply).toHaveBeenNthCalledWith(1, p.batches[0], previewHash);
    expect(transport.apply).toHaveBeenNthCalledWith(2, p.batches[0], previewHash);
  });
  it('keeps completed batches and stops at the first apply failure', async () => {
    transport.apply = vi.fn().mockResolvedValueOnce({ run_id: 'run' }).mockRejectedValueOnce(new Error('permission_denied'));
    await expect(run()).rejects.toThrow('permission_denied');
    const saved = JSON.parse(storage.getItem(receiptKey(project, actor, packageId)) ?? '{}') as ImportReceipt;
    expect(saved.batches.map((b: { status: string }) => b.status)).toEqual(['applied', 'attempted']);
  });
  it('requires a fresh preview only after the explicit stale-preview rejection', async () => {
    const p = pack(); p.batches = p.batches.slice(0, 1);
    transport.apply = vi.fn().mockRejectedValueOnce(new Error('historical_preview_stale')).mockResolvedValue({ run_id: 'run' });
    await expect(run(p)).rejects.toThrow('historical_preview_stale');
    const saved = JSON.parse(storage.getItem(receiptKey(project, actor, packageId)) ?? '{}') as ImportReceipt;
    expect(saved.batches[0]).not.toHaveProperty('preview_hash');
    await run(p);
    expect(transport.preview).toHaveBeenCalledTimes(2);
  });
  it('rechecks a saved completion through the idempotent server path', async () => {
    const p = pack(); p.batches = p.batches.slice(0, 1);
    await run(p); await run(p);
    expect(transport.preview).toHaveBeenCalledTimes(1);
    expect(transport.apply).toHaveBeenCalledTimes(2);
  });
  it('keeps recovery receipts compact instead of duplicating server inventory snapshots', async () => {
    const p = pack(); p.batches = p.batches.slice(0, 1);
    transport.apply = vi.fn().mockResolvedValue({ run_id: 'run', stock_effect_count: 0, recipe_snapshot: 'x'.repeat(100_000) });
    const receipt = await run(p);
    expect(receipt.batches[0]?.result).toEqual({ run_id: 'run', stock_effect_count: 0 });
    expect(storage.getItem(receiptKey(project, actor, packageId))?.length).toBeLessThan(2000);
  });
});
