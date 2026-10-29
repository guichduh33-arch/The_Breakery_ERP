import type { Json, PermissionCode } from '@breakery/supabase';

export interface ImportBatch { client_key: string; payload: Record<string, Json | undefined> }
export interface ImportPackage {
  format: 'breakery-historical-financial/1'; target_project_ref: string; batches: ImportBatch[];
}
export interface BatchReceipt { client_key: string; status: 'new' | 'attempted' | 'applied'; preview_hash?: string; result?: Json }
export interface ImportReceipt { package_hash: string; project_ref: string; actor_id: string; batches: BatchReceipt[] }
export interface Preview { valid: boolean; preview_hash?: string; errors?: Json }
export interface ImportTransport {
  preview: (payload: ImportBatch['payload']) => Promise<Preview>;
  apply: (batch: ImportBatch, previewHash: string) => Promise<Json>;
}
export interface ReceiptStorage { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fail(message: string): never { throw new Error(message); }

export function parseImportPackage(text: string, projectRef: string): ImportPackage {
  if (new TextEncoder().encode(text).length > 20_000_000) fail('The package exceeds 20 MB.');
  const input: unknown = JSON.parse(text);
  if (!object(input) || input.format !== 'breakery-historical-financial/1' || input.target_project_ref !== projectRef) {
    fail('This package does not match the connected database.');
  }
  if (!Array.isArray(input.batches) || input.batches.length < 1 || input.batches.length > 1000) fail('Invalid batch list.');
  const keys = new Set<string>();
  const batchRefs = new Set<string>();
  const documents = new Set<string>();
  const payments = new Set<string>();
  for (const batch of input.batches) {
    if (!object(batch) || typeof batch.client_key !== 'string' || !uuid.test(batch.client_key) || keys.has(batch.client_key)) fail('Invalid or duplicate batch key.');
    keys.add(batch.client_key);
    const p = batch.payload;
    if (!object(p) || !['sales', 'purchases'].includes(String(p.kind)) || p.stock_mode !== 'financial_only' || p.currency !== 'IDR' || p.contract_version !== 1
      || typeof p.source_system !== 'string' || typeof p.batch_reference !== 'string'
      || !Array.isArray(p.documents) || p.documents.length < 1 || p.documents.length > 100
      || !Array.isArray(p.payments) || p.payments.length > 500) fail('Invalid financial batch.');
    if (p.documents.some((doc) => !object(doc) || doc.stock_mode !== 'financial_only')) fail('Every document must explicitly defer stock.');
    if (new TextEncoder().encode(JSON.stringify(p)).length > 2_000_000) fail('A batch exceeds the server size limit.');
    const identity = `${p.source_system}:${String(p.kind)}:${p.batch_reference}`;
    if (batchRefs.has(identity)) fail('Duplicate batch reference.');
    batchRefs.add(identity);
    for (const [records, seen] of [[p.documents, documents], [p.payments, payments]] as const) {
      for (const record of records) {
        if (!object(record) || typeof record.source_reference !== 'string' || !record.source_reference.trim()
          || record.source_reference !== record.source_reference.trim()) fail('Missing or untrimmed source reference.');
        const ref = `${p.source_system}:${String(p.kind)}:${record.source_reference}`;
        if (seen.has(ref)) fail('A source reference occurs in more than one batch.');
        seen.add(ref);
      }
    }
  }
  return input as unknown as ImportPackage;
}

export function importPermissions(pack: ImportPackage): PermissionCode[] {
  const permissions = new Set<PermissionCode>(['accounting.je.create_manual']);
  for (const batch of pack.batches) {
    if (batch.payload.kind === 'sales') permissions.add('pos.sale.create');
    else for (const permission of ['purchasing.po.create', 'purchasing.po.receive', 'purchasing.po.pay'] as const) permissions.add(permission);
  }
  return [...permissions];
}

export async function packageHash(pack: ImportPackage): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

export function receiptKey(project: string, actor: string, packageId: string): string {
  return `breakery.historical-import:${project}:${actor}:${packageId}`;
}

export function parseReceipt(text: string, pack: ImportPackage, packageId: string, actor: string): ImportReceipt {
  const r: unknown = JSON.parse(text);
  if (!object(r) || r.package_hash !== packageId || r.project_ref !== pack.target_project_ref || r.actor_id !== actor
    || !Array.isArray(r.batches) || r.batches.length !== pack.batches.length) fail('Recovery receipt does not match this package, database and operator.');
  for (const [i, entry] of r.batches.entries()) {
    if (!object(entry) || entry.client_key !== pack.batches[i]?.client_key
      || !['new', 'attempted', 'applied'].includes(String(entry.status))) fail('Invalid recovery entry.');
    if (entry.status !== 'new' && (typeof entry.preview_hash !== 'string' || !hash.test(entry.preview_hash))) fail('Recovery preview hash is missing.');
    if (entry.status === 'applied' && !object(entry.result)) fail('Recovery result is missing.');
  }
  return r as unknown as ImportReceipt;
}

export function initialReceipt(pack: ImportPackage, packageId: string, actor: string): ImportReceipt {
  return { package_hash: packageId, project_ref: pack.target_project_ref, actor_id: actor,
    batches: pack.batches.map((b) => ({ client_key: b.client_key, status: 'new' })) };
}

function compactResult(result: Json): Json {
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.run_id !== 'string') fail('The server result is uncertain. Resume with the same package.');
  const saved: Record<string, Json | undefined> = {};
  // Les snapshots volumineux restent dans le registre serveur, jamais dans le reçu navigateur.
  for (const key of ['run_id', 'kind', 'batch_reference', 'payload_hash', 'preview_hash', 'stock_mode',
    'stock_deferred', 'supplier_prepayment_count', 'stock_effect_count', 'idempotent_replay']) {
    if (result[key] !== undefined) saved[key] = result[key];
  }
  return saved;
}

