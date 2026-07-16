// apps/pos/src/features/settings/hooks/useBusinessIdentity.ts
//
// Settings §6.A — business identity for the receipt header (name / address /
// phone / NPWP), read straight off business_config (RLS auth_read), replacing
// the hardcoded BUSINESS block that used to live in SuccessModal. Degrades to
// the built-in defaults while loading / on error — a config read must never
// block an encaissement (pattern: useOrgDisplaySettings).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const QUERY_KEY = ['business-config', 'business-identity'] as const;

export interface BusinessIdentity {
  name: string;
  address: string;
  phone?: string | undefined;
  /** Bakery's own NPWP — the print bridge prints an NPWP line when present. */
  taxId?: string | undefined;
}

const DEFAULTS: BusinessIdentity = {
  name: 'The Breakery',
  address: '',
};

export function useBusinessIdentity(): BusinessIdentity & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_config')
        .select('name, fiscal_address, phone, npwp')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  return {
    name: data?.name ?? DEFAULTS.name,
    address: data?.fiscal_address ?? DEFAULTS.address,
    phone: data?.phone ?? undefined,
    taxId: data?.npwp ?? undefined,
    isLoading,
  };
}
