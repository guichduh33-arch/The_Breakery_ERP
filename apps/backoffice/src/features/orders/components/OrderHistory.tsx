import type { JSX } from 'react';
import { formatDateTimeWita } from '@breakery/utils';
import { Button } from '@/components/BackofficeUi.js';
import { buildOrderHistory } from '../orderHistory.js';
import { useOrderHistory } from '../hooks/useOrderHistory.js';
import type { OrderDetail } from '../hooks/useOrderDetail.js';

export function OrderHistory({ order }: { order: OrderDetail }): JSX.Element {
  const query = useOrderHistory(order);
  const events = buildOrderHistory(order, query.data?.pages.flat() ?? []);
  return (
    <div className="mt-3 space-y-3">
      {query.isLoading && <p role="status" className="text-sm text-text-muted">Loading activity…</p>}
      {query.isError && (
        <div role="alert" className="text-sm text-danger-as-text">
          Detailed activity could not be loaded.
          <Button size="sm" variant="secondary" onClick={() => { void query.refetch(); }}>Retry activity</Button>
        </div>
      )}
      <ol className="space-y-3" aria-label="Order activity">
        {events.map((event) => (
          <li key={event.id} className="border-l border-border-strong pl-3">
            <p className={`text-sm ${event.pending ? 'text-text-muted' : 'text-text-primary'}`}>{event.label}</p>
            {event.detail && <p className="text-xs text-text-secondary">{event.detail}</p>}
            {!event.pending && (
              <>
                <p className="font-data text-xs tabular-nums text-text-muted">
                  {event.at ? <time dateTime={event.at}>{formatDateTimeWita(event.at)}</time> : 'Time not recorded'}
                </p>
                <p className="text-xs text-text-secondary">{event.person ?? 'Person not recorded'}</p>
                {event.participants?.map((person) => <p key={person} className="text-xs text-text-secondary">{person}</p>)}
              </>
            )}
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <Button size="sm" variant="secondary" disabled={query.isFetchingNextPage}
          onClick={() => { void query.fetchNextPage(); }}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more activity'}
        </Button>
      )}
    </div>
  );
}
