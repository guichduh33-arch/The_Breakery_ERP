import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatDateTimeShortWita, formatQuantity } from '@breakery/utils';
import { WASTE_REASON_LABELS } from '@/features/inventory-production/wasteReasons.js';
import { getHistory, kitchenError, type KitchenRecord } from './api.js';
import { kitchenButton, kitchenControl, FOCUS_RING } from './controls.js';

export function KitchenHistory({ userId, sectionId, today, online }: {
  userId: string; sectionId: string; today: string; online: boolean;
}) {
  const [selectedDay, setSelectedDay] = useState('');
  const day = selectedDay || today;
  const history = useInfiniteQuery({
    queryKey: ['kitchen', userId, 'history', sectionId, day], initialPageParam: null as KitchenRecord | null,
    queryFn: ({ pageParam }) => getHistory(sectionId, day, pageParam),
    getNextPageParam: (last) => last.length > 50 ? last[49] : undefined,
    enabled: online && /^\d{4}-\d{2}-\d{2}$/.test(day), retry: false,
  });
  const rows = history.data?.pages.flatMap(page => page.slice(0, 50)) ?? [];
  return <section aria-labelledby="kitchen-history-title" className="space-y-4 border-t border-border-subtle pt-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h2 id="kitchen-history-title" className="text-xl font-semibold">Production history</h2>
      <label className="flex items-center gap-3">Day
        <input type="date" className={`${kitchenControl} ${FOCUS_RING}`} value={day} max={today} onChange={e => setSelectedDay(e.target.value)} />
      </label>
    </div>
    {history.isLoading && <p role="status">Loading production…</p>}
    {history.isError && <p role="alert">{kitchenError(history.error)}</p>}
    <button className={kitchenButton} type="button" disabled={!online || history.isFetching} onClick={() => void history.refetch()}>Refresh history</button>
    {!history.isLoading && !history.isError && !rows.length && <p>No production recorded for this day.</p>}
    <ul className="divide-y divide-border-subtle">
      {rows.map(row => <li key={row.id} className="space-y-2 py-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{row.product_name}</h3>
          <span className="text-sm text-text-secondary">{formatDateTimeShortWita(row.production_date)}</span></div>
        <p className="font-data">Produced {formatQuantity(row.quantity_produced, row.unit)} · Wasted {formatQuantity(row.quantity_waste, row.unit)}</p>
        {row.waste_reason && <p>{WASTE_REASON_LABELS[row.waste_reason]}</p>}
        {row.notes && <p className="break-words">{row.notes}</p>}
        <p className="text-sm text-text-secondary">{row.author ?? 'Unknown user'} · {row.production_number}</p>
        {row.reverted_at && <p className="font-semibold text-warning">Reverted · {formatDateTimeShortWita(row.reverted_at)}</p>}
      </li>)}
    </ul>
    {history.hasNextPage && <button className={kitchenButton} type="button" disabled={!online || history.isFetchingNextPage}
      onClick={() => void history.fetchNextPage()}>Load earlier entries</button>}
  </section>;
}
