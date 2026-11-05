import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { todayIsoDate, formatDateTimeShortWita } from '@breakery/utils';
import { formatQuantity } from '@breakery/utils';
import { Input } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';

interface DisplayReview {
  closing_id: string;
  revision: number;
  recorded_at: string;
  items: {
    product_id: string; product_name: string; unit: string; remaining_qty: number;
    waste_qty: number; waste_reason: string | null; waste_status: string | null;
    reference_basis: string; expected_qty: number; variance: number;
  }[];
  history: { revision: number; recorded_at: string; correction_reason: string | null }[];
}
const referenceLabels: Record<string, string> = {
  general: 'General stock', fresh_production: 'Fresh production of the day', display: 'Display stock',
};

export function DisplayDayReviewPanel() {
  const owner = useAuthStore((state) => state.user?.role_code === 'SUPER_ADMIN');
  const profileId = useAuthStore((state) => state.user?.id);
  const [day, setDay] = useState(todayIsoDate);
  const review = useQuery({
    queryKey: ['display-day-closing', profileId, day], enabled: owner,
    queryFn: async (): Promise<DisplayReview | null> => {
      const { data, error } = await supabase.rpc('get_display_day_closing_v1', { p_business_day: day });
      if (error) throw new Error(error.message);
      if (data === null) return null;
      if (typeof data !== 'object' || Array.isArray(data) || data.is_owner !== true || !Array.isArray(data.items)) {
        throw new Error('The owner review could not be loaded.');
      }
      return data as unknown as DisplayReview;
    },
  });
  if (!owner) return null;
  return (
    <section className="space-y-4 rounded-md border border-border-subtle p-4" aria-label="Daily display review">
      <h2 className="font-semibold">Daily display review</h2>
      <p className="text-sm text-text-secondary">Remaining counts are observations. Waste is reviewed separately in Stock declarations.</p>
      <label className="block max-w-xs text-sm">Review business day
        <Input type="date" max={todayIsoDate()} value={day} onChange={(event) => setDay(event.target.value)} />
      </label>
      {review.isLoading && <p role="status">Loading daily display count…</p>}
      {review.error && <p role="alert">{review.error.message}</p>}
      {review.isSuccess && !review.data && <p>No display count recorded for this day.</p>}
      {review.data && <>
        <p className="text-sm text-text-secondary">Revision {review.data.revision} · {formatDateTimeShortWita(review.data.recorded_at)}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recorded display leftovers, waste and confidential reference quantities</caption>
            <thead><tr>{['Product', 'Reference', 'Expected remaining', 'Counted remaining', 'Variance', 'Waste', 'Approval'].map((label) =>
              <th key={label} scope="col" className="whitespace-nowrap p-2 font-semibold">{label}</th>)}</tr></thead>
            <tbody>{review.data.items.map((item) => <tr key={item.product_id} className="border-t border-border-subtle">
              <th scope="row" className="p-2 font-medium">{item.product_name}</th>
              <td className="p-2">{referenceLabels[item.reference_basis] ?? item.reference_basis}</td>
              <td className="p-2 font-mono">{formatQuantity(item.expected_qty, item.unit)}</td>
              <td className="p-2 font-mono">{formatQuantity(item.remaining_qty, item.unit)}</td>
              <td className="p-2 font-mono">{formatQuantity(item.variance, item.unit)}</td>
              <td className="p-2">{formatQuantity(item.waste_qty, item.unit)}{item.waste_reason && <span className="block text-text-secondary">{item.waste_reason}</span>}</td>
              <td className="p-2">{item.waste_status ?? 'No waste declared'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <details className="text-sm"><summary className="cursor-pointer">Count history</summary>
          <ul className="mt-2 space-y-1">{review.data.history.map((entry) => <li key={entry.revision}>
            Revision {entry.revision} · {formatDateTimeShortWita(entry.recorded_at)}{entry.correction_reason && ` · ${entry.correction_reason}`}
          </li>)}</ul>
        </details>
      </>}
    </section>
  );
}
