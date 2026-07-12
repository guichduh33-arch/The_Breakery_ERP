// apps/backoffice/src/features/floor-plan/hooks/useFloorPlanAdmin.ts
// S75 Task 3 — Floor Plan BO: tables + sections CRUD.
// RPCs are Task 1 (20260712000161_floor_plan_sections_crud.sql), types Task 2.
//
// Reads intentionally do NOT filter `is_active` client-side (admins manage
// inactive tables/sections too — Inactive badge + reactivate flow). Row-level
// visibility comes from migration _162: auth_read shows inactive-but-not-
// deleted rows on both tables, so no deleted_at filter is needed here either.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { RestaurantTable, TableSection } from '@breakery/domain';

const TABLES_KEY = ['floor_plan', 'tables'] as const;
const SECTIONS_KEY = ['floor_plan', 'sections'] as const;
const LEGACY_TABLES_KEY = ['restaurant_tables'] as const;

async function invalidateFloorPlan(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: TABLES_KEY }),
    qc.invalidateQueries({ queryKey: SECTIONS_KEY }),
    qc.invalidateQueries({ queryKey: LEGACY_TABLES_KEY }),
  ]);
}

export function useFloorPlanTables() {
  return useQuery<RestaurantTable[]>({
    queryKey: TABLES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('restaurant_tables')
        .select('id,name,seats,sort_order,is_active,section_id, table_sections(name,sort_order)')
        .order('sort_order', { ascending: true });
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useTableSections() {
  return useQuery<TableSection[]>({
    queryKey: SECTIONS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('table_sections')
        .select('id,name,sort_order,is_active')
        .order('sort_order', { ascending: true });
      if (error !== null) throw new Error(error.message);
      return (data ?? []);
    },
  });
}

export interface CreateTablePayload {
  name:        string;
  seats:       number;
  section_id:  string | null;
  sort_order:  number;
}

export interface UpdateTablePayload {
  id:          string;
  name:        string;
  seats:       number;
  section_id:  string | null;
  sort_order:  number;
  is_active:   boolean;
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CreateTablePayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('create_restaurant_table_v1', {
        p_name: payload.name,
        p_seats: payload.seats,
        // Generated Args type is non-nullable (`p_section_id: string`) but
        // the RPC accepts NULL at runtime (Task 2 caveat) — cast at the call
        // site rather than forbidding "no section" in the UI.
        p_section_id: payload.section_id as unknown as string,
        p_sort_order: payload.sort_order,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => { await invalidateFloorPlan(qc); },
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, UpdateTablePayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('update_restaurant_table_v1', {
        p_id: payload.id,
        p_name: payload.name,
        p_seats: payload.seats,
        p_section_id: payload.section_id as unknown as string,
        p_sort_order: payload.sort_order,
        p_is_active: payload.is_active,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => { await invalidateFloorPlan(qc); },
  });
}

export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: async (id) => {
      const { data, error } = await supabase.rpc('delete_restaurant_table_v1', { p_id: id });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => { await invalidateFloorPlan(qc); },
  });
}

export interface CreateSectionPayload {
  name:       string;
  sort_order: number;
}

export interface UpdateSectionPayload {
  id:         string;
  name:       string;
  sort_order: number;
  is_active:  boolean;
}

export function useCreateSection() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CreateSectionPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('create_table_section_v1', {
        p_name: payload.name,
        p_sort_order: payload.sort_order,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => { await invalidateFloorPlan(qc); },
  });
}

export function useUpdateSection() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, UpdateSectionPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('update_table_section_v1', {
        p_id: payload.id,
        p_name: payload.name,
        p_sort_order: payload.sort_order,
        p_is_active: payload.is_active,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => { await invalidateFloorPlan(qc); },
  });
}

/** Maps the RPC's raw P0001 error text to a human-readable message. */
export function mapFloorPlanError(message: string): string {
  if (message.includes('table_occupied')) return 'Table has an active order — close it first.';
  if (message.includes('section_in_use')) return 'Section still has active tables — move or deactivate them first.';
  if (message.includes('name_taken')) return 'That name is already taken.';
  if (message.includes('name_required')) return 'Name is required.';
  if (message.includes('invalid_seats')) return 'Seats must be between 1 and 20.';
  if (message.includes('section_not_found')) return 'That section no longer exists.';
  return message;
}

export function useDeleteSection() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: async (id) => {
      const { data, error } = await supabase.rpc('delete_table_section_v1', { p_id: id });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => { await invalidateFloorPlan(qc); },
  });
}
