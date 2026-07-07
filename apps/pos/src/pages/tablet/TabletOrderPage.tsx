import { useState, type JSX } from 'react';
import { Button, TableSelectorModal } from '@breakery/ui';
import { MapPin } from 'lucide-react';
import { TabletCartPanel } from '@/features/tablet/components/TabletCartPanel';
import { TabletMenuView } from '@/features/tablet/components/TabletMenuView';
import { OfflineBanner } from '@/features/tablet/components/OfflineBanner';
import { OrderTypeToggle } from '@/features/tablet/components/OrderTypeToggle';
import { useTabletOffline } from '@/features/tablet/hooks/useTabletOffline';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useRestaurantTables } from '@/features/tables/hooks/useRestaurantTables';
import { useTableOccupancy } from '@/features/tables/hooks/useTableOccupancy';

export default function TabletOrderPage(): JSX.Element {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  const setTableNumber = useTabletCartStore((s) => s.setTableNumber);
  const orderType = useTabletCartStore((s) => s.orderType);
  const setOrderType = useTabletCartStore((s) => s.setOrderType);
  const { data: tables = [] } = useRestaurantTables();
  const occupancy = useTableOccupancy();

  // Phase 4.D — offline polish.
  const { isOnline, lastSync } = useTabletOffline();

  const toolbar = (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-bg-elevated">
      <Button
        variant="secondary"
        size="md"
        className="gap-2"
        onClick={() => setTableModalOpen(true)}
        disabled={!isOnline}
      >
        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
        {tableNumber ? `Table: ${tableNumber}` : 'Pick table'}
      </Button>
      <OrderTypeToggle value={orderType} onChange={setOrderType} />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <OfflineBanner isOnline={isOnline} lastSync={lastSync} />
      <div className="flex flex-1 overflow-hidden">
        <TabletMenuView
          selectedSlug={selectedSlug}
          onSelectCategory={setSelectedSlug}
          toolbar={toolbar}
        />
        <TabletCartPanel />
      </div>
      <TableSelectorModal
        open={tableModalOpen}
        onClose={() => setTableModalOpen(false)}
        onSelect={(name) => { setTableNumber(name); setTableModalOpen(false); }}
        tables={tables}
        occupancy={occupancy}
      />
    </div>
  );
}
