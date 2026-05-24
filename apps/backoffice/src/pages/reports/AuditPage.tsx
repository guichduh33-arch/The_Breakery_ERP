// apps/backoffice/src/pages/reports/AuditPage.tsx
//
// Cursor-paginated audit log viewer. Uses the infinite query so "Load
// more" appends pages of 50 rows. No `LIMIT 5000` or offset patterns
// (cf. fix 14-002).

import { Button } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { useAuditLogs, type AuditLogRow } from '@/features/reports/hooks/useAuditLogs.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';

const csvColumns: CsvColumn<AuditLogRow>[] = [
  { header: 'Timestamp',   accessor: (r) => r.created_at,  format: 'datetime' },
  { header: 'Action',      accessor: (r) => r.action,      format: 'text' },
  { header: 'Entity Type', accessor: (r) => r.entity_type, format: 'text' },
  { header: 'Actor ID',    accessor: (r) => r.actor_id,    format: 'text' },
];

export default function AuditPage() {
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useAuditLogs();

  const rows: AuditLogRow[] = (data?.pages ?? []).flat();

  return (
    <ReportPage
      title="Audit Log"
      subtitle="System-wide audit trail. Cursor-paginated, newest first."
      filters={
        rows.length > 0 ? (
          <ExportButtons
            csv={{ rows, columns: csvColumns, filename: 'audit-log-current-view' }}
            pdf={{ template: 'audit', data: rows, filename: 'audit-log-current-view' }}
          />
        ) : undefined
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
                <th className="py-2 text-left">Timestamp</th>
                <th className="py-2 text-left">Action</th>
                <th className="py-2 text-left">Entity</th>
                <th className="py-2 text-left">Actor</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className="py-3 text-text-secondary" colSpan={4}>
                    No audit entries.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle">
                  <td className="py-2 tabular-nums text-text-secondary">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2">{r.action}</td>
                  <td className="py-2">{r.entity_type}</td>
                  <td className="py-2 text-xs text-text-secondary">{r.actor_id ?? '—'}</td>
                </tr>
              ))}
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
