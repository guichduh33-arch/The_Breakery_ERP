import { useEffect, useId, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import type { PoInvoiceSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
import { Button } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { INVOICE_ACCEPT, invoiceFileDigest, validateInvoiceFile } from '@/lib/invoiceFiles.js';
import { usePoInvoice } from '../hooks/usePoInvoice.js';

export function PoInvoiceUploader({ poId, value, editable, removable, onBusyChange }: {
  poId: string; value: string | null; editable: boolean; removable: boolean; onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const attempt = usePoInvoice(poId);
  const profile = useAuthStore(s => s.user?.id);
  const token = useAuthStore(s => s.sessionToken);
  const identity = JSON.stringify([poId, profile, token]);
  const observed = useRef(identity); observed.current = identity;
  const mounted = useRef(true);
  const [file, setFile] = useState<File>();
  const [hashing, setHashing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const errorId = useId();
  const blocked = hashing || attempt.busy || Boolean(attempt.pending) || Boolean(attempt.storageError);
  useEffect(() => { onBusyChange(blocked); }, [blocked, onBusyChange]);
  useEffect(() => { setFile(undefined); setHashing(false); setError(null); setMessage(null); }, [identity]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = (session: ReturnType<typeof captureFinancialSession>) => mounted.current
    && observed.current === identity && session.current();
  async function change(payload: PoInvoiceSnapshot, selected?: File): Promise<void> {
    const session = captureFinancialSession();
    if (!current(session)) return;
    setError(null); setMessage(null);
    const outcome = await attempt.submit(payload, selected);
    if (!outcome.current || !current(session)) return;
    if ('error' in outcome) setError(outcome.error instanceof Error ? outcome.error.message : 'The invoice change is unconfirmed. Check it again.');
    else if (outcome.result) {
      setFile(undefined);
      if (!outcome.result.applied) setError(outcome.result.reason === 'invoice_requires_unpaid_order'
        ? 'This purchase order no longer allows this invoice change. Review its current payments.'
        : 'The invoice changed in another tab. Review the current purchase order before continuing.');
      else setMessage('Invoice change confirmed.');
    }
  }
  async function attach(selected: File): Promise<void> {
    const session = captureFinancialSession();
    if (!current(session) || !editable || blocked) return;
    setHashing(true); setError(null); setMessage(null); setFile(selected);
    try {
      validateInvoiceFile(selected);
      const sha256 = await invoiceFileDigest(selected);
      if (!current(session)) return;
      await change({ poId, expectedPath: value, kind: 'attach', mime: selected.type, size: selected.size, sha256 }, selected);
    } catch (e) { if (current(session)) setError((e as Error).message); }
    finally { if (current(session)) setHashing(false); }
  }
  const pending = attempt.pending?.payload;
  return <div className="space-y-2">
    {pending && <p role="status" className="text-sm text-text-secondary">The invoice change is unconfirmed. Check it before recording payment or selecting another invoice.</p>}
    {((editable && !pending) || pending?.kind === 'attach') && <input type="file" aria-label={pending ? 'Select the same invoice file' : 'Invoice file'}
      accept={INVOICE_ACCEPT} disabled={hashing || attempt.busy || !attempt.allowed || Boolean(attempt.storageError)}
      aria-invalid={Boolean(error ?? attempt.storageError)} aria-describedby={error ?? attempt.storageError ? errorId : undefined}
      className={'block w-full text-sm text-text-secondary ' + FOCUS_RING}
      onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) { if (pending) setFile(selected); else void attach(selected); } }} />}
    {pending && <Button size="sm" disabled={attempt.busy || !attempt.allowed || Boolean(attempt.storageError)}
      onClick={() => { void change(pending, pending.kind === 'attach' ? file : undefined); }}>Check pending invoice</Button>}
    {removable && value && !pending && <Button size="sm" variant="ghost" disabled={blocked || !attempt.allowed}
      onClick={() => { void change({ poId, kind: 'remove', expectedPath: value }); }}>Remove invoice</Button>}
    {(hashing || attempt.busy) && <p role="status" className="text-sm text-text-secondary">Checking invoice…</p>}
    {(error ?? attempt.storageError) && <p role="alert" id={errorId} className="text-sm text-danger">{attempt.storageError ?? error}</p>}
    {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
  </div>;
}
