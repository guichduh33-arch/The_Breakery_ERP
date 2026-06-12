import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { JSX } from 'react';
import type { RestaurantTable } from '@breakery/domain';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';
import { ScrollArea } from '../primitives/ScrollArea.js';
import { FullScreenModal } from './FullScreenModal.js';

export type { RestaurantTable };

export interface TableSelectorModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (tableName: string | null) => void;
  tables: RestaurantTable[];
  occupancy: Record<string, boolean>;
}

const SR_ONLY = 'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

function OccupancyBadge({ occupied }: { occupied: boolean }): JSX.Element {
  return occupied ? (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-soft text-red">
      Occupied
    </span>
  ) : (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-soft text-green">
      Free
    </span>
  );
}

function TableCard({
  table,
  occupied,
  onTap,
}: {
  table: RestaurantTable;
  occupied: boolean;
  onTap: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'h-touch-large flex flex-col items-center justify-center gap-1 rounded-xl border',
        'transition-colors active:scale-95',
        occupied
          ? 'border-border-subtle bg-bg-elevated opacity-60 cursor-not-allowed'
          : 'border-border-subtle bg-bg-elevated hover:bg-bg-overlay cursor-pointer',
      )}
      onClick={onTap}
      aria-disabled={occupied}
      aria-label={`Table ${table.name}${occupied ? ', occupied' : ', free'}`}
    >
      <span className="font-mono font-bold text-lg text-text-primary">{table.name}</span>
      <span className="text-xs text-text-secondary">{table.seats} seats</span>
      <OccupancyBadge occupied={occupied} />
    </button>
  );
}

export function TableSelectorModal({
  open,
  onClose,
  onSelect,
  tables,
  occupancy,
}: TableSelectorModalProps): JSX.Element {
  function handleTap(table: RestaurantTable): void {
    const occupied = occupancy[table.name] ?? false;
    if (occupied) {
      toast.error('Table occupied');
      return;
    }
    onSelect(table.name);
    onClose();
  }

  function handleSkip(): void {
    onSelect(null);
    onClose();
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && onClose()} accessibleTitle="Pick a table">
      <DialogPrimitive.Title asChild>
        <span className={cn(SR_ONLY)}>Pick a table</span>
      </DialogPrimitive.Title>
      <DialogPrimitive.Description asChild>
        <span className={cn(SR_ONLY)}>Select a table for this dine-in order, or skip.</span>
      </DialogPrimitive.Description>

      <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <h2 className="font-serif text-xl">Pick a table</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {tables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              occupied={occupancy[table.name] ?? false}
              onTap={() => handleTap(table)}
            />
          ))}
        </div>
      </ScrollArea>

      <footer className="px-6 py-4 border-t border-border-subtle bg-bg-elevated">
        <Button variant="secondary" size="lg" className="w-full" onClick={handleSkip}>
          No table / Skip
        </Button>
      </footer>
    </FullScreenModal>
  );
}
