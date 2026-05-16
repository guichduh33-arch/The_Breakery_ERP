// apps/backoffice/src/features/inventory-production/hooks/useProductionSchedule.ts
//
// Session 15 / Phase 4.B — Hooks for the production scheduling calendar.
//
// Exposes :
//   - useProductionSchedules(weekStart)       — Query for a Mon..Sun window.
//   - useScheduleSuggestions(targetDate)       — Query for suggest RPC.
//   - useUpsertSchedule()                      — Mutation (insert or update).
//   - useDeleteSchedule()                      — Soft-cancel mutation
//                                                (status = 'cancelled') for
//                                                auditability. Hard delete is
//                                                also exported for managers
//                                                that want it.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type ScheduleSlot = '5am' | '7am' | '11am' | '4pm';

export const SCHEDULE_SLOTS: readonly ScheduleSlot[] = ['5am', '7am', '11am', '4pm'] as const;

export type ScheduleStatus =
  | 'scheduled'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'skipped';

export interface ScheduleRow {
  id:                  string;
  scheduledDate:       string; // ISO YYYY-MM-DD
  slot:                ScheduleSlot;
  recipeId:            string | null;
  recipeName?:         string | null;
  plannedQty:          number;
  status:              ScheduleStatus;
  notes:               string | null;
  completedRecordId:   string | null;
  createdBy:           string | null;
  createdAt:           string;
  updatedAt:           string;
}

export interface ScheduleSuggestion {
  product_id:              string;
  product_name:            string;
  suggested_qty:           number;
  avg_daily_sales:         number;
  margin_pct:              number;
  ranking_score:           number;
  has_sufficient_history:  boolean;
  sale_days:               number;
}

export interface ScheduleSuggestionsPayload {
  target_date:  string;
  target_dow:   number;
  window_start: string;
  suggestions:  ScheduleSuggestion[];
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export function weekKey(weekStart: Date): string {
  return toIsoDate(weekStart);
}

interface RawScheduleRow {
  id:                   string;
  scheduled_date:       string;
  slot:                 string;
  recipe_id:            string | null;
  planned_qty:          number | string;
  status:               string;
  notes:                string | null;
  completed_record_id:  string | null;
  created_by:           string | null;
  created_at:           string;
  updated_at:           string;
  recipe?:              { id: string; name: string } | null;
}

function mapRow(r: RawScheduleRow): ScheduleRow {
  return {
    id:                r.id,
    scheduledDate:     r.scheduled_date,
    slot:              r.slot as ScheduleSlot,
    recipeId:          r.recipe_id,
    recipeName:        r.recipe?.name ?? null,
    plannedQty:        Number(r.planned_qty),
    status:            r.status as ScheduleStatus,
    notes:             r.notes,
    completedRecordId: r.completed_record_id,
    createdBy:         r.created_by,
    createdAt:         r.created_at,
    updatedAt:         r.updated_at,
  };
}

/**
 * Load the schedules for a Monday-anchored 7-day window.
 * Recipe names are resolved in a follow-up `products` lookup because the
 * production_schedules.recipe_id FK alias is shared across multiple views
 * (products / view_recipe_products / mv_stock_variance), which would make
 * the embedded join ambiguous in PostgREST.
 */
export function useProductionSchedules(weekStart: Date) {
  const startIso = toIsoDate(weekStart);
  const endIso   = toIsoDate(addDays(weekStart, 6));
  return useQuery<ScheduleRow[]>({
    queryKey: ['production-schedule', startIso] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_schedules')
        .select('id, scheduled_date, slot, recipe_id, planned_qty, status, notes, completed_record_id, created_by, created_at, updated_at')
        .gte('scheduled_date', startIso)
        .lte('scheduled_date', endIso)
        .order('scheduled_date', { ascending: true })
        .order('slot',           { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as RawScheduleRow[];

      const recipeIds = Array.from(
        new Set(rows.map((r) => r.recipe_id).filter((id): id is string => id !== null)),
      );
      const nameMap = new Map<string, string>();
      if (recipeIds.length > 0) {
        const { data: prodData, error: prodErr } = await supabase
          .from('products')
          .select('id, name')
          .in('id', recipeIds);
        if (prodErr) throw prodErr;
        for (const p of (prodData ?? []) as Array<{ id: string; name: string }>) {
          nameMap.set(p.id, p.name);
        }
      }

      return rows.map((r) => {
        const base = mapRow(r);
        return {
          ...base,
          recipeName: r.recipe_id !== null ? (nameMap.get(r.recipe_id) ?? null) : null,
        };
      });
    },
  });
}

/**
 * Fetch ranked suggestions for a specific date via suggest_production_schedule_v1.
 */
export function useScheduleSuggestions(targetDate: Date) {
  const iso = toIsoDate(targetDate);
  return useQuery<ScheduleSuggestionsPayload>({
    queryKey: ['production-schedule', 'suggestions', iso] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suggest_production_schedule_v1', {
        p_target_date: iso,
      });
      if (error) throw error;
      const payload = data as unknown as ScheduleSuggestionsPayload | null;
      return payload ?? { target_date: iso, target_dow: 0, window_start: iso, suggestions: [] };
    },
  });
}

