import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const DEFAULT_VARIANCE_THRESHOLD_ABS = 50_000;
export const DEFAULT_VARIANCE_THRESHOLD_PCT = 0.005;
export const DEFAULT_VARIANCE_PIN_THRESHOLD_ABS = 200_000;
export const DEFAULT_VARIANCE_PIN_THRESHOLD_PCT = 0.02;

export interface ShiftCloseSummary {
  expectedCash: number;
  thresholdAbs: number;
  thresholdPct: number;
  pinThresholdAbs: number;
  pinThresholdPct: number;
}

export function useShiftCloseSummary(sessionId: string | null) {
  return useQuery({
    queryKey: ['shift-close-summary', sessionId],
    enabled: !!sessionId,
    staleTime: 0,
    queryFn: async (): Promise<ShiftCloseSummary> => {
      // Même calcul serveur pour la prévisualisation et le rapport figé.
      const { data, error } = await supabase.rpc('get_shift_close_preview_v1', { p_session_id: sessionId! });
      if (error) throw new Error(error.message);
      const result = data as unknown as ShiftCloseSummary;
      if (!result || !Object.values(result).every((value) => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error('Invalid shift summary');
      }
      return result;
    },
  });
}
