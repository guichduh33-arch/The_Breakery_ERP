// apps/pos/src/features/tables/components/TableSelectorButton.tsx
//
// Session 14 — Phase 2.D — Now opens the rich FloorPlanModal (sections +
// circles + status badges) instead of the legacy grid TableSelectorModal.
// The legacy modal lives in @breakery/ui and is still used by the tablet
// shell, so it stays — we just switch the POS-shell entry point.

import { useState, type ComponentProps } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useRestaurantTables } from '../hooks/useRestaurantTables';
import { useTableOccupancy } from '../hooks/useTableOccupancy';
import { FloorPlanModal } from '@/features/floor-plan/FloorPlanModal';

interface TableSelectorButtonProps {
  /** When provided, replaces the default styling (e.g. for the bottom bar). */
  className?: string;
  variant?: ComponentProps<typeof Button>['variant'];
}

export function TableSelectorButton({ className, variant }: TableSelectorButtonProps = {}) {
  const [open, setOpen] = useState(false);
  const tableNumber = useCartStore((s) => s.cart.tableNumber);
  const setTableNumber = useCartStore((s) => s.setTableNumber);
  const { data: tables = [] } = useRestaurantTables();
  const occupancy = useTableOccupancy();

  const label = tableNumber ? `Table: ${tableNumber}` : 'Pick table';

  return (
    <>
      <Button
        variant={variant ?? 'secondary'}
        size="sm"
        className={className ?? 'w-full text-left justify-start gap-2'}
        onClick={() => setOpen(true)}
        data-testid="pos-table-selector-trigger"
      >
        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
        {label}
      </Button>
      <FloorPlanModal
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(name) => { setTableNumber(name); }}
        tables={tables}
        occupancy={occupancy}
        initialSelection={tableNumber ?? null}
      />
    </>
  );
}
