// apps/backoffice/src/features/settings/hooks/useSettingsHistory.ts
//
// Settings History view (ADR-006 décision 9) — merged, cursor-paginated feed
// of `setting.update` (business_config via set_setting_vN) and
// `b2b_settings.updated` audit entries, read through get_audit_logs_v2.
// `audit_logs` is admin_read RLS-gated and the RPC is SECURITY INVOKER, so a
// non-admin gets an empty feed by design (the route is also admin-gated).
//
// Two actions → two infinite queries merged client-side: get_audit_logs_v2
// only takes a single `p_action` equality. Global ordering across the two
// feeds is only guaranteed up to the older of the two page cursors, which is
// acceptable at this volume (~40 rows per action after two months) — the
// first page of each feed covers years of changes.

import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface SettingChange {
  field:    string;
  oldValue: unknown;
  newValue: unknown;
}

export interface SettingsHistoryEntry {
  id:        number;
  createdAt: string;
  actorId:   string | null;
  category:  string;          // metadata.category for settings rows, 'b2b' for B2B rows
  changes:   SettingChange[]; // settings rows always carry exactly one
}

export const SETTINGS_HISTORY_QK = ['settings', 'history'] as const;
const PAGE_SIZE = 50;

interface RawAuditRow {
  id:         number;
  actor_id:   string | null;
  metadata:   unknown;
  created_at: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// business_config settings — metadata is {key, category, old, new}.
function parseSettingRow(row: RawAuditRow): SettingsHistoryEntry {
  const md = isRecord(row.metadata) ? row.metadata : {};
  return {
    id:        row.id,
    createdAt: row.created_at,
    actorId:   row.actor_id,
    category:  typeof md.category === 'string' ? md.category : 'unknown',
    changes: [{
      field:    typeof md.key === 'string' ? md.key : 'unknown',
      oldValue: md.old,
      newValue: md.new,
    }],
  };
}

// B2B settings — metadata is {old: <full row>, patch: <patched fields>}.
// Diff patch against old, skipping bookkeeping columns, so one audit row
// becomes one entry listing only the fields that actually changed.
const B2B_SKIPPED_FIELDS = new Set(['id', 'updated_at', 'updated_by']);

function parseB2bRow(row: RawAuditRow): SettingsHistoryEntry {
  const md = isRecord(row.metadata) ? row.metadata : {};
  const oldRow = isRecord(md.old) ? md.old : {};
  const patch = isRecord(md.patch) ? md.patch : {};
  const changes: SettingChange[] = Object.keys(patch)
    .filter((k) => !B2B_SKIPPED_FIELDS.has(k))
    .filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(oldRow[k]))
    .map((k) => ({ field: k, oldValue: oldRow[k], newValue: patch[k] }));
  return {
    id:        row.id,
    createdAt: row.created_at,
    actorId:   row.actor_id,
    category:  'b2b',
    changes,
  };
}

function useAuditFeed(action: string) {
  return useInfiniteQuery<RawAuditRow[], Error>({
    queryKey: [...SETTINGS_HISTORY_QK, action] as const,
    staleTime: 30_000,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const args: { p_action: string; p_limit: number; p_cursor?: string } = {
        p_action: action,
        p_limit:  PAGE_SIZE,
      };
      const cursor = pageParam as string | null;
      if (cursor !== null) args.p_cursor = cursor;

      const { data, error } = await supabase.rpc('get_audit_logs_v2', args);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id:         Number(r.id),
        actor_id:   r.actor_id,
        metadata:   r.metadata,
        created_at: r.created_at,
      }));
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined; // exhausted
      const last = lastPage[lastPage.length - 1];
      return last ? last.created_at : undefined;
    },
  });
}

export interface UseSettingsHistoryResult {
  entries:            SettingsHistoryEntry[];
  isLoading:          boolean;
  error:              Error | null;
  hasNextPage:        boolean;
  isFetchingNextPage: boolean;
  fetchNextPage:      () => void;
}

export function useSettingsHistory(): UseSettingsHistoryResult {
  const settingsQ = useAuditFeed('setting.update');
  const b2bQ = useAuditFeed('b2b_settings.updated');

  const entries = useMemo<SettingsHistoryEntry[]>(() => {
    const settingRows = (settingsQ.data?.pages ?? []).flat().map(parseSettingRow);
    const b2bRows = (b2bQ.data?.pages ?? []).flat().map(parseB2bRow);
    return [...settingRows, ...b2bRows].sort((a, b) =>
      a.createdAt === b.createdAt ? b.id - a.id : (a.createdAt < b.createdAt ? 1 : -1),
    );
  }, [settingsQ.data, b2bQ.data]);

  return {
    entries,
    isLoading:          settingsQ.isLoading || b2bQ.isLoading,
    error:              settingsQ.error ?? b2bQ.error,
    hasNextPage:        (settingsQ.hasNextPage ?? false) || (b2bQ.hasNextPage ?? false),
    isFetchingNextPage: settingsQ.isFetchingNextPage || b2bQ.isFetchingNextPage,
    fetchNextPage: () => {
      if (settingsQ.hasNextPage) void settingsQ.fetchNextPage();
      if (b2bQ.hasNextPage) void b2bQ.fetchNextPage();
    },
  };
}
