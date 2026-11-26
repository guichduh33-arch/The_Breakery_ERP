// Section « Activity » de la fiche bon de commande : chaque geste avec sa date
// et son heure, son action, la personne et le détail. Les plus récents d'abord.

import type { JSX } from 'react';
import { formatDateTimeWita } from '@breakery/utils';
import { Button, Card } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { buildPoActivity } from '../poActivity.js';
import { usePoActivity } from '../hooks/usePoActivity.js';

export function PoActivityCard({ poId, grnIds }: { poId: string; grnIds: readonly string[] }): JSX.Element {
  const { canReadAudit, audit } = usePoActivity(poId, grnIds);
  const events = buildPoActivity(audit.data ?? []);

  return (
    <Card variant="default" padding="md" className="space-y-3">
      <SectionLabel as="h2" size="sm" id="po-activity-heading" className="text-gold">Activity</SectionLabel>
      {!canReadAudit ? (
        <p className="text-sm text-text-muted">
          The activity log needs the audit permission. Payments stay listed in the payment card.
        </p>
      ) : audit.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger-as-text">
          The activity log could not be loaded.
          <Button size="sm" variant="secondary" onClick={() => { void audit.refetch(); }}>Try again</Button>
        </div>
      ) : audit.isLoading ? (
        <p role="status" className="text-sm text-text-muted">Loading activity…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-text-muted">No activity recorded for this purchase order.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-labelledby="po-activity-heading" data-testid="po-activity-table">
            <caption className="sr-only">Date and time, action, user and details for each event on this purchase order, most recent first</caption>
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
                  <td className="whitespace-nowrap py-3 pr-4 font-data tabular-nums text-text-secondary">
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
    </Card>
  );
}
