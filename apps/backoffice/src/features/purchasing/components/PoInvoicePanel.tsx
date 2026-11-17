import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import { supabase } from '@/lib/supabase.js';
import { Card, Button } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { INVOICE_PAYMENT_MESSAGE, invoicePreviewType } from '@/lib/invoiceFiles.js';
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
  const [preview, setPreview] = useState<{ url: string; type: string; path: string } | null>(null);
  const identity = JSON.stringify([po.id, po.invoice_path, profile, token]);
  const observed = useRef(identity); observed.current = identity;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // La facture s'affiche dès l'ouverture, sans téléchargement. Un changement de
  // commande, de fichier ou de session jette l'aperçu et libère son URL blob.
  useEffect(() => {
    setBusy(false); setError(null); setPreview(null);
    const path = po.invoice_path;
    if (!path) return;
    const type = invoicePreviewType(path);
    if (!type) return;
    let url: string | null = null;
    let live = true;
    void (async () => {
      // La capture de session reste dans le try : une erreur n'y devient jamais un rejet non géré.
      let session: ReturnType<typeof captureFinancialSession> | null = null;
      const current = () => live && mounted.current && observed.current === identity && session?.current() === true;
      try {
        session = captureFinancialSession();
        setBusy(true);
        const response = await supabase.functions.invoke<Blob>('download-po-invoice', {
          body: { po_id: po.id }, headers: { 'x-session-token': token ?? '' },
        });
        if (!current() || !useAuthStore.getState().hasPermission('purchasing.po.read')) return;
        if (response.error) throw response.error;
        if (!(response.data instanceof Blob)) throw new Error('The invoice could not be loaded.');
        url = URL.createObjectURL(new Blob([response.data], { type }));
        setPreview({ url, type, path });
      } catch (e) { if (current()) setError((e as Error).message); }
      finally { if (current()) setBusy(false); }
    })();
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  // identity couvre po.id, invoice_path, profil et jeton.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  function download(): void {
    if (!preview) return;
    const link = document.createElement('a'); link.href = preview.url;
    link.download = preview.path.split('/').pop() ?? 'invoice';
    document.body.appendChild(link); link.click(); link.remove();
  }
  return <Card variant="default" padding="md" className="space-y-3">
    <SectionLabel as="h2" size="sm" className="text-gold">Supplier invoice</SectionLabel>
    {po.invoice_path ? <>
      {busy && !preview && <p className="text-sm text-text-secondary">Loading invoice…</p>}
      {preview && (preview.type === 'application/pdf'
        ? <iframe src={preview.url} title="Invoice preview"
            className="h-[480px] w-full rounded-md border border-border-subtle bg-bg-overlay" />
        : <img src={preview.url} alt="Supplier invoice"
            className="max-h-[480px] w-full rounded-md border border-border-subtle bg-bg-overlay object-contain" />)}
      {preview && <Button size="sm" variant="ghost" onClick={download}>Download invoice</Button>}
    </> : <p className="text-sm text-text-secondary">No invoice attached.</p>}
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
