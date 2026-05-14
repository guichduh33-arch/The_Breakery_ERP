// apps/backoffice/src/features/print-queue/hooks/usePrintQueue.ts
// Session 13 / Phase 5.A — list print queue rows filtered by status.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type PrintJobStatus = 'queued' | 'printing' | 'done' | 'failed' | 'cancelled';

export interface PrintJobRow {
  id:             string;
  device_id:      string | null;
  payload:        Record<string, unknown>;
  status:         PrintJobStatus;
  source:         string | null;
  reference_type: string | null;
  reference_id:   string | null;
  priority:       number;
  retries:        number;
  error_message:  string | null;
  queued_at:      string;
  printed_at:     string | null;
  created_at:     string;
  updated_at:     string;
}

export const PRINT_QUEUE_KEY = ['print-queue'] as const;

interface UsePrintQueueOptions {
  statuses?: readonly PrintJobStatus[];
  limit?:    number;
}

export function usePrintQueue(opts: UsePrintQueueOptions = {}) {
  const statuses = opts.statuses ?? ['queued', 'printing', 'failed'];
  const limit    = opts.limit ?? 100;

  return useQuery<PrintJobRow[]>({
    queryKey: [...PRINT_QUEUE_KEY, statuses.join(','), limit] as const,
    staleTime: 5_000,
    refetchInterval: 10_000, // soft-poll every 10s — Realtime hook (Phase 5+) replaces this.
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder = (supabase as any).from('print_queue')
        .select('*')
        .in('status', statuses)
        .order('priority', { ascending: false })
        .order('queued_at', { ascending: true })
        .limit(limit);
      const { data, error } = await builder;
      if (error !== null && error !== undefined) throw new Error((error as { message: string }).message);
      return (data ?? []) as PrintJobRow[];
    },
  });
}
