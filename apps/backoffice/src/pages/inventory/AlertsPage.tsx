// apps/backoffice/src/pages/inventory/AlertsPage.tsx
// Session 13 / Phase 2.D — 3-tab alerts page (Low Stock / Reorder / Production).

import { useState } from 'react';
import { cn } from '@breakery/ui';
import { LowStockTab } from '@/features/inventory-alerts/components/LowStockTab.js';
import { ReorderTab } from '@/features/inventory-alerts/components/ReorderTab.js';
import { ProductionAlertsTab } from '@/features/inventory-alerts/components/ProductionAlertsTab.js';

type Tab = 'low' | 'reorder' | 'production';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'low',        label: 'Low stock' },
  { key: 'reorder',    label: 'Reorder suggestions' },
  { key: 'production', label: 'Production' },
];

export default function AlertsPage() {
  const [active, setActive] = useState<Tab>('low');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-serif text-text-primary">Inventory alerts</h1>
        <p className="text-sm text-text-secondary">
          What to restock, reorder, and produce — pulled from the movements ledger,
          section_stock cache, and active stock_lots.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border-subtle" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => { setActive(t.key); }}
            className={cn(
              'px-4 py-2 text-sm border-b-2 -mb-px',
              active === t.key
                ? 'border-gold text-gold font-medium'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {active === 'low' && <LowStockTab />}
        {active === 'reorder' && <ReorderTab />}
        {active === 'production' && <ProductionAlertsTab />}
      </div>
    </div>
  );
}
