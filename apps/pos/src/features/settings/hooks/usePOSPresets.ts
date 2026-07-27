// apps/pos/src/features/settings/hooks/usePOSPresets.ts
//
// Session 14 / Phase 2.D — Reviewer follow-up #18.
//
// READ: direct business_config select (RLS auth_read) — NOT the
// get_settings_by_category_v9 RPC, whose settings.read gate rejects
// CASHIER/waiter (42501 → 403) and silently forced the hardcoded fallbacks
// for the exact audience the presets are configured for. Same pattern as
// useEnabledPaymentMethods.
// WRITE: still set_setting_v11 (POSSettingsPage is manager-gated).
//
// Read shape :
//   { quickPayments: number[]; openingCashPresets: number[];
//     discountPresets: { value: number; name: string }[]; }
//
// On error or null payload, the hook degrades to the same hardcoded
// defaults shipped in the migration so dependent surfaces (PaymentTerminal,
// OpenShiftModal) never see an empty preset list.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

export interface DiscountPreset {
  value: number;
  name: string;
}

export interface POSPresets {
  quickPayments: number[];
  openingCashPresets: number[];
  discountPresets: DiscountPreset[];
}

export const FALLBACK_PRESETS: POSPresets = {
  quickPayments: [50_000, 100_000, 150_000, 200_000, 500_000],
  openingCashPresets: [100_000, 200_000, 300_000, 500_000, 1_000_000],
  discountPresets: [
    { value: 5, name: '5%' },
    { value: 10, name: '10%' },
    { value: 15, name: '15%' },
    { value: 20, name: '20%' },
    { value: 25, name: '25%' },
    { value: 50, name: 'Staff Meal' },
  ],
};

const QUERY_KEY = ['pos-presets'] as const;

function coerceNumberArray(input: unknown, fallback: number[]): number[] {
  if (!Array.isArray(input)) return fallback;
  const out: number[] = [];
  for (const v of input) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out.push(v);
  }
  return out.length > 0 ? out : fallback;
}

function coerceDiscountArray(input: unknown, fallback: DiscountPreset[]): DiscountPreset[] {
  if (!Array.isArray(input)) return fallback;
  const out: DiscountPreset[] = [];
  for (const v of input) {
    if (
      v &&
      typeof v === 'object' &&
      'value' in v &&
      'name' in v &&
      typeof (v as { value: unknown }).value === 'number' &&
      typeof (v as { name: unknown }).name === 'string' &&
      ((v as { name: string }).name).length > 0
    ) {
      out.push({
        value: (v as { value: number }).value,
        name: (v as { name: string }).name,
      });
    }
  }
  return out.length > 0 ? out : fallback;
}

export function usePOSPresets() {
  const queryClient = useQueryClient();

  const query = useQuery<POSPresets>({
    queryKey: QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_config')
        .select('pos_quick_payment_amounts, pos_opening_cash_presets, pos_discount_presets')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        quickPayments: coerceNumberArray(
          data?.pos_quick_payment_amounts,
          FALLBACK_PRESETS.quickPayments,
        ),
        openingCashPresets: coerceNumberArray(
          data?.pos_opening_cash_presets,
          FALLBACK_PRESETS.openingCashPresets,
        ),
        discountPresets: coerceDiscountArray(
          data?.pos_discount_presets,
          FALLBACK_PRESETS.discountPresets,
        ),
      };
    },
  });

  const presets: POSPresets = query.data ?? FALLBACK_PRESETS;

  const mutateQuickPayments = useMutation({
    mutationFn: async (next: number[]) => {
      const { error } = await supabase.rpc('set_setting_v11', {
        p_key: 'pos_quick_payment_amounts',
        p_value: next as unknown as Json,
        p_category: 'pos_presets',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const mutateOpeningCash = useMutation({
    mutationFn: async (next: number[]) => {
      const { error } = await supabase.rpc('set_setting_v11', {
        p_key: 'pos_opening_cash_presets',
        p_value: next as unknown as Json,
        p_category: 'pos_presets',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const mutateDiscountPresets = useMutation({
    mutationFn: async (next: DiscountPreset[]) => {
      const { error } = await supabase.rpc('set_setting_v11', {
        p_key: 'pos_discount_presets',
        p_value: next as unknown as Json,
        p_category: 'pos_presets',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    presets,
    isLoading: query.isLoading,
    error: query.error,
    mutateQuickPayments,
    mutateOpeningCash,
    mutateDiscountPresets,
  };
}
