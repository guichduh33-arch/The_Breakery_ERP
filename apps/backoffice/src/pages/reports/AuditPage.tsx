// apps/backoffice/src/pages/reports/AuditPage.tsx
//
// Cursor-paginated audit log viewer. Uses the infinite query so "Load
// more" appends pages of 50 rows. No `LIMIT 5000` or offset patterns
// (cf. fix 14-002).

import { Button } from '@breakery/ui';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { useAuditLogs, type AuditLogRow } from '@/features/reports/hooks/useAuditLogs.js';

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
