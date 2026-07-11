// apps/pos/src/features/reports/hooks/usePosEventsJournal.ts
//
// S72 Lot 4 — infinite-scrolling reader for the POS operational audit journal
// (pos_events). Backed by `get_pos_events_v1`: keyset-paginated (occurred_at
// DESC, id DESC), WITA business-date window, filters by event types / device /
// operator / ticket. Page 1 carries the true total + the device/operator
// facets for the filter dropdowns; cursor pages skip those scans (total = -1
// sentinel, empty facets) and the client keeps page-1's. Gated
// reports.audit.read server-side (42501 → query error).

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';

export interface PosJournalEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  device_id: string;
  device_label: string;
  device_kind: string;
  device_seq: number | null;
  actor_id: string | null;
  actor_name: string | null;
  session_id: string | null;
  order_id: string | null;
  order_number: string | null;
  order_item_id: string | null;
  amount: number | null;
  reason: string | null;
  payload: Record<string, unknown>;
}

export interface PosJournalDevice {
  id: string;
  label: string;
  kind: string;
  is_registered: boolean;
}

export interface PosJournalActor {
  id: string;
  name: string;
}

export interface PosJournalFilters {
  /** Event-type allowlist (enum values); null = all types. */
  eventTypes: string[] | null;
  deviceId: string | null;
  actorId: string | null;
  orderId: string | null;
}

export const EMPTY_JOURNAL_FILTERS: PosJournalFilters = {
  eventTypes: null,
  deviceId: null,
  actorId: null,
  orderId: null,
};

interface RawJournalEvent extends Omit<PosJournalEvent, 'amount' | 'device_seq'> {
  amount: number | string | null;
  device_seq: number | string | null;
}

interface JournalPage {
  timezone: string;
  total_count: number;
  next_cursor: string | null;
  devices: PosJournalDevice[];
  actors: PosJournalActor[];
  events: PosJournalEvent[];
}

interface RawJournalPage {
  timezone: string;
  total_count: number | string;
  next_cursor: string | null;
  devices: PosJournalDevice[] | null;
  actors: PosJournalActor[] | null;
  events: RawJournalEvent[] | null;
}

const PAGE_SIZE = 50;

export function usePosEventsJournal(period: ReportsPeriod, filters: PosJournalFilters) {
  return useInfiniteQuery<JournalPage>({
    queryKey: [
      'pos-events-journal',
      period.startDate,
      period.endDate,
      filters.eventTypes,
      filters.deviceId,
      filters.actorId,
      filters.orderId,
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('get_pos_events_v1', {
        p_start_date: period.startDate,
        p_end_date: period.endDate,
        ...(filters.eventTypes ? { p_event_types: filters.eventTypes } : {}),
        ...(filters.deviceId ? { p_device_id: filters.deviceId } : {}),
        ...(filters.actorId ? { p_actor_id: filters.actorId } : {}),
        ...(filters.orderId ? { p_order_id: filters.orderId } : {}),
        p_limit: PAGE_SIZE,
        ...(pageParam ? { p_cursor: pageParam as string } : {}),
      });
      if (error) throw new Error(error.message);
      const p = data as unknown as RawJournalPage;
      return {
        timezone: p.timezone,
        total_count: Number(p.total_count),
        next_cursor: p.next_cursor,
        devices: p.devices ?? [],
        actors: p.actors ?? [],
        events: (p.events ?? []).map((e) => ({
          ...e,
          amount: e.amount == null ? null : Number(e.amount),
          device_seq: e.device_seq == null ? null : Number(e.device_seq),
          payload: e.payload ?? {},
        })),
      };
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  });
}
