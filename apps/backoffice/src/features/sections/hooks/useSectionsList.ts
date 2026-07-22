// apps/backoffice/src/features/sections/hooks/useSectionsList.ts
// Session 13 / Phase 2.D — full sections list (active + inactive) for CRUD page.
//
// ADR-007 déc. 5 (migration _206) — les mutations passent par les RPCs
// upsert_section_v1 / delete_section_v1 (SECURITY DEFINER, gate
// inventory.sections.update, audit_logs). Les policies RLS d'écriture
// directe sur la table sont droppées : plus aucun .update()/.insert() brut.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface SectionRow {
  id:            string;
  code:          string;
  name:          string;
  kind:          'warehouse' | 'production' | 'sales';
  is_active:     boolean;
  display_order: number;
  created_at:    string;
  updated_at:    string;
  deleted_at:    string | null;
}

export const SECTIONS_FULL_KEY = ['sections-full'] as const;

export function useSectionsList() {
  return useQuery<SectionRow[]>({
    queryKey: SECTIONS_FULL_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sections')
        .select('id, code, name, kind, is_active, display_order, created_at, updated_at, deleted_at')
        .is('deleted_at', null)
        .order('display_order', { ascending: true });
      if (error !== null) throw error;
      return (data as unknown as SectionRow[]) ?? [];
    },
  });
}

export interface UpsertSectionArgs {
  id?:           string;
  code:          string;
  name:          string;
  kind:          'warehouse' | 'production' | 'sales';
  is_active:     boolean;
  display_order: number;
}

export function useUpsertSection() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, UpsertSectionArgs>({
    mutationFn: async (args) => {
      // id présent = update (code immuable, ignoré par la RPC), absent = create.
      const { data, error } = await supabase.rpc('upsert_section_v1', {
        p_payload: {
          ...(args.id !== undefined && args.id !== '' ? { id: args.id } : {}),
          code: args.code, name: args.name, kind: args.kind,
          is_active: args.is_active, display_order: args.display_order,
        },
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SECTIONS_FULL_KEY });
      await qc.invalidateQueries({ queryKey: ['sections'] }); // shared with transfers
    },
  });
}

export function useSoftDeleteSection() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.rpc('delete_section_v1', {
        p_section_id: id,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SECTIONS_FULL_KEY });
      await qc.invalidateQueries({ queryKey: ['sections'] });
    },
  });
}
