// Journal commun paginé par horodatage et identifiant de source.
// Les droits et les bornes métier sont appliqués par la RPC.

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface AuditLogRow {
  id:           string;
  actor_id:     string | null;
  actor_name:   string | null;
  action:       string;
  entity_type:  string;
  entity_id:    string | null;
  metadata:     unknown;
  payload:      unknown;
  source:       string;
  created_at:   string;
}

export interface AuditLogFilters {
  actorId?:     string;
  action?:      string;
  entityType?:  string;
  /** Dates métier YYYY-MM-DD, bornes résolues serveur dans le fuseau config. */
  dateStart?:   string;
  dateEnd?:     string;
  pageSize?:    number;
}

export const AUDIT_LOGS_QK = ['reports', 'activity-logs', 'cursor-v3'] as const;
const DEFAULT_PAGE_SIZE = 50;

/** Taille de page maximale acceptée par la RPC. */
export const AUDIT_EXPORT_PAGE_SIZE = 200;
// Garde-fou : 500 pages de 200 lignes. Au-delà, l'export s'arrête et le dit.
const AUDIT_EXPORT_MAX_PAGES = 500;

type AuditPageFilters = Omit<AuditLogFilters, 'pageSize'>;

/** Une page du journal. Le curseur est « horodatage|identifiant » de la dernière ligne lue. */
export async function fetchAuditLogPage(
  filters: AuditPageFilters, cursor: string | null, pageSize: number,
): Promise<AuditLogRow[]> {
  const args: {
    p_cursor?:       string;
    p_limit?:        number;
    p_actor_id?:     string;
    p_action?:       string;
    p_entity_type?:  string;
    p_date_start?:   string;
    p_date_end?:     string;
  } = {
    p_limit: pageSize,
  };
  if (cursor)             args.p_cursor      = cursor;
  if (filters.actorId)    args.p_actor_id    = filters.actorId;
  if (filters.action)     args.p_action      = filters.action;
  if (filters.entityType) args.p_entity_type = filters.entityType;
  if (filters.dateStart)  args.p_date_start  = filters.dateStart;
  if (filters.dateEnd)    args.p_date_end    = filters.dateEnd;

  const { data, error } = await supabase.rpc('get_activity_logs_v3', args);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id:          r.id,
    actor_id:    r.actor_id,
    actor_name:  r.actor_name,
    action:      r.action,
    entity_type: r.entity_type,
    entity_id:   r.entity_id,
    metadata:    r.metadata,
    payload:     r.payload,
    source:      r.source,
    created_at:  r.created_at,
  }));
}

function nextCursor(page: AuditLogRow[], pageSize: number): string | undefined {
  if (page.length < pageSize) return undefined; // exhausted
  const last = page[page.length - 1];
  return last ? `${last.created_at}|${last.id}` : undefined;
}

/**
 * Toutes les lignes de la période et des filtres, sans dépendre de ce que
 * l'écran a déjà chargé. Un export partiel serait un journal troué.
 */
export async function fetchAllAuditLogs(filters: AuditPageFilters): Promise<AuditLogRow[]> {
  const rows: AuditLogRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < AUDIT_EXPORT_MAX_PAGES; page += 1) {
    const batch = await fetchAuditLogPage(filters, cursor, AUDIT_EXPORT_PAGE_SIZE);
    rows.push(...batch);
    const next = nextCursor(batch, AUDIT_EXPORT_PAGE_SIZE);
    if (next === undefined) return rows;
    cursor = next;
  }
  throw new Error('The period holds too many entries for one export. Narrow the dates or the filters.');
}

export function useAuditLogs(filters: AuditLogFilters = {}) {
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  return useInfiniteQuery<AuditLogRow[], Error>({
    queryKey: [...AUDIT_LOGS_QK, filters] as const,
    // Journal immuable : à 30 s, un retour de focus refetchait en série toutes
    // les pages déjà déroulées.
    staleTime: 5 * 60_000,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchAuditLogPage(filters, pageParam as string | null, pageSize),
    getNextPageParam: (lastPage) => nextCursor(lastPage, pageSize),
  });
}
