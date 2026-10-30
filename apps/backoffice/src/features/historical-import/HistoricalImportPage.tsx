import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Json } from '@breakery/supabase';
import { Input } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { RestrictedState } from '@/components/RestrictedState.js';
import { supabase, supabaseUrl } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import { executeImport, importPermissions, packageHash, parseImportPackage, parseReceipt, receiptKey } from './importPackage.js';
import type { ImportPackage, ImportReceipt, Preview } from './importPackage.js';
import { HistoricalReferencePanel } from './HistoricalReferencePanel.js';

const projectRef = new URL(supabaseUrl).hostname.split('.')[0] ?? '';
const message = (error: unknown) => error instanceof Error ? error.message : 'The import could not be completed.';
function downloadReceipt(receipt: ImportReceipt) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'historical-financial-recovery.json'; a.click();
  URL.revokeObjectURL(url);
}
function previewValue(data: Json): Preview {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid server preview.');
  if (data.valid === true && (data.stock_mode !== 'financial_only' || data.stock_deferred !== true
    || !Array.isArray(data.stock_effects) || data.stock_effects.length !== 0)) throw new Error('This preview does not defer all stock effects. No import was sent.');
  const preview: Preview = { valid: data.valid === true };
  if (typeof data.preview_hash === 'string') preview.preview_hash = data.preview_hash;
  if (data.errors !== undefined) preview.errors = data.errors;
  return preview;
}

export default function HistoricalImportPage() {
  const user = useAuthStore((s) => s.user);
  const allowed = useAuthStore((s) => s.isAuthenticated && s.user?.role_code === 'SUPER_ADMIN'
    && s.hasPermission('accounting.je.create_manual'));
  const [pack, setPack] = useState<ImportPackage | null>(null);
  const [id, setId] = useState('');
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const actor = user?.id ?? '';
  if (!allowed) return <RestrictedState what="historical financial import" role={['SUPER_ADMIN']} />;

  async function loadPackage(file: File | undefined) {
    if (!file || running.current) return;
    running.current = true;
    setError(''); setPack(null); setReceipt(null); setConfirmed(false); setBusy(true);
    try {
      if (file.size > 20_000_000) throw new Error('The package exceeds 20 MB.');
      const parsed = parseImportPackage(await file.text(), projectRef);
      if (!importPermissions(parsed).every((p) => useAuthStore.getState().hasPermission(p))) throw new Error('A required import permission is missing.');
      const hash = await packageHash(parsed);
      const saved = localStorage.getItem(receiptKey(projectRef, actor, hash));
      setReceipt(saved === null ? null : parseReceipt(saved, parsed, hash, actor));
      setPack(parsed); setId(hash);
    } catch (e) { setError(message(e)); }
    finally { running.current = false; setBusy(false); }
  }
  async function loadRecovery(file: File | undefined) {
    if (!file || !pack || running.current) return;
    running.current = true;
    setError(''); setBusy(true);
    try {
      if (file.size > 5_000_000) throw new Error('The recovery receipt exceeds 5 MB.');
      const recovered = parseReceipt(await file.text(), pack, id, actor);
      const key = receiptKey(projectRef, actor, id);
      const existing = localStorage.getItem(key);
      if (existing !== null) {
        const current = parseReceipt(existing, pack, id, actor);
        if (current.batches.some((b, i) => b.status !== 'new' && JSON.stringify(b) !== JSON.stringify(recovered.batches[i]))) {
          throw new Error('This browser has a newer or different receipt. Keep its recovery state.');
        }
      }
      localStorage.setItem(key, JSON.stringify(recovered)); setReceipt(recovered);
    } catch (e) { setError(message(e)); }
    finally { running.current = false; setBusy(false); }
  }
  async function run() {
    if (!pack || !confirmed || running.current || !allowed || !actor) return;
    running.current = true; setBusy(true); setError('');
    const sessionToken = useAuthStore.getState().sessionToken;
    const assertOperator = () => {
      const current = useAuthStore.getState();
      if (!mounted.current || !current.isAuthenticated || current.user?.id !== actor
        || !sessionToken || current.sessionToken !== sessionToken || current.user.role_code !== 'SUPER_ADMIN'
        || !importPermissions(pack).every((permission) => current.hasPermission(permission))) {
        throw new Error('The operator session changed. Sign in again and resume with the same package and recovery receipt.');
      }
    };
    try {
      await executeImport({ pack, packageId: id, actor, storage: localStorage, onProgress: (value) => { if (mounted.current) setReceipt(value); },
        transport: {
          preview: async (payload) => {
            assertOperator();
            const { data, error: rpcError } = await supabase.rpc('preview_historical_import_v4', { p_payload: payload });
            assertOperator();
            if (rpcError) throw new Error(rpcError.message);
            return previewValue(data);
          },
          apply: async (batch, previewHash) => {
            assertOperator();
            const { data, error: rpcError } = await supabase.rpc('apply_historical_import_v4', {
              p_payload: batch.payload, p_preview_hash: previewHash, p_client_key: batch.client_key,
            });
            if (rpcError) throw new Error(rpcError.message);
            if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.run_id !== 'string'
              || data.stock_mode !== 'financial_only' || data.stock_effect_count !== 0) {
              throw new Error('The server result is uncertain. Resume with the same package and recovery receipt.');
            }
            return data;
          },
        },
      });
    } catch (e) { if (mounted.current) setError(message(e)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const count = pack?.batches.reduce((n, b) => n + (Array.isArray(b.payload.documents) ? b.payload.documents.length : 0), 0) ?? 0;
  const completed = receipt?.batches.filter((b) => b.status === 'applied').length ?? 0;
  return <div className="space-y-6">
    <Link to="/backoffice/accounting" className="text-sm text-text-secondary underline">Back to accounting</Link>
    <PageHeader title="Historical financial import" subtitle="Import reconciled sales and purchases. Stock and production remain deferred until the opening stock count." />
    <HistoricalReferencePanel />
    <Card><CardHeader><CardTitle>Prepared financial package</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-text-secondary">Upload the prepared JSON package after reconciling the source workbook. Keep the same package and recovery receipt until every batch is complete.</p>
      <p className="font-data text-sm text-text-primary">Connected database: {projectRef}</p>
      <label className="block space-y-1 text-sm"><span>Financial package (.json)</span>
        <Input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { void loadPackage(e.target.files?.[0]); }} />
      </label>
      {pack && <>
        <p className="text-sm text-text-primary">{count} documents in {pack.batches.length} batches. Each batch is validated again immediately before it is imported. Completed batches remain applied if a later batch stops.</p>
        <label className="block space-y-1 text-sm"><span>Restore a recovery receipt (.json, optional)</span>
          <Input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { void loadRecovery(e.target.files?.[0]); }} />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input className={FOCUS_RING} type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I have reviewed this package and authorize its transactions, payments and accounting entries in the connected database. Current stock and display stock will not change.</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy || !confirmed} onClick={() => { void run(); }}>{busy ? 'Importing…' : completed === pack.batches.length ? 'Verify completed import' : completed > 0 ? 'Resume import' : 'Validate and import'}</Button>
          <Button variant="secondary" disabled={!receipt || busy} onClick={() => { if (receipt) downloadReceipt(receipt); }}>Download recovery receipt</Button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-text-secondary">{completed} of {pack.batches.length} batches recorded as completed. Resume verifies saved results with the server.</p>
      </>}
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-danger">{error}</p>}
    </CardContent></Card>
  </div>;
}
