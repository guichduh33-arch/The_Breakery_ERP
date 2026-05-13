// apps/backoffice/src/features/marketing/components/BirthdayList.tsx
//
// Two-column display : upcoming birthday customers + recent notification
// log. Pure presentational ; the page wires the hooks.
//
// Session 13 / Phase 6.B.

import type { BirthdayCustomer, BirthdayLogRow } from '../hooks/useBirthdayCustomers.js';

export interface BirthdayListProps {
  upcoming:  readonly BirthdayCustomer[];
  log:       readonly BirthdayLogRow[];
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function BirthdayList({ upcoming, log }: BirthdayListProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Upcoming */}
      <section aria-labelledby="upcoming-birthdays-heading">
        <h2 id="upcoming-birthdays-heading" className="text-sm font-medium uppercase tracking-widest text-text-secondary mb-3">
          Upcoming birthdays (next 30 days)
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-text-secondary" role="status">
            No upcoming birthdays in the next 30 days.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle border border-border-subtle rounded-md">
            {upcoming.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <div className="text-sm text-text-primary">{c.name}</div>
                  <div className="text-xs text-text-secondary">
                    {c.email ?? <span className="italic">(no email)</span>}
                    {' · '}
                    {c.marketing_consent
                      ? <span className="text-info">opted in</span>
                      : <span className="text-warn">no consent</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono tabular-nums">{formatDate(c.birth_date)}</div>
                  <div className="text-xs text-text-secondary">
                    {c.days_until_birthday === 0
                      ? 'today'
                      : `in ${c.days_until_birthday}d`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent log */}
      <section aria-labelledby="birthday-log-heading">
        <h2 id="birthday-log-heading" className="text-sm font-medium uppercase tracking-widest text-text-secondary mb-3">
          Recent notifications
        </h2>
        {log.length === 0 ? (
          <p className="text-sm text-text-secondary" role="status">
            No birthday notifications yet.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle border border-border-subtle rounded-md">
            {log.map((row) => (
              <li key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <div className="text-text-primary">{row.recipient}</div>
                  <div className="text-xs text-text-secondary">
                    Scheduled {formatDate(row.scheduled_for)}
                    {row.sent_at !== null && row.sent_at !== ''
                      ? ` · sent ${formatDate(row.sent_at)}`
                      : ''}
                  </div>
                </div>
                <span
                  className={
                    row.status === 'sent'
                      ? 'text-xs px-2 py-0.5 rounded-md bg-info/20 text-info'
                      : row.status === 'queued' || row.status === 'retry'
                      ? 'text-xs px-2 py-0.5 rounded-md bg-warn/20 text-warn'
                      : 'text-xs px-2 py-0.5 rounded-md bg-bg-overlay text-text-secondary'
                  }
                >
                  {row.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
