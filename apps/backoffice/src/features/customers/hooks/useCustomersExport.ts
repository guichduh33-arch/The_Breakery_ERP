// apps/backoffice/src/features/customers/hooks/useCustomersExport.ts
// One-shot fetch of all customers shaped to the import template column keys.
//
// ADR-020 déc. 6 — l'export de masse passe par export_customers_v1 (SECURITY
// DEFINER, gate customers.read) : le serveur écrit une ligne audit_logs par
// export. Le SELECT direct historique ne laissait aucune trace possible.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

interface ExportRow {
  name: string;
  phone: string | null;
  email: string | null;
  customer_type: string;
  category: string | null;
  birth_date: string | null;
  marketing_consent: boolean;
  b2b_company_name: string | null;
  b2b_tax_id: string | null;
  b2b_payment_terms_days: number | null;
  b2b_credit_limit: number | null;
}

export function useCustomersExport() {
  return useMutation<Record<string, unknown>[], Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('export_customers_v1');
      if (error !== null) throw new Error(error.message);
      // Garde de forme (la réponse RPC est du Json non vérifié) : un tableau,
      // rien d'autre — une forme inattendue doit échouer, jamais exporter vide.
      if (!Array.isArray(data)) throw new Error('export_unexpected_shape');
      return (data as ExportRow[]).map((r) => ({
        name: r.name,
        phone: r.phone,
        email: r.email,
        customer_type: r.customer_type,
        category: r.category,
        birth_date: r.birth_date,
        marketing_consent: r.marketing_consent,
        b2b_company_name: r.b2b_company_name,
        b2b_tax_id: r.b2b_tax_id,
        b2b_payment_terms_days: r.b2b_payment_terms_days,
        b2b_credit_limit: r.b2b_credit_limit,
      }));
    },
  });
}