export interface UpsertScheduleArgs {
  /** Provide id to update an existing row ; omit to insert. */
  id?:               string;
  scheduledDate:     string; // YYYY-MM-DD
  slot:              ScheduleSlot;
  recipeId:          string;
  plannedQty:        number;
  notes?:            string | null;
  status?:           ScheduleStatus;
  completedRecordId?: string | null;
}

interface ScheduleInsertPayload {
  scheduled_date:       string;
  slot:                 string;
  recipe_id?:           string | null;
  planned_qty:          number;
  notes?:               string | null;
  status?:              string;
  completed_record_id?: string | null;
}

interface ScheduleUpdatePayload {
  scheduled_date?:      string;
  slot?:                string;
  recipe_id?:           string | null;
  planned_qty?:         number;
  notes?:               string | null;
  status?:              string;
  completed_record_id?: string | null;
}

export function useUpsertSchedule() {
  const qc = useQueryClient();
  return useMutation<ScheduleRow, Error, UpsertScheduleArgs>({
    mutationFn: async (args) => {
      const base: ScheduleInsertPayload = {
        scheduled_date: args.scheduledDate,
        slot:           args.slot,
        recipe_id:      args.recipeId,
        planned_qty:    args.plannedQty,
      };
      if (args.notes !== undefined)             base.notes = args.notes;
      if (args.status !== undefined)            base.status = args.status;
      if (args.completedRecordId !== undefined) base.completed_record_id = args.completedRecordId;

      const selectCols = 'id, scheduled_date, slot, recipe_id, planned_qty, status, notes, completed_record_id, created_by, created_at, updated_at';

      let row: RawScheduleRow;
      if (args.id !== undefined) {
        const updatePayload: ScheduleUpdatePayload = { ...base };
        const { data, error } = await supabase
          .from('production_schedules')
          .update(updatePayload)
          .eq('id', args.id)
          .select(selectCols)
          .single();
        if (error) throw error;
        row = data as unknown as RawScheduleRow;
      } else {
        const { data, error } = await supabase
          .from('production_schedules')
          .insert(base)
          .select(selectCols)
          .single();
        if (error) throw error;
        row = data as unknown as RawScheduleRow;
      }
      return mapRow(row);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['production-schedule'], exact: false });
    },
  });
}

/**
 * Soft-cancel by default (status = 'cancelled') to keep an audit trail. Hard
 * delete is accepted via `hard: true` for managers cleaning up typo rows that
 * never reached 'started'.
 */
export interface DeleteScheduleArgs {
  id:   string;
  hard?: boolean;
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation<void, Error, DeleteScheduleArgs>({
    mutationFn: async ({ id, hard }) => {
      if (hard === true) {
        const { error } = await supabase
          .from('production_schedules')
          .delete()
          .eq('id', id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from('production_schedules')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['production-schedule'], exact: false });
    },
  });
}

/**
 * Return Monday-anchored start of the ISO week containing `d` (UTC).
 */
export function startOfWeekMonday(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay(); // 0=Sun..6=Sat
  const offset = (dow + 6) % 7; // Mon=0..Sun=6
  out.setUTCDate(out.getUTCDate() - offset);
  return out;
}

export { toIsoDate, addDays };
