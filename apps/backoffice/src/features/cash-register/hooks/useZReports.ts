// apps/backoffice/src/features/cash-register/hooks/useZReports.ts
//
// S29 Wave 6.A.1 — list Z-Reports with optional status + date range filter.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type ZReportStatus = 'draft' | 'signed' | 'voided';

export interface ZReportListRow {
  id:                  string;
  shift_id:            string;
  generated_at:        string;
  signed_at:           string | null;
  signed_by:           string | null;
  signed_by_name:      string | null;
  voided_at:           string | null;
  voided_by:           string | null;
  void_reason:         string | null;
  pdf_storage_path:    string | null;
  status:              ZReportStatus;
  /**
   * Chiffres de la session de caisse rattachée — attendu, compté, écart.
   *
   * Ils sont joints à la LISTE et non réservés au PDF pour une raison de
   * contrôle : une signature est irréversible, donc l'écart doit se voir AVANT
   * de signer, pas en rouvrant l'archive après. Un rapport dont l'écart n'est
   * lisible qu'après signature ne protège personne.
   *
   * `null` quand la session n'est pas lisible par le rôle courant (RLS) : la
   * colonne se rend alors en tiret plutôt qu'en zéro — un écart inconnu n'est
   * pas un écart nul.
   */
  expected_cash:       number | null;
  counted_cash:        number | null;
  variance_total:      number | null;
}

export interface ZReportsFilters {
  status?:        ZReportStatus;
  startDate?:     string; // YYYY-MM-DD, filters generated_at >= startDate
  endDate?:       string; // YYYY-MM-DD, filters generated_at <= endDate + '23:59:59'
}

export const Z_REPORTS_QK = ['z_reports'] as const;

export function useZReports(filters: ZReportsFilters = {}) {
  return useQuery<ZReportListRow[]>({
    queryKey: [...Z_REPORTS_QK, 'list', filters] as const,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('z_reports')
        .select('id, shift_id, generated_at, signed_at, signed_by, voided_at, voided_by, void_reason, pdf_storage_path, status, signed_by_profile:user_profiles!z_reports_signed_by_fkey(full_name), shift:pos_sessions!z_reports_shift_id_fkey(expected_cash, closing_cash, variance_total)')
        .order('generated_at', { ascending: false })
        .limit(200);
      if (filters.status)    q = q.eq('status', filters.status);
      if (filters.startDate) q = q.gte('generated_at', `${filters.startDate}T00:00:00Z`);
      if (filters.endDate)   q = q.lte('generated_at', `${filters.endDate}T23:59:59Z`);
      const { data, error } = await q;
      if (error) throw error;
      interface RawShift {
        expected_cash?:  number | null;
        closing_cash?:   number | null;
        variance_total?: number | null;
      }
      type RawRow = ZReportListRow & {
        signed_by_profile?: { full_name?: string } | null;
        // PostgREST rend un embed 1-1 comme objet, mais certaines versions le
        // rendent en tableau d'un élément — on accepte les deux plutôt que de
        // parier sur l'une.
        shift?: RawShift | RawShift[] | null;
      };
      const shiftOf = (raw: RawRow['shift']): RawShift | null =>
        raw == null ? null : Array.isArray(raw) ? raw[0] ?? null : raw;

      return (data as RawRow[] | null ?? []).map((r) => {
        const shift = shiftOf(r.shift);
        return {
          id:               r.id,
          shift_id:         r.shift_id,
          generated_at:     r.generated_at,
          signed_at:        r.signed_at,
          signed_by:        r.signed_by,
          signed_by_name:   r.signed_by_profile?.full_name ?? null,
          voided_at:        r.voided_at,
          voided_by:        r.voided_by,
          void_reason:      r.void_reason,
          pdf_storage_path: r.pdf_storage_path,
          status:           r.status,
          expected_cash:    shift?.expected_cash ?? null,
          counted_cash:     shift?.closing_cash ?? null,
          variance_total:   shift?.variance_total ?? null,
        };
      });
    },
  });
}
