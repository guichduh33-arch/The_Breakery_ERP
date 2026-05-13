// apps/backoffice/src/features/print-queue/components/PrintQueueTable.tsx
// Session 13 / Phase 5.A — read-only print queue table + cancel CTA.

import { usePrintQueue, type PrintJobRow, type PrintJobStatus } from '../hooks/usePrintQueue.js';
import { useCancelPrintJob } from '../hooks/useCancelPrintJob.js';
import { Button } from '@breakery/ui';

interface PrintQueueTableProps {
  statuses?: readonly PrintJobStatus[];
}

export function PrintQueueTable({ statuses }: PrintQueueTableProps) {
  const opts = statuses !== undefined ? { statuses } : {};
  const { data, isLoading, error } = usePrintQueue(opts);
  const cancel = useCancelPrintJob();

  if (isLoading) {
    return <div className="text-sm text-text-secondary">Loading print queue…</div>;
  }
  if (error !== null) {
    return (
      <div className="text-sm text-state-danger">
        Failed to load print queue: {(error as Error).message}
      </div>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return <div className="text-sm text-text-secondary">No active print jobs.</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
        <tr>
          <th className="py-2 text-left">Queued</th>
          <th className="py-2 text-left">Source</th>
          <th className="py-2 text-left">Reference</th>
          <th className="py-2 text-right">Priority</th>
          <th className="py-2 text-right">Retries</th>
          <th className="py-2 text-left">Status</th>
          <th className="py-2 text-left">Error</th>
          <th className="py-2 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <PrintQueueRow
            key={row.id}
            row={row}
            onCancel={() => { cancel.mutate(row.id); }}
            isCancelling={cancel.isPending && cancel.variables === row.id}
          />
        ))}
      </tbody>
    </table>
  );
}

function PrintQueueRow({
  row, onCancel, isCancelling,
}: {
  row: PrintJobRow;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  const canCancel = row.status === 'queued' || row.status === 'failed';
  return (
    <tr className="border-b border-border-subtle">
      <td className="py-2 font-mono text-xs">{new Date(row.queued_at).toLocaleString()}</td>
      <td className="py-2">{row.source ?? '—'}</td>
      <td className="py-2 font-mono text-xs">
        {row.reference_type !== null
          ? `${row.reference_type}:${row.reference_id?.slice(0, 8) ?? ''}…`
          : '—'}
      </td>
      <td className="py-2 text-right">{row.priority}</td>
      <td className="py-2 text-right">{row.retries}</td>
      <td className="py-2">
        <StatusBadge status={row.status} />
      </td>
      <td className="py-2 text-xs text-text-secondary truncate max-w-xs">
        {row.error_message ?? ''}
      </td>
      <td className="py-2 text-right">
        {canCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={isCancelling}>
            Cancel
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: PrintJobStatus }) {
  const colours: Record<PrintJobStatus, string> = {
    queued:    'bg-bg-overlay text-text-secondary',
    printing:  'bg-gold-soft text-gold',
    done:      'bg-state-success-soft text-state-success',
    failed:    'bg-state-danger-soft text-state-danger',
    cancelled: 'bg-bg-overlay text-text-secondary',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${colours[status]}`}>
      {status}
    </span>
  );
}
