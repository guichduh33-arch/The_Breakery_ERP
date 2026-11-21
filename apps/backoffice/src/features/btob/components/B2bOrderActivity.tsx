// apps/backoffice/src/features/btob/components/B2bOrderActivity.tsx
//
// Section « Activity » de la fiche commande B2B : chaque geste avec sa date et
// son heure, son action, la personne et le détail. Les plus récents d'abord.

import type { JSX } from 'react';
import { formatDateTimeWita } from '@breakery/utils';
import { Button } from '@/components/BackofficeUi.js';
import { buildB2bOrderActivity } from '../b2bOrderActivity.js';
import { useB2bOrderActivity } from '../hooks/useB2bOrderActivity.js';

export function B2bOrderActivity({ orderId }: { orderId: string }): JSX.Element {
  const { canReadAudit, audit, payments } = useB2bOrderActivity(orderId);
  const loading = payments.isLoading || (canReadAudit && audit.isLoading);
  const events = buildB2bOrderActivity(audit.data ?? [], payments.data ?? []);

  return (
    <section aria-labelledby="b2b-order-activity" className="rounded-md border border-border-subtle bg-bg-elevated p-6">
      <h2 id="b2b-order-activity" className="mb-4 text-lg font-semibold">Activity</h2>
      {!canReadAudit && (
        <p className="mb-4 text-sm text-text-muted">
          Only payments are listed. Order events (creation, edits, pickup, collection) need the audit permission.
        </p>
      )}
      {(audit.isError || payments.isError) && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-danger-as-text">
          {audit.isError ? 'Order events could not be loaded.' : 'Payments could not be loaded.'}
          <Button size="sm" variant="secondary" onClick={() => {
            if (audit.isError) void audit.refetch();
            if (payments.isError) void payments.refetch();
          }}>
            Try again
          </Button>
        </div>
      )}
      {loading ? (
        <p role="status" className="text-sm text-text-muted">Loading activity…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-text-muted">No activity recorded for this order.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Date and time, action, user and details for each event on this order, most recent first</caption>
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Date &amp; time</th>
                <th scope="col" className="py-2 pr-4 font-medium">Action</th>
                <th scope="col" className="py-2 pr-4 font-medium">User</th>
                <th scope="col" className="py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border-subtle last:border-b-0 align-top">
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums text-text-secondary">
                    <time dateTime={e.at}>{formatDateTimeWita(e.at)}</time>
                  </td>
                  <td className="py-3 pr-4 font-medium text-text-primary">{e.action}</td>
                  <td className="py-3 pr-4 text-text-primary">
                    {e.person ?? <span className="text-text-muted">Not recorded</span>}
                  </td>
                  <td className="py-3 text-text-secondary">{e.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