export async function executeImport(options: {
  pack: ImportPackage; packageId: string; actor: string; storage: ReceiptStorage; transport: ImportTransport;
  onProgress: (receipt: ImportReceipt) => void;
}): Promise<ImportReceipt> {
  const { pack, packageId, actor, storage, transport, onProgress } = options;
  const key = receiptKey(pack.target_project_ref, actor, packageId);
  const saved = storage.getItem(key);
  const receipt = saved === null ? initialReceipt(pack, packageId, actor) : parseReceipt(saved, pack, packageId, actor);
  const persist = () => {
    // Refuser toute écriture métier si le reçu de reprise ne peut pas être conservé.
    storage.setItem(key, JSON.stringify(receipt));
    onProgress(structuredClone(receipt));
  };
  persist();
  for (const [i, batch] of pack.batches.entries()) {
    const entry = receipt.batches[i];
    if (!entry) fail('Recovery entry is missing.');
    if (entry.status === 'new') {
      const preview = await transport.preview(batch.payload);
      if (preview.valid !== true || typeof preview.preview_hash !== 'string' || !hash.test(preview.preview_hash)) {
        fail(`Batch ${i + 1} was blocked by server validation: ${JSON.stringify(preview.errors ?? [])}`);
      }
      entry.preview_hash = preview.preview_hash;
      entry.status = 'attempted';
      persist();
    }
    const previewHash = entry.preview_hash;
    if (!previewHash) fail('The original preview hash is missing.');
    try {
      // Après une réponse réseau perdue, rejouer EXACTEMENT le même hash et la même clé.
      entry.result = compactResult(await transport.apply(batch, previewHash));
    } catch (error) {
      if (error instanceof Error && error.message === 'historical_preview_stale') {
        entry.status = 'new';
        delete entry.preview_hash;
        persist();
      }
      throw error;
    }
    entry.status = 'applied';
    persist();
  }
  return receipt;
}
