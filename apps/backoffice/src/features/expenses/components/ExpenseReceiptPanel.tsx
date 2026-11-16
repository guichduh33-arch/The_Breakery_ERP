import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import { supabase } from '@/lib/supabase.js';
import { Card, Button } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import type { ExpenseRow } from '../hooks/useExpensesList.js';
import { ReceiptUploader } from './ReceiptUploader.js';
import { INVOICE_APPROVAL_MESSAGE, INVOICE_PAYMENT_MESSAGE } from '@/lib/invoiceFiles.js';

// L'EF renvoie `application/octet-stream` : le type d'affichage se déduit de
// l'extension, bornée par la policy d'insert du bucket (jpg/jpeg/pdf ; png/webp
// restent lisibles pour les reçus déposés avant ADR-037).
// Aucun type actif (SVG, HTML) ne peut donc sortir d'ici.
const PREVIEW_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
};

export function receiptPreviewType(path: string): string | null {
  const extension = /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase();
  return extension ? PREVIEW_TYPES[extension] ?? null : null;
}

interface Preview { url: string; type: string; path: string }

export function ExpenseReceiptPanel({expense, onBusyChange}: {
  expense: ExpenseRow; onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const profile = useAuthStore(s => s.user?.id);
  const token = useAuthStore(s => s.sessionToken);
  const permitted = useAuthStore(s => s.hasPermission);
  const canRegularize = ['submitted', 'approved'].includes(expense.status);
  const canEdit = (expense.status === 'draft' || canRegularize) && (permitted('expenses.manage')
    || (profile === expense.created_by && permitted('expenses.create'))
    || (canRegularize && permitted('expenses.pay')));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const identity = JSON.stringify([expense.id, expense.receipt_url, profile, token]);
  const observed = useRef(identity); observed.current = identity;
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);

  // Le justificatif s'affiche dès l'ouverture, sans téléchargement. Un changement
  // de dépense, de fichier ou de session jette l'aperçu et libère son URL blob.
  useEffect(() => {
    setBusy(false); setError(null); setPreview(null);
    const path = expense.receipt_url;
    if (!path) return;
    const type = receiptPreviewType(path);
    if (!type) return;
    let url: string | null = null;
    let live = true;
    void (async () => {
      const session = captureFinancialSession();
      const current = () => live && mounted.current && observed.current === identity && session.current();
      setBusy(true);
      try {
        const blob = await fetchReceipt(expense.id, token);
        if (!current()) return;
        const state = useAuthStore.getState();
        if (!(state.hasPermission('expenses.read') || state.hasPermission('expenses.manage')
          || state.user?.id === expense.created_by)) return;
        url = URL.createObjectURL(new Blob([blob], { type }));
        setPreview({ url, type, path });
      } catch (e) {if (current()) setError((e as Error).message);}
      finally {if (current()) setBusy(false);}
    })();
    return () => {live = false; if (url) URL.revokeObjectURL(url);};
  // identity couvre expense.id, receipt_url, profil et jeton.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  function download(): void {
    if (!preview) return;
    const link = document.createElement('a'); link.href = preview.url;
    link.download = preview.path.split('/').pop() ?? 'receipt';
    document.body.appendChild(link); link.click(); link.remove();
  }

  return <Card variant="default" padding="md" className="space-y-3">
    <SectionLabel as="h2" size="sm" className="text-gold">Receipt</SectionLabel>
    {expense.receipt_url ? <>
      {busy && !preview && <p className="text-sm text-text-secondary">Loading receipt…</p>}
      {preview && (preview.type === 'application/pdf'
        ? <iframe src={preview.url} title="Receipt preview"
            className="h-[480px] w-full rounded-md border border-border-subtle bg-bg-overlay" />
        : <img src={preview.url} alt="Receipt"
            className="max-h-[480px] w-full rounded-md border border-border-subtle bg-bg-overlay object-contain" />)}
      {preview && <Button size="sm" variant="ghost" onClick={download}>Download receipt</Button>}
    </> : <p className="text-sm text-text-secondary">No receipt attached.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <p className="text-sm text-text-secondary">{expense.invoice_exempt
      ? 'Historical import: invoice requirement does not apply.'
      : expense.payment_method === 'cash' ? INVOICE_APPROVAL_MESSAGE : INVOICE_PAYMENT_MESSAGE} JPEG or PDF, max 5 MB.</p>
    {canRegularize && canEdit && <p className="text-sm text-text-secondary">Only missing or invalid receipts can be replaced after submission. The server checks the existing file before applying a change.</p>}
    <ReceiptUploader expenseId={expense.id} value={expense.receipt_url} editable={canEdit}
      removable={canEdit && expense.status === 'draft'} onBusyChange={onBusyChange} />
  </Card>;
}

async function fetchReceipt(expenseId: string, token: string | null): Promise<Blob> {
  const response = await supabase.functions.invoke<Blob>('download-expense-receipt', {
    body: { expense_id: expenseId }, headers: { 'x-session-token': token ?? '' },
  });
  if (response.error) throw response.error;
  if (!(response.data instanceof Blob)) throw new Error('The receipt could not be loaded.');
  return response.data;
}
