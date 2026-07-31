import { KpiTile } from '@breakery/ui';
import { Banknote, ShoppingBag, Wallet } from 'lucide-react';

// The Backoffice Dashboard tile row — currency (mono), number (Fraunces),
// currency with a down delta. Deltas up/down/hint exercised.
export const DashboardTiles = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-4">
    <KpiTile
      className="w-80"
      label="Today's revenue"
      value={4850000}
      valueFormat="currency"
      icon={Banknote}
      delta={{ value: '12%', direction: 'up', hint: 'vs yesterday' }}
    />
    <KpiTile
      className="w-80"
      label="Orders"
      value={128}
      valueFormat="number"
      icon={ShoppingBag}
      delta={{ value: 9, direction: 'up', hint: 'vs yesterday' }}
    />
    <KpiTile
      className="w-80"
      label="Avg basket"
      value={37900}
      valueFormat="currency"
      icon={Wallet}
      delta={{ value: '4%', direction: 'down', hint: 'vs last week' }}
    />
  </div>
);

// Minimal + extremes — no icon, neutral delta, percent format, footer slot.
export const PercentAndFooter = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-4">
    <KpiTile
      className="w-80"
      label="Gross margin"
      value={62}
      valueFormat="percent"
      delta={{ value: '0.4', direction: 'neutral', hint: 'vs last week' }}
      footer="Bakery + beverages, before wastage"
    />
    <KpiTile className="w-80" label="Customers" value={214} />
  </div>
);
