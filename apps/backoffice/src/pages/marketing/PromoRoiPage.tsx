// apps/backoffice/src/pages/marketing/PromoRoiPage.tsx
//
// Session 13 / Phase 6.B — ROI summary for a chosen promotion + date range.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@breakery/ui';
import { toLocalDateStr } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { PromoRoiSummary } from '@/features/marketing/components/PromoRoiSummary.js';
import { usePromoRoi } from '@/features/marketing/hooks/usePromoRoi.js';

interface PromotionOption {
  id:   string;
  name: string;
  slug: string;
}

function usePromotionOptions() {
  return useQuery<PromotionOption[]>({
    queryKey: ['marketing', 'promo-options'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('promotions')
        .select('id, name, slug, is_active')
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<PromotionOption & { is_active: boolean }>)
        .map(({ id, name, slug }) => ({ id, name, slug }));
    },
  });
}

function thirtyDaysAgoStr(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return toLocalDateStr(d);
}

export default function PromoRoiPage() {
  const todayStr = toLocalDateStr(new Date());
  const [dateStart, setDateStart] = useState<string>(thirtyDaysAgoStr());
  const [dateEnd,   setDateEnd]   = useState<string>(todayStr);
  const [promoId,   setPromoId]   = useState<string>('');

  const { data: promos, isLoading: promosLoading } = usePromotionOptions();
  const { data: roi,    isLoading: roiLoading,   error } = usePromoRoi(
    promoId === '' ? null : promoId,
    dateStart,
    dateEnd,
  );

  return (
    <ReportPage
      title="Promotion ROI"
      subtitle="Discount cost, revenue on flagged orders, and an ROI proxy per promotion. See D-W6-6B-05 for incrementality caveats."
      filters={
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            <span>Promotion</span>
            <select
              value={promoId}
              onChange={(e) => setPromoId(e.target.value)}
              className="h-9 px-2 rounded-md border border-border-subtle bg-bg-elevated text-sm"
              aria-label="Promotion"
            >
              <option value="">— select promotion —</option>
              {(promos ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            <span>From</span>
            <Input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="h-9 w-40"
              aria-label="Date start"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            <span>To</span>
            <Input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="h-9 w-40"
              aria-label="Date end"
            />
          </label>
        </div>
      }
    >
      {promosLoading && <p className="text-sm text-text-secondary">Loading promotions…</p>}
      {promoId === '' && (
        <p className="text-sm text-text-secondary" role="status">
          Pick a promotion to see its ROI.
        </p>
      )}
      {roiLoading && promoId !== '' && (
        <p className="text-sm text-text-secondary">Computing ROI…</p>
      )}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load ROI.'}
        </p>
      )}
      {roi !== undefined && roi !== null && promoId !== '' && (
        <PromoRoiSummary data={roi} />
      )}
    </ReportPage>
  );
}
