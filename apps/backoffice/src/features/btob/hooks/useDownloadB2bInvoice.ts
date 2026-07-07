// apps/backoffice/src/features/btob/hooks/useDownloadB2bInvoice.ts
// S68 — Fetch invoice data (get_b2b_invoice_v1) then render via generate-pdf and open it.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { useGeneratePdf } from '@/features/reports/hooks/useGeneratePdf.js';

export function useDownloadB2bInvoice() {
  const pdf = useGeneratePdf();
  const mut = useMutation<void, Error, { orderId: string; invoiceNumber: string | null; orderNumber: string }>({
    mutationFn: async ({ orderId, invoiceNumber, orderNumber }) => {
      const { data, error } = await supabase.rpc('get_b2b_invoice_v1', { p_order_id: orderId });
      if (error) throw new Error(error.message);
      if (data === null) throw new Error('invoice_not_found');
      const safe = (invoiceNumber ?? orderNumber).replace(/[^A-Za-z0-9._-]/g, '-');
      const res = await pdf.mutateAsync({ template: 'b2b_invoice', data: data as object, filename: `invoice-${safe}` });
      if (typeof window !== 'undefined') window.open(res.signed_url, '_blank', 'noopener');
    },
  });
  return { download: mut.mutate, isPending: mut.isPending };
}
