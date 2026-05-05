import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button, TableSelectorModal } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';
import { useRestaurantTables } from '../hooks/useRestaurantTables';
import { useTableOccupancy } from '../hooks/useTableOccupancy';

export function TableSelectorButton() {
  const [open, setOpen] = useState(false);
  const tableNumber = useCartStore((s) => s.cart.tableNumber);
  const setTableNumber = useCartStore((s) => s.setTableNumber);
  const { data: tables = [] } = useRestaurantTables();
  const occupancy = useTableOccupancy();

  const label = tableNumber ? `Table: ${tableNumber}` : 'Pick table';

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="w-full text-left justify-start gap-2"
        onClick={() => setOpen(true)}
      >
        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
        {label}
      </Button>
      <TableSelectorModal
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(name) => { setTableNumber(name); }}
        tables={tables}
        occupancy={occupancy}
      />
    </>
  );
}
