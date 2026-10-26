import { useEffect, useId, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import type { ExpenseReceiptSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
import { Button } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useExpenseReceipt } from '../hooks/useExpenseReceipt.js';
import { RECEIPT_ACCEPT, receiptFileDigest, validateReceiptFile } from '../utils/expenseReceiptFiles.js';

export interface ReceiptUploaderProps {
  expenseId: string;
  value: string | null;
  editable: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function ReceiptUploader({expenseId, value, editable, onBusyChange}: ReceiptUploaderProps): JSX.Element {
  const attempt = useExpenseReceipt(expenseId);
  const profile = useAuthStore(s => s.user?.id);
  const token = useAuthStore(s => s.sessionToken);
  const identity = JSON.stringify([expenseId, profile, token]);
  const observed = useRef(identity); observed.current = identity;
  const mounted = useRef(true);
  const [file, setFile] = useState<File>();
  const [hashing, setHashing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const errorId = useId();
  const blocked = hashing || attempt.busy || Boolean(attempt.pending) || Boolean(attempt.storageError);
  useEffect(() => {onBusyChange(blocked);}, [blocked, onBusyChange]);
  useEffect(() => {setFile(undefined); setHashing(false); setError(null); setMessage(null);}, [identity]);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const current = (session: ReturnType<typeof captureFinancialSession>) => mounted.current
    && observed.current === identity && session.current();

  async function change(payload: ExpenseReceiptSnapshot, selected?: File): Promise<void> {
    const session = captureFinancialSession();
    if (!current(session)) return;
    setError(null); setMessage(null);
    const outcome = await attempt.submit(payload, selected);
    if (!outcome.current || !current(session)) return;
    if ('error' in outcome) {
      setError(outcome.error instanceof Error ? outcome.error.message : 'The receipt change is unconfirmed. Check it again.');
    } else if (outcome.result) {
      setFile(undefined);
      if (!outcome.result.applied) setError(outcome.result.reason === 'receipt_requires_draft'
        ? 'This expense has already been submitted. The receipt was not changed.'
        : 'The receipt changed in another tab. Review the current expense before continuing.');
      else setMessage('Receipt change confirmed.');
    }
  }
  async function attach(selected: File): Promise<void> {
    const session = captureFinancialSession();
    if (!current(session) || !editable || blocked) return;
    setHashing(true); setError(null); setMessage(null); setFile(selected);
    try {
      validateReceiptFile(selected);
      const sha256 = await receiptFileDigest(selected);
      if (!current(session)) return;
      await change({expenseId, expectedPath: value === '' ? null : value, kind: 'attach',
        mime: selected.type, size: selected.size, sha256}, selected);
    } catch (e) {if (current(session)) setError((e as Error).message);}
    finally {if (current(session)) setHashing(false);}
  }
  const pending = attempt.pending?.payload;
  return <div className="space-y-2">
    {pending && <p role="status" className="text-sm text-text-secondary">The receipt change is unconfirmed. Check it before submitting or selecting another receipt.</p>}
    {((editable && !pending) || pending?.kind === 'attach') && <input type="file" aria-label={pending ? 'Select the same receipt file' : 'Receipt file'}
      accept={RECEIPT_ACCEPT} disabled={hashing || attempt.busy || !attempt.allowed || Boolean(attempt.storageError)}
      aria-invalid={Boolean(error ?? attempt.storageError)} aria-describedby={error ?? attempt.storageError ? errorId : undefined}
      className={'block w-full text-sm text-text-secondary ' + FOCUS_RING}
      onChange={e => {
        const selected = e.target.files?.[0]; e.target.value = '';
        if (!selected) return;
        if (pending) setFile(selected); else void attach(selected);
      }} />}
    {pending && <Button size="sm" disabled={attempt.busy || !attempt.allowed || Boolean(attempt.storageError)}
      onClick={() => {void change(pending, pending.kind === 'attach' ? file : undefined);}}>Check pending receipt</Button>}
    {editable && value && !pending && <Button size="sm" variant="ghost" disabled={blocked || !attempt.allowed}
      onClick={() => {void change({expenseId, kind: 'remove', expectedPath: value});}}>Remove receipt</Button>}
    {(hashing || attempt.busy) && <p role="status" className="text-sm text-text-secondary">Checking receipt…</p>}
    {(error ?? attempt.storageError) && <p role="alert" id={errorId} className="text-sm text-danger">{attempt.storageError ?? error}</p>}
    {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
  </div>;
}
