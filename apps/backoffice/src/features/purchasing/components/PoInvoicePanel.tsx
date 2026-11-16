import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import { supabase } from '@/lib/supabase.js';
import { Card, Button } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { INVOICE_PAYMENT_MESSAGE } from '@/lib/invoiceFiles.js';
import type { PurchaseOrderDetail } from '../hooks/usePurchaseOrderDetail.js';
import { PoInvoiceUploader } from './PoInvoiceUploader.js';
import { PO_INVOICE_UPLOAD_KEY } from '../hooks/usePoInvoice.js';

export function PoInvoicePanel({ po, hasPayments, fullyPaid, paymentsKnown, onBusyChange }: {
  po: PurchaseOrderDetail; hasPayments: boolean; fullyPaid: boolean; paymentsKnown: boolean; onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const profile = useAuthStore(s => s.user?.id);
  const token = useAuthStore(s => s.sessionToken);
  const canManage = useAuthStore(s => s.hasPermission('purchasing.po.create') || s.hasPermission('purchasing.po.pay'));
  const accessInstance = useId();
  const accessSession = useRef({ profile, token, revision: 0 });
  if (accessSession.current.profile !== profile || accessSession.current.token !== token) {
    accessSession.current = { profile, token, revision: accessSession.current.revision + 1 };
  }
  // Aucun jeton dans le cache ; chaque montage et changement de session est isolé.
  const uploadAccess = useQuery({
    queryKey: [...PO_INVOICE_UPLOAD_KEY, accessInstance, accessSession.current.revision, profile,
      po.id, po.invoice_path, po.updated_at, po.status, hasPayments, fullyPaid],
    enabled: paymentsKnown && canManage && Boolean(profile && token),
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const session = captureFinancialSession();
      const allowed = () => session.current() && (useAuthStore.getState().hasPermission('purchasing.po.create')
        || useAuthStore.getState().hasPermission('purchasing.po.pay'));
      if (!allowed()) throw new Error('Your session or permissions changed. Reopen this purchase order.');
      const { data, error: accessError } = await supabase.rpc('can_upload_po_invoice_v2', { p_po_id: po.id });
      if (!allowed()) throw new Error('Your session or permissions changed. Reopen this purchase order.');
      if (accessError || typeof data !== 'boolean') throw new Error('Invoice upload availability could not be checked.');
      return data;
    },
  });
  // Le serveur vérifie l'objet réel et verrouille les pièces valides, même après paiement.
  const canEdit = canManage && paymentsKnown && uploadAccess.isSuccess && !uploadAccess.isFetching && uploadAccess.data === true;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = JSON.stringify([po.id, po.invoice_path, profile, token]);
  const observed = useRef(identity); observed.current = identity;
  const mounted = useRef(true);
  useEffect(() => { setBusy(false); setError(null); }, [identity]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function download(): Promise<void> {
    const session = captureFinancialSession();
    const current = () => mounted.current && observed.current === identity && session.current();
    if (!current() || !po.invoice_path) return;
    setBusy(true); setError(null);
    try {
      const response = await supabase.functions.invoke<Blob>('download-po-invoice', {
        body: { po_id: po.id }, headers: { 'x-session-token': token ?? '' },
      });
      if (!current() || !useAuthStore.getState().hasPermission('purchasing.po.read')) return;
      if (response.error) throw response.error;
      if (!(response.data instanceof Blob)) throw new Error('The invoice could not be downloaded.');
      const url = URL.createObjectURL(response.data);
      try {
        const link = document.createElement('a'); link.href = url; link.download = po.invoice_path.split('/').pop() ?? 'invoice';
        document.body.appendChild(link); link.click(); link.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch (e) { if (current()) setError((e as Error).message); }
    finally { if (current()) setBusy(false); }
  }
  return <Card variant="default" padding="md" className="space-y-3">
    <SectionLabel as="h2" size="sm" className="text-gold">Supplier invoice</SectionLabel>
    {po.invoice_path ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void download(); }}>Download invoice</Button>
      : <p className="text-sm text-text-secondary">No invoice attached.</p>}
    <p className="text-sm text-text-secondary">{po.invoice_exempt ? 'Historical import: invoice requirement does not apply.' : INVOICE_PAYMENT_MESSAGE} JPEG or PDF, max 5 MB.</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {canManage && paymentsKnown && uploadAccess.isFetching && <p role="status" className="text-sm text-text-secondary">Checking invoice upload availability…</p>}
    {canManage && paymentsKnown && uploadAccess.isError && <div role="alert" className="space-y-2 text-sm text-danger">
      <p>Invoice upload availability could not be checked.</p>
      <Button size="sm" variant="ghost" disabled={uploadAccess.isFetching} onClick={() => { void uploadAccess.refetch(); }}>Check invoice upload availability</Button>
    </div>}
    <PoInvoiceUploader poId={po.id} value={po.invoice_path ?? null} editable={canEdit} removable={canEdit && !hasPayments} onBusyChange={onBusyChange} />
  </Card>;
}
