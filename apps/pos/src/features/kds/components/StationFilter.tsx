// apps/pos/src/features/kds/components/StationFilter.tsx
//
// Session 13 / Phase 4.B — granular KDS station chip picker.
//
// Renders 6 toggleable chips ('all', 'hot', 'cold', 'bar', 'prep', 'expo')
// driven by `useKdsStore.kdsStationFilter`. The filter is CLIENT-SIDE — the
// server query in `useKdsOrders` still filters by `dispatch_station`. Items
// are then narrowed to the chosen `kds_station` (resolved via the joined
// `categories.kds_station` column) by the parent KDS page.
//
// Tokens : uses `bg-bg-elevated`, `text-text-secondary`, `bg-amber-warn`
// per the design tokens from Phase 1.D.

import { Button } from '@breakery/ui';

import { useKdsStore, type KdsStationFilter } from '@/stores/kdsStore';

interface ChipDef {
  value: KdsStationFilter;
  label: string;
  aria: string;
}

const CHIPS: readonly ChipDef[] = [
  { value: 'all',  label: 'All',   aria: 'Show all KDS stations' },
  { value: 'hot',  label: 'Hot',   aria: 'Filter to hot kitchen items' },
  { value: 'cold', label: 'Cold',  aria: 'Filter to cold prep items' },
  { value: 'bar',  label: 'Bar',   aria: 'Filter to bar items' },
  { value: 'prep', label: 'Prep',  aria: 'Filter to prep/bakery items' },
  { value: 'expo', label: 'Expo',  aria: 'Filter to expedite/pickup items' },
];

export function StationFilter() {
  const value = useKdsStore((s) => s.kdsStationFilter);
  const setFilter = useKdsStore((s) => s.setKdsStationFilter);

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="KDS station filter"
    >
      {CHIPS.map((chip) => {
        const active = value === chip.value;
        return (
          <Button
            key={chip.value}
            size="md"
            variant={active ? 'primary' : 'secondary'}
            aria-pressed={active}
            aria-label={chip.aria}
            onClick={() => setFilter(chip.value)}
            className={
              active
                ? 'shadow-sm'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-muted'
            }
          >
            {chip.label}
          </Button>
        );
      })}
    </div>
  );
}
