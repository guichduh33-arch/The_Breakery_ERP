import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { InvoicePrintTemplate, InvoiceTemplateSettings } from '../invoiceTemplate.js';

const KEY = ['invoice-print-template'] as const;

export function useInvoicePrintTemplate(enabled: boolean) {
  const profileId = useAuthStore((state) => state.user?.id);
  const client = useQueryClient();
  const key = [...KEY, profileId];
  const query = useQuery<InvoicePrintTemplate>({
    queryKey: key, enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_invoice_print_template_v1').single<InvoicePrintTemplate>();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Invoice template not found');
      return data;
    },
  });
  const save = useMutation<InvoicePrintTemplate, Error, { settings: InvoiceTemplateSettings; revision: number }>({
    mutationFn: async ({ settings, revision }) => {
      const { data, error } = await supabase.rpc('update_invoice_print_template_v1', {
        p_settings: settings, p_expected_revision: revision,
      }).single<InvoicePrintTemplate>();
      if (error) throw new Error(error.code === '40001'
        ? 'This template changed. Reload the saved template before trying again.' : 'Could not save the invoice template. Please try again.');
      if (!data) throw new Error('The saved template could not be confirmed. Reload before trying again.');
      return data;
    },
    onSuccess: (data) => { client.setQueryData(key, data); },
  });
  return { query, save };
}
