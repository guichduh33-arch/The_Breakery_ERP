import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FOCUS_RING } from '@/components/focusRing.js';
import { Button } from '@/components/BackofficeUi.js';
import { supabase } from '@/lib/supabase.js';

export function ReleaseBusinessDay({ countId, businessDay }: { countId: string; businessDay: string }) {
  const day = businessDay;
  const [confirmed, setConfirmed] = useState(false);
  const qc = useQueryClient();
  const visibility = useQuery({
    queryKey: ['business-day-visibility', day],
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(day),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_business_day_visibility_v1', { p_day: day });
      if (error) throw new Error(error.message);
      if (typeof data !== 'object' || data === null || Array.isArray(data) || typeof data.released !== 'boolean') {
        throw new Error('Cannot verify daily sales visibility.');
      }
      return { released: data.released };
    },
  });
  const release = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('release_business_day_v1', { p_day: day, p_count_id: countId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setConfirmed(false);
      await qc.invalidateQueries();
    },
  });
  return (
    <section className="space-y-3 rounded-md border border-border-subtle p-4" aria-label="Release daily sales">
      <h2 className="font-semibold">Release daily sales</h2>
      <p className="text-sm text-text-secondary">Release product sales after all registers are closed and this independent count is finalized. This decision is recorded in your name.</p>
      <label className="block text-sm" htmlFor="sales-release-day">Business day</label>
      <input id="sales-release-day" type="date" value={day} readOnly
        className={`${FOCUS_RING} rounded border border-border-strong bg-bg-input p-2`} />
      {(visibility.error ?? release.error) && <p role="alert">{(visibility.error ?? release.error)?.message}</p>}
      {visibility.data?.released ? <p role="status">Sales have been released for this day.</p> : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input className={FOCUS_RING} type="checkbox" checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); }} />
            I confirm that counting and register closing are complete for this business day.
          </label>
          <Button variant="secondary" disabled={!confirmed || visibility.isFetching || !!visibility.error || release.isPending}
            onClick={() => { release.mutate(); }}>{release.isPending ? 'Releasing…' : 'Release product sales'}</Button>
        </>
      )}
    </section>
  );
}
