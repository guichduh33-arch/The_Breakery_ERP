// apps/backoffice/src/pages/reports/PermissionChangesPage.tsx
// S40 Wave B3 — Permission change log: Date / Actor / Action badge / Role / Permission / Detail.

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  usePermissionChanges,
  type PermissionChangeLine,
} from '@/features/reports/hooks/usePermissionChanges.js';

const csvColumns: CsvColumn<PermissionChangeLine>[] = [
  { header: 'Date',            accessor: (r) => r.changed_at.slice(0, 10), format: 'text' },
  { header: 'Actor',           accessor: (r) => r.actor_name,              format: 'text' },
  { header: 'Action',          accessor: (r) => r.action,                  format: 'text' },
  { header: 'Role',            accessor: (r) => r.role_code ?? '',         format: 'text' },
  { header: 'Permission',      accessor: (r) => r.permission_code ?? '',   format: 'text' },
  { header: 'Detail',          accessor: (r) => JSON.stringify(r.detail),  format: 'text' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

/** Badge colour by action type. */
function actionBadge(action: string): JSX.Element {
  const lower = action.toLowerCase();
  let cls: string;
  if (lower.includes('granted') || lower === 'grant') {
    cls = 'inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-success-soft text-success';
  } else if (lower.includes('revoked') || lower === 'revoke') {
    cls = 'inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-danger-soft text-danger';
  } else {
    cls = 'inline-flex rounded px-1.5 py-0.5 text-xs font-medium bg-surface-raised text-text-secondary';
  }
  return <span className={cls}>{action}</span>;
}

export default function PermissionChangesPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = usePermissionChanges({ start, end });

  const changes = data?.changes ?? [];

  return (
    <ReportPage
      title="Permission Change Log"
      subtitle="Audit trail of permission grants and revocations across a date range."
      isEmpty={!isLoading && !error && data !== undefined && changes.length === 0}
      emptyState={{
        title: 'No permission changes',
        description: 'No permission changes recorded for this period.',
      }}
      filters={
        <div className="flex items-center gap-3">
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          {data && (
            <ExportButtons
              csv={{ rows: changes, columns: csvColumns, filename: `permission-changes-${start}_${end}` }}
            />
          )}
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}
      {data?.truncated && (
        <p className="mb-3 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
          First 500 rows shown — narrow the date range to see all changes.
        </p>
      )}
      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Date</th>
              <th className="py-2 text-left">Actor</th>
              <th className="py-2 text-left">Action</th>
              <th className="py-2 text-left">Role</th>
              <th className="py-2 text-left">Permission</th>
              <th className="py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((r, idx) => (
              <tr key={`${r.changed_at}-${idx}`} className="border-b border-border-subtle">
                <td className="py-2 text-text-secondary whitespace-nowrap">{r.changed_at.slice(0, 10)}</td>
                <td className="py-2">{r.actor_name}</td>
                <td className="py-2">{actionBadge(r.action)}</td>
                <td className="py-2 text-text-secondary">{r.role_code ?? '—'}</td>
                <td className="py-2 text-text-secondary">{r.permission_code ?? '—'}</td>
                <td className="py-2">
                  {r.detail !== null && r.detail !== undefined ? (
                    <code className="rounded bg-surface-raised px-1 py-0.5 text-xs text-text-secondary break-all">
                      {JSON.stringify(r.detail)}
                    </code>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportPage>
  );
}
