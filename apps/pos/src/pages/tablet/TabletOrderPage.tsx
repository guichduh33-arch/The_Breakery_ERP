import { useState, type JSX } from 'react';
import { Button, TableSelectorModal } from '@breakery/ui';
import { MapPin } from 'lucide-react';
import { CategorySidebar } from '@/features/products/CategorySidebar';
import { TabletProductGrid } from '@/features/tablet/components/TabletProductGrid';
import { TabletCartPanel } from '@/features/tablet/components/TabletCartPanel';
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

  return (
    <div className="flex h-full">
      <CategorySidebar selectedSlug={selectedSlug} onSelect={setSelectedSlug} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-bg-elevated">
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            onClick={() => setTableModalOpen(true)}
          >
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            {tableNumber ? `Table: ${tableNumber}` : 'Pick table'}
          </Button>
          <div className="flex rounded-md border border-border-subtle overflow-hidden text-sm">
            <button
              className={`px-3 py-1.5 ${orderType === 'dine_in' ? 'bg-gold text-bg-base font-semibold' : 'text-text-secondary hover:text-text-primary'}`}
              onClick={() => setOrderType('dine_in')}
            >
              Dine in
            </button>
            <button
              className={`px-3 py-1.5 ${orderType === 'take_out' ? 'bg-gold text-bg-base font-semibold' : 'text-text-secondary hover:text-text-primary'}`}
              onClick={() => setOrderType('take_out')}
            >
              Take out
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">
          <TabletProductGrid selectedSlug={selectedSlug} />
        </div>
      </div>

      <TabletCartPanel />

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
