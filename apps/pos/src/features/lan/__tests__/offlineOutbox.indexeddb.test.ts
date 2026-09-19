import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function prepareWrite() {
  vi.resetModules();
  const transaction = {
    error: null,
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    objectStore: () => ({ put: () => ({ result: 'key' }) }),
  };
  const opened = {
    result: { transaction: () => transaction },
    onsuccess: null as (() => void) | null,
  };
  vi.stubGlobal('indexedDB', { open: () => {
    queueMicrotask(() => opened.onsuccess?.());
    return opened;
  } });
  const { enqueueIntent } = await import('../offlineOutbox');
  const promise = enqueueIntent({ kind: 'tablet_order', id: 'key', seq: 1,
    created_at: '2026-09-19T00:00:00Z', local_number: 'L-1', waiter_id: 'w1',
    table_number: '7', order_type: 'dine_in', notes: null, items: [],
  });
  await Promise.resolve();
  await Promise.resolve();
  return { transaction, promise };
}

describe('durabilité IndexedDB avant confirmation tablette', () => {
  it('attend le commit de la transaction avant de confirmer l’écriture', async () => {
    const { transaction, promise } = await prepareWrite();
    let committed = false;
    void promise.then(() => { committed = true; });
    await Promise.resolve();
    expect(committed).toBe(false);
    transaction.oncomplete?.();
    await promise;
    expect(committed).toBe(true);
  });

  it('remonte un abort de transaction au lieu de confirmer la sauvegarde', async () => {
    const { transaction, promise } = await prepareWrite();
    const rejected = expect(promise).rejects.toThrow('indexeddb_tx_aborted');
    transaction.onabort?.();
    await rejected;
  });
});
