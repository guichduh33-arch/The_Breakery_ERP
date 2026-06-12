// apps/backoffice/src/pages/inventory/AlertsPage.tsx
// Session 14 / Phase 4.C — alerts page (low / reorder / production), rewritten
// against the Stock & Inventory screenshot family. Uses the shared Tabs
// primitive plus a counts-based KPI tile row at the top so managers see the
// shape of attention work at a glance.

import { useMemo, type JSX } from 'react';
import { AlertTriangle, PackageX, ShoppingCart, Wheat } from 'lucide-react';
import {
  KpiTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@breakery/ui';
import { useLowStock } from '@/features/inventory-alerts/hooks/useLowStock.js';
import { LowStockTab } from '@/features/inventory-alerts/components/LowStockTab.js';
import { ReorderTab } from '@/features/inventory-alerts/components/ReorderTab.js';
import { ProductionAlertsTab } from '@/features/inventory-alerts/components/ProductionAlertsTab.js';

export default function AlertsPage(): JSX.Element {
  const lowStock = useLowStock(null);

  const counts = useMemo(() => {
    const rows = lowStock.data ?? [];
    let critical = 0;
    let totalShortfall = 0;
    for (const r of rows) {
      if (r.current_qty <= 0) critical += 1;
      totalShortfall += Number(r.shortfall);
    }
    return { total: rows.length, critical, totalShortfall: Math.round(totalShortfall * 100) / 100 };
  }, [lowStock.data]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-text-primary">Inventory alerts</h1>
        <p className="mt-1 text-sm text-text-secondary">
          What to restock, reorder, and produce — pulled from the movements ledger,
          section_stock cache, and active stock_lots.
        </p>
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        aria-label="Alert counts"
      >
        <KpiTile
          label="Low stock products"
          value={counts.total}
          icon={AlertTriangle}
          footer={lowStock.isLoading ? 'Loading…' : `${counts.critical} at zero`}
        />
        <KpiTile
          label="Shortfall units"
          value={counts.totalShortfall}
          icon={PackageX}
          footer="Sum across all low-stock SKUs"
        />
        <KpiTile
          label="Status"
          value={
            lowStock.error !== null ? 'Unavailable'
            : counts.total === 0    ? 'All clear'
            :                         'Action needed'
          }
          icon={ShoppingCart}
          footer={lowStock.error !== null ? 'Failed to load — check console / retry' : undefined}
        />
      </section>

      <Tabs defaultValue="low">
        <TabsList>
          <TabsTrigger value="low" className="gap-2">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Low stock
          </TabsTrigger>
          <TabsTrigger value="reorder" className="gap-2">
            <ShoppingCart className="h-3.5 w-3.5" aria-hidden /> Reorder
          </TabsTrigger>
          <TabsTrigger value="production" className="gap-2">
            <Wheat className="h-3.5 w-3.5" aria-hidden /> Production
          </TabsTrigger>
        </TabsList>

        <TabsContent value="low" className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
          <LowStockTab />
        </TabsContent>
        <TabsContent value="reorder" className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
          <ReorderTab />
        </TabsContent>
        <TabsContent value="production" className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
          <ProductionAlertsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
