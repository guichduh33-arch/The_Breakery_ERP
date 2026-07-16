// apps/backoffice/src/features/settings/hooks/useHolidays.ts
//
// Session 13 / Phase 5.C — CRUD hooks for the holidays calendar.
// RLS gates writes on `settings.holidays.manage` (ADMIN+).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type HolidayRow    = Database['public']['Tables']['holidays']['Row'];
export type HolidayInsert = Database['public']['Tables']['holidays']['Insert'];
export type HolidayUpdate = Database['public']['Tables']['holidays']['Update'];

export type HolidayType = 'national' | 'religious' | 'company';

export const HOLIDAYS_QUERY_KEY = ['holidays'] as const;

export function useHolidaysList() {
  return useQuery<HolidayRow[]>({
    queryKey: HOLIDAYS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .is('deleted_at', null)
        .order('date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Settings §6.A — read-side matcher for the holiday consumers (dashboard
// banner + daily sales annotation). Fixed-date holidays match the exact ISO
// date; recurring ones (is_recurring) match month+day every year.
export function holidayNameFor(
  holidays: readonly HolidayRow[] | undefined,
  isoDate: string,
): string | null {
  if (!holidays || isoDate.length < 10) return null;
  const monthDay = isoDate.slice(5, 10);
  for (const h of holidays) {
    if (h.is_recurring ? h.date.slice(5) === monthDay : h.date === isoDate) {
      return h.name;
    }
  }
  return null;
}

export function useCreateHoliday() {
  const qc = useQueryClient();
  return useMutation<HolidayRow, Error, HolidayInsert>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('holidays')
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: HOLIDAYS_QUERY_KEY });
    },
  });
}

export function useUpdateHoliday() {
  const qc = useQueryClient();
  return useMutation<HolidayRow, Error, { id: string; values: HolidayUpdate }>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('holidays')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: HOLIDAYS_QUERY_KEY });
    },
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      // Soft delete : flip deleted_at. Cron-purgeable later if needed.
      const { error } = await supabase
        .from('holidays')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: HOLIDAYS_QUERY_KEY });
    },
  });
}
