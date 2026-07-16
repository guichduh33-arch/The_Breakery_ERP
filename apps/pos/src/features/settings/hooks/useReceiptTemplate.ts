// apps/pos/src/features/settings/hooks/useReceiptTemplate.ts
//
// Settings §6.A — the default receipt template (receipt_templates.is_default),
// read via PostgREST (RLS: SELECT authenticated). Header/footer/QR flow into
// the print payload; the print bridge falls back to its built-in rendering
// when the template is absent. Degrades to null while loading / on error —
// a config read must never block an encaissement (pattern: useBusinessIdentity).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const QUERY_KEY = ['receipt-template', 'default'] as const;

export interface ReceiptTemplate {
  header: string | null;
  footer: string | null;
  show_qr: boolean;
  show_logo: boolean;
  paper_size: string;
}

export function useReceiptTemplate(): { template: ReceiptTemplate | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('receipt_templates')
        .select('header, footer, show_qr, show_logo, paper_size')
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  return { template: data ?? null, isLoading };
}
