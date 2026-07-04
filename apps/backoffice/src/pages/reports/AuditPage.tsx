// apps/backoffice/src/pages/reports/AuditPage.tsx
//
// Cursor-paginated audit log viewer. Uses the infinite query so "Load
// more" appends pages of 50 rows. No `LIMIT 5000` or offset patterns
// (cf. fix 14-002).
//
// Session 59 / Task 6c — actor/action/entity filters (wired onto params
// useAuditLogs already accepted but the page never exposed) + an expandable
// per-row detail showing `metadata` (audit_logs.metadata — free-form
// context). NOTE: `audit_logs.payload` (the before/after diff column, S19)
// is NOT selected by get_audit_logs_v1/_v2 today, so it can't be surfaced
// here without an additive RPC bump (out of scope — this task is UI-only,
// no migration; flagged in the session report as a fast-follow).

import { Fragment, useState, type JSX } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { useAuditLogs, type AuditLogRow } from '@/features/reports/hooks/useAuditLogs.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import {
  AuditLogFilters,
  EMPTY_AUDIT_LOG_FILTERS,
  type AuditLogFilterValues,
} from '@/features/reports/components/AuditLogFilters.js';

const csvColumns: CsvColumn<AuditLogRow>[] = [
  { header: 'Timestamp',   accessor: (r) => r.created_at,  format: 'datetime' },
  { header: 'Action',      accessor: (r) => r.action,      format: 'text' },
  { header: 'Entity Type', accessor: (r) => r.entity_type, format: 'text' },
  { header: 'Actor ID',    accessor: (r) => r.actor_id,    format: 'text' },
];

function formatMetadata(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return '—';
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

export default function AuditPage(): JSX.Element {
  const [filters, setFilters] = useState<AuditLogFilterValues>(EMPTY_AUDIT_LOG_FILTERS);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // exactOptionalPropertyTypes: only set a key when the filter is non-empty —
  // an explicit `actorId: undefined` is rejected, the key must be absent.
  const rpcFilters: Parameters<typeof useAuditLogs>[0] = {};
  if (filters.actorId !== '') rpcFilters.actorId = filters.actorId;
  if (filters.action !== '') rpcFilters.action = filters.action;
  if (filters.entityType !== '') rpcFilters.entityType = filters.entityType;

  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useAuditLogs(rpcFilters);

  const rows: AuditLogRow[] = (data?.pages ?? []).flat();

  return (
    <ReportPage
      title="Audit Log"
      subtitle="System-wide audit trail. Cursor-paginated, newest first."
      isEmpty={!isLoading && !error && rows.length === 0}
      emptyState={{
        title: 'No audit entries',
        description: 'No audit entries recorded yet.',
      }}
      filters={
        <div className="flex flex-wrap items-end gap-3">
          <AuditLogFilters value={filters} onChange={setFilters} />
          {rows.length > 0 && (
            <ExportButtons
              csv={{ rows, columns: csvColumns, filename: 'audit-log-current-view' }}
              pdf={{ template: 'audit', data: rows, filename: 'audit-log-current-view' }}
            />
          )}
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load audit log.'}
        </p>
      )}
      {!isLoading && (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-border-subtle">
                <th className="py-2 text-left w-8"></th>
                <th className="py-2 text-left">Timestamp</th>
                <th className="py-2 text-left">Action</th>
                <th className="py-2 text-left">Entity</th>
                <th className="py-2 text-left">Actor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expanded = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="border-b border-border-subtle cursor-pointer hover:bg-bg-base/40"
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                      data-testid={`audit-row-${r.id}`}
                    >
                      <td className="py-2 text-text-secondary" data-testid={`audit-toggle-${r.id}`}>
                        {expanded
                          ? <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                          : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                      </td>
                      <td className="py-2 tabular-nums text-text-secondary">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="py-2">{r.action}</td>
                      <td className="py-2">
                        {r.entity_type === 'product' && r.entity_id ? (
                          <DrilldownLink entity="product" id={r.entity_id} label={`product ${r.entity_id.slice(0, 8)}`} icon={false} />
                        ) : r.entity_type === 'order' && r.entity_id ? (
                          <DrilldownLink entity="order" id={r.entity_id} label={`order ${r.entity_id.slice(0, 8)}`} icon={false} />
                        ) : r.entity_type === 'expense' && r.entity_id ? (
                          <DrilldownLink entity="expense" id={r.entity_id} label={`expense ${r.entity_id.slice(0, 8)}`} icon={false} />
                        ) : r.entity_type === 'customer' && r.entity_id ? (
                          <DrilldownLink entity="customer" id={r.entity_id} label={`customer ${r.entity_id.slice(0, 8)}`} icon={false} />
                        ) : (
                          r.entity_type
                        )}
                      </td>
                      <td className="py-2 text-xs text-text-secondary">
                        {r.actor_id ? (
                          <DrilldownLink entity="user" id={r.actor_id} label={r.actor_id.slice(0, 8)} icon={false} />
                        ) : '—'}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border-subtle bg-bg-base/20" data-testid={`audit-detail-${r.id}`}>
                        <td></td>
                        <td colSpan={4} className="py-2">
                          <div className="text-xs uppercase tracking-widest text-text-secondary">
                            Metadata (context)
                          </div>
                          <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-text-secondary">
                            {formatMetadata(r.metadata)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {hasNextPage && (
            <div className="flex justify-center pt-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={() => { void fetchNextPage(); }}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </ReportPage>
  );
}
