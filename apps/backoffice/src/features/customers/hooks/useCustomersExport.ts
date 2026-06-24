// apps/backoffice/src/features/customers/hooks/useCustomersExport.ts
// One-shot fetch of all customers shaped to the import template column keys.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

const SELECT = `
  name, phone, email, customer_type, birth_date, marketing_consent,
  b2b_company_name, b2b_tax_id, b2b_payment_terms_days, b2b_credit_limit,
  customer_categories!left(name)
`.replace(/\s+/g, ' ').trim();

interface RawRow {
  name: string;
  phone: string | null;
  email: string | null;
  customer_type: string;
  birth_date: string | null;
  marketing_consent: boolean;
  b2b_company_name: string | null;
  b2b_tax_id: string | null;
  b2b_payment_terms_days: number | null;
  b2b_credit_limit: number | null;
  customer_categories: { name: string } | { name: string }[] | null;
}

function catName(raw: RawRow['customer_categories']): string | null {
  if (raw === null) return null;
  if (Array.isArray(raw)) return raw[0]?.name ?? null;
  return raw.name;
}

export function useCustomersExport() {
  return useMutation<Record<string, unknown>[], Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select(SELECT)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error !== null) throw new Error(error.message);
      return ((data ?? []) as unknown as RawRow[]).map((r) => ({
        name: r.name,
        phone: r.phone,
        email: r.email,
        customer_type: r.customer_type,
        category: catName(r.customer_categories),
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
