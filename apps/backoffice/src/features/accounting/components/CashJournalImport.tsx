import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input } from '@breakery/ui';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import { parseCashImportFile, parseCashImportPreview, parseCashImportResult, type CashImportPreview } from './cashJournalImportContract.js';
const money = (value: number) => new Intl.NumberFormat('id-ID').format(value);

export function CashJournalImport() {
  const allowed = useAuthStore((s) => s.hasPermission('accounting.je.create_manual') && s.hasPermission('accounting.cash.write'));
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [payload, setPayload] = useState<Json | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [preview, setPreview] = useState<CashImportPreview | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const load = async (file?: File) => {
    const attempt = ++generation.current;
    setPayload(null); setPreview(null); setPin(''); setError(''); setMessage('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 1_000_000) throw new Error('The import file must be smaller than 1 MB.');
      const parsed = parseCashImportFile(await file.text());
      const result = await supabase.rpc('preview_cash_journal_import_v3', { p_payload: parsed.payload });
      if (result.error) throw new Error(result.error.message);
      const report = parseCashImportPreview(result.data);
      if (attempt === generation.current) { setPayload(parsed.payload); setSourceName(parsed.sourceName); setPreview(report); }
    } catch (cause) {
      if (attempt === generation.current) setError(cause instanceof Error ? cause.message : 'Could not preview the import.');
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  };

  const apply = async () => {
    if (!payload || !preview || busy || !/^\d{6}$/.test(pin) || preview.ready === 0) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await supabase.rpc('apply_cash_journal_import_v4', {
        p_payload: payload as Json, p_preview_hash: preview.preview_hash, p_manager_pin: pin,
      });
      if (result.error) throw new Error(result.error.message);
      const created = parseCashImportResult(result.data);
      setMessage(`${created} journal entries posted. Existing purchases and sales were preserved.`);
      setPreview(null); setPayload(null);
      await qc.invalidateQueries({ queryKey: ['accounting'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import result unknown. Preview the same file again before retrying.');
      // Une réponse perdue peut suivre un commit : seul un nouvel aperçu confirme les lignes restantes.
      setPreview(null);
    } finally { setPin(''); setBusy(false); }
  };

  if (!allowed) return null;
  return (
    <Card className="p-4 space-y-4">
      <Button variant="secondary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} disabled={busy}>
        Import reconciled cash journals
      </Button>
      {expanded && <>
        <p className="text-sm text-text-secondary">Upload a reviewed JSON package. Review every account and date before posting. Sales receipts must be reconciled, never imported twice.</p>
        <label className="block text-sm">Reconciled journal package
          <Input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {busy && <p role="status">Processing…</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        {message && <p role="status">{message}</p>}
        {preview && <>
          <p>{sourceName} · {preview.ready} ready · {preview.already_imported} already imported</p>
          <p>Balanced totals: IDR {money(preview.total_debit)} debit / IDR {money(preview.total_credit)} credit</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Import account impacts">
              <thead><tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Balance change</th></tr></thead>
              <tbody>{preview.account_impacts.map((a) => <tr key={a.account_code}>
                <td>{a.account_code} — {a.account_name}</td><td className="text-right tabular-nums">{money(a.debit)}</td>
                <td className="text-right tabular-nums">{money(a.credit)}</td><td className="text-right tabular-nums">{money(a.change)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="max-h-96 overflow-auto">
            {preview.rows.map((r) => <details key={r.source_key} className="border-b border-border-subtle py-2">
              <summary>{r.date} · {r.description} · {r.state}{r.total !== undefined ? ` · IDR ${money(r.total)}` : ''}</summary>
              <p className="text-xs text-text-muted">Source: {r.source_key}{r.corrects_je_id ? ` · Corrects journal: ${r.corrects_je_id}` : ''}</p>
              {r.lines?.map((l, i) => <p key={i} className="text-sm tabular-nums">{l.account_code} — {l.account_name}: debit {money(l.debit)}, credit {money(l.credit)}</p>)}
            </details>)}
          </div>
          {preview.ready > 0 && <>
            <label className="block text-sm">Your manager PIN
              <Input type="password" autoComplete="off" inputMode="numeric" value={pin} disabled={busy} maxLength={6} onChange={(e) => setPin(e.target.value)} />
            </label>
            <Button disabled={busy || !/^\d{6}$/.test(pin)} onClick={() => { void apply(); }}>Post {preview.ready} journal entries</Button>
          </>}
        </>}
      </>}
    </Card>
  );
}
