import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import type { PoInvoiceSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession, useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { invoiceFileDigest } from '@/lib/invoiceFiles.js';
import { PURCHASE_ORDER_DETAIL_QUERY_KEY } from './usePurchaseOrderDetail.js';

export interface PoInvoiceResult {
  po_id: string; invoice_path: string | null; applied: boolean; idempotent_replay: boolean;
  reason?: 'invoice_requires_unpaid_order' | 'invoice_changed';
}

export function usePoInvoice(poId: string) {
  const attempt = useFinancialAttempt('po_invoice', poId, true);
  const qc = useQueryClient();
  async function submit(payload: PoInvoiceSnapshot, file?: File) {
    return attempt.submit(payload, async (snapshot, key, current): Promise<PoInvoiceResult> => {
      const session = captureFinancialSession();
      const assertSession = () => {
        if (!current() || !session.current()) throw new FinancialAttemptError('Your session changed. Reopen this purchase order.');
      };
      assertSession();
      if (file && snapshot.kind === 'attach') {
        const digest = await invoiceFileDigest(file); assertSession();
        if (digest !== snapshot.sha256 || file.type !== snapshot.mime || file.size !== snapshot.size) {
          throw new FinancialAttemptError('Select the same invoice file to check this pending upload.');
        }
      }
      const path = snapshot.kind === 'attach'
        ? 'purchase-orders/' + snapshot.poId + '/' + key + (snapshot.mime === 'image/jpeg' ? '.jpg' : '.pdf') : null;
      const apply = () => supabase.rpc('set_po_invoice_v1' as never, {
        p_po_id: snapshot.poId, p_idempotency_key: key,
        ...(path !== null ? { p_storage_path: path } : {}),
        ...(snapshot.expectedPath !== null ? { p_expected_path: snapshot.expectedPath } : {}),
      } as never);
      let response = await apply(); assertSession();
      if (snapshot.kind === 'attach' && response.error?.code === 'P0002' && response.error.message === 'invoice_object_not_found') {
        if (!file) throw new FinancialAttemptError('Select the same invoice file to retry the upload. The purchase order is retained.');
        const uploaded = await supabase.storage.from('purchase-invoices').upload(path!, file, { upsert: false, contentType: snapshot.mime });
        assertSession();
        response = await apply(); assertSession();
        if (uploaded.error && response.error) throw new FinancialAttemptError(uploaded.error.message);
      }
      if (response.error) throw new FinancialAttemptError(response.error.message,
        ['22023', '42501', '28000', '23514'].includes(response.error.code));
      const result: unknown = response.data;
      if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new FinancialAttemptError('The invoice change is unconfirmed. Check it again.');
      const r = result as Record<string, unknown>;
      if (r.po_id !== poId || typeof r.applied !== 'boolean' || typeof r.idempotent_replay !== 'boolean'
        || (r.applied === true && r.invoice_path !== path)
        || (r.applied === false && !['invoice_requires_unpaid_order', 'invoice_changed'].includes(String(r.reason)))) {
        throw new FinancialAttemptError('The invoice change is unconfirmed. Check it again.');
      }
      assertSession();
      await qc.invalidateQueries({ queryKey: [...PURCHASE_ORDER_DETAIL_QUERY_KEY, poId] });
      assertSession();
      return result as PoInvoiceResult;
    });
  }
  return { ...attempt, submit };
}
