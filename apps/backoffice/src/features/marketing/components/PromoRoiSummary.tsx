// apps/backoffice/src/features/marketing/components/PromoRoiSummary.tsx
//
// Renders a single promo ROI summary card. Documents the
// `incremental_revenue` proxy on the card itself so operators
// understand the limitation (see D-W6-6B-05).
//
// Session 13 / Phase 6.B.

import { Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';
import type { PromoRoi } from '../hooks/usePromoRoi.js';

export interface PromoRoiSummaryProps {
  data: PromoRoi;
}

interface StatRowProps {
  label:   string;
  value:   string | number;
  hint?:   string;
  emphasis?: boolean;
}

function StatRow({ label, value, hint, emphasis = false }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-border-subtle last:border-0">
      <div>
        <div className={`text-sm ${emphasis ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
          {label}
        </div>
        {hint !== undefined && <div className="text-xs text-text-secondary mt-0.5">{hint}</div>}
      </div>
      <div className={`font-mono tabular-nums ${emphasis ? 'text-base text-text-primary font-semibold' : 'text-sm text-text-primary'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

export function PromoRoiSummary({ data }: PromoRoiSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-3">
          <span>{data.name}</span>
          <span className="font-mono text-xs uppercase tracking-widest text-text-secondary">
            {data.code}
          </span>
        </CardTitle>
        <div className="text-xs text-text-secondary">
          Period : <span className="font-mono">{data.period.start}</span> →{' '}
          <span className="font-mono">{data.period.end}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <StatRow label="Redemptions" value={data.redemptions} hint="Promotion-application rows" />
        <StatRow label="Orders touched" value={data.incremental_orders} />
        <StatRow label="Total discount given" value={data.total_discount_given} hint="IDR" />
        <StatRow label="Revenue on flagged orders" value={data.total_revenue} hint="IDR" />
        <StatRow
          label="Net revenue (proxy)"
          value={data.incremental_revenue}
          hint="Revenue minus discount"
          emphasis
        />
        <StatRow
          label="ROI %"
          value={`${data.roi_pct.toFixed(2)}%`}
          hint="((net revenue − discount cost) ÷ discount cost) × 100"
          emphasis
        />
        <p className="pt-3 text-xs text-text-secondary italic">
          ROI is a proxy. True incrementality would require a control-group experiment.
          See deviation D-W6-6B-05.
        </p>
      </CardContent>
    </Card>
  );
}
