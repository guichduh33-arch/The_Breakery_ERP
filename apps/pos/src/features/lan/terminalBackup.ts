// Export conservatoire : aucune mutation, aucun rejeu et aucune restauration.
import { FINANCIAL_ATTEMPT_PREFIX, financialStorageKey } from '@breakery/utils';
import { validRefundSlot } from '@/features/order-history/hooks/refundRecovery';
const LOCAL_KEYS = [
  'pos:offline_outbox', 'pos:offline_quarantine', 'pos:event_outbox',
  'breakery-offline-intent-seq', 'breakery-local-order-seq',
  'pos:device_token', 'pos:device_seq', 'breakery.payment-attempt.v1',
  'breakery.print-jobs.v1', 'breakery.receipt-jobs.v1', 'breakery.kitchen-journal.v1',
] as const;
const SESSION_KEYS = ['breakery.cart.v2', 'breakery.tablet-cart.v1', 'breakery.sale-snapshot.v1',
  'breakery.counter-fire-attempt.v1', 'breakery.cash-movement-attempt.v1'] as const;
const DATABASES = [
  { name: 'breakery-pos-offline', stores: ['outbox', 'quarantine'] },
  { name: 'breakery-pos-audit', stores: ['outbox'] },
];

function storageValues(storage: Pick<Storage, 'getItem'>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, storage.getItem(key)]));
}

function financialValues(storage: Pick<Storage, 'getItem' | 'key' | 'length'>): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(FINANCIAL_ATTEMPT_PREFIX)) continue;
    const parts = key.slice(FINANCIAL_ATTEMPT_PREFIX.length).split(':').map(decodeURIComponent);
    const [environment, profileId, operation, target] = parts;
    if (operation !== 'refund') continue;
    const raw = storage.getItem(key);
    const scope = { environment: environment ?? '', profileId: profileId ?? '', operation: 'refund' as const, target: target ?? '' };
    if (parts.length !== 4 || !environment || !profileId || !target || financialStorageKey(scope) !== key
      || raw === null || !validRefundSlot(JSON.parse(raw) as unknown, scope)) {
      throw new Error('Refund recovery data is invalid — preserve this terminal for recovery');
    }
    result[key] = raw;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

async function readDatabase(factory: IDBFactory, name: string, stores: string[]) {
  const existing = (await factory.databases()).find((db) => db.name === name);
  if (!existing) return { present: false, stores: {} };
  return new Promise<{ present: boolean; version: number; stores: Record<string, unknown[]> }>((resolve, reject) => {
    const request = factory.open(name);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('Terminal storage timed out')); }, 10000);
    const fail = () => { expired = true; clearTimeout(timer); reject(new Error('Terminal storage could not be read')); };
    // Une disparition entre inventaire et ouverture ne doit jamais créer de DB.
    request.onupgradeneeded = () => { request.transaction?.abort(); };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      const db = request.result;
      if (expired) { db.close(); return; }
      db.onversionchange = () => db.close();
      const available = stores.filter((store) => db.objectStoreNames.contains(store));
      if (!available.includes('outbox') || db.version > (name === 'breakery-pos-offline' ? 2 : 1) ||
          (name === 'breakery-pos-offline' && db.version === 2 && !available.includes('quarantine'))) {
        db.close(); fail(); return;
      }
      const result: Record<string, unknown[]> = {};
      const tx = db.transaction(available, 'readonly');
      for (const store of available) {
        const read = tx.objectStore(store).getAll();
        read.onsuccess = () => { result[store] = read.result as unknown[]; };
      }
      tx.oncomplete = () => {
        clearTimeout(timer); db.close();
        resolve({ present: true, version: db.version, stores: result });
      };
      tx.onerror = tx.onabort = () => { db.close(); fail(); };
    };
  });
}

export async function captureTerminalBackup(input: {
  projectRef: string; origin: string; terminalCode: string;
  local: Pick<Storage, 'getItem' | 'key' | 'length'>; session: Pick<Storage, 'getItem'>;
  factory?: IDBFactory | undefined; now?: Date;
}) {
  if (!/^[a-z0-9]{20}$/.test(input.projectRef) || !input.terminalCode.trim() ||
      input.terminalCode.length > 100 || !/^(https?:|capacitor:)/.test(input.origin)) {
    throw new Error('An explicit project, origin and terminal are required');
  }
  if (input.factory && typeof input.factory.databases !== 'function') {
    throw new Error('This browser cannot safely enumerate terminal storage');
  }
  const read = async () => {
    const local = { ...storageValues(input.local, LOCAL_KEYS), ...financialValues(input.local) };
    const session = storageValues(input.session, SESSION_KEYS);
    const databases = await Promise.all(DATABASES.map(async (db) => ({ name: db.name,
      ...(input.factory ? await readDatabase(input.factory, db.name, db.stores) : { present: false, stores: {} }),
    })));
    if (JSON.stringify(local) !== JSON.stringify({ ...storageValues(input.local, LOCAL_KEYS), ...financialValues(input.local) }) ||
        JSON.stringify(session) !== JSON.stringify(storageValues(input.session, SESSION_KEYS))) {
      throw new Error('Terminal data changed. Stop activity and retry the export');
    }
    return { local, session, databases };
  };
  const first = await read();
  const second = await read();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error('Terminal data changed. Stop activity and retry the export');
  }
  return {
    version: 1, projectRef: input.projectRef, origin: input.origin,
    terminalCode: input.terminalCode, createdAt: (input.now ?? new Date()).toISOString(),
    consistency: 'two-equal-reads-not-global-transaction',
    scope: 'current-origin-and-tab-only', applicationRecoveryVerified: false,
    // Les jetons de connexion et le secret LAN sont volontairement hors export.
    ...first,
  };
}

function base64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Même enveloppe authentifiée que scripts/release/encrypted-backup.mjs. */
export async function encryptTerminalBackup(snapshot: Awaited<ReturnType<typeof captureTerminalBackup>>, pem: string) {
  if (!/^-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+-----END PUBLIC KEY-----\s*$/.test(pem) || pem.length > 4096) {
    throw new Error('Select the recovery PUBLIC key PEM file');
  }
  const recipient = await crypto.subtle.importKey('spki',
    Uint8Array.from(atob(pem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, '')), (c) => c.charCodeAt(0)),
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
  if ((recipient.algorithm as RsaKeyAlgorithm).modulusLength < 3072) throw new Error('Recovery key is too small');
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(snapshot));
  if (data.length > 16 * 1024 * 1024) throw new Error('Terminal export exceeds the preparation limit');
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (x) => x.toString(16).padStart(2, '0')).join('');
  const payload = encoder.encode(JSON.stringify({
    version: 1, projectRef: snapshot.projectRef, createdAt: snapshot.createdAt,
    retentionDays: 30, scope: 'supplied-files-only',
    coverage: { database: 'missing', storage: 'missing', 'shop-config': 'missing', bundles: 'missing', 'terminal-outboxes': 'provided' },
    files: [{ path: 'terminal-outboxes/snapshot.json', sha256: sha, data: base64(data) }],
  }));
  const compressed = new Uint8Array(await new Response(
    new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer());
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', key, recipient, 'RSA-OAEP'));
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, wrapped.length);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = concat(encoder.encode('BREAKERY-BACKUP-1\n'), size, wrapped, iv);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: header, tagLength: 128,
  }, key, compressed));
  return new Blob([concat(header, ciphertext)], { type: 'application/octet-stream' });
}
