// apps/pos/src/features/kds/components/StationFilter.tsx
//
// Session 13 / Phase 4.B — granular KDS station chip picker.
// Critique run 3 (distill) : les chips sont DÉRIVÉES DES DONNÉES. La rangée ne
// rend que lorsque les tickets chargés portent au moins deux `kds_station`
// distinctes. Avec un catalogue uniforme (constat 2026-08-14 : toutes les
// catégories sont 'expo'), 5 chips sur 6 filtraient vers un tableau vide et
// l'en-tête cumulait 9 contrôles de filtrage pour une seule question. Le jour
// où le back-office différencie les stations, les chips réapparaissent
// d'elles-mêmes, limitées aux valeurs réellement présentes.
//
// The filter stays CLIENT-SIDE — the server query in `useKdsOrders` filters by
// `dispatch_station`; items are then narrowed to the chosen `kds_station`
// (resolved via the joined `categories.kds_station` column) by the parent
// KDS page.

import { useEffect } from 'react';
import { Button } from '@breakery/ui';

import { useKdsStore, type KdsStationFilter } from '@/stores/kdsStore';

interface ChipDef {
  value: Exclude<KdsStationFilter, 'all'>;
  label: string;
  aria: string;
}

const CHIPS: readonly ChipDef[] = [
  { value: 'hot',  label: 'Hot',   aria: 'Filter to hot kitchen items' },
  { value: 'cold', label: 'Cold',  aria: 'Filter to cold prep items' },
  { value: 'bar',  label: 'Bar',   aria: 'Filter to bar items' },
  { value: 'prep', label: 'Prep',  aria: 'Filter to prep/bakery items' },
  { value: 'expo', label: 'Expo',  aria: 'Filter to expedite/pickup items' },
];

export interface StationFilterProps {
  /** Distinct non-null `kds_station` values among the loaded tickets. */
  presentStations: ReadonlySet<string>;
}

export function StationFilter({ presentStations }: StationFilterProps) {
  const value = useKdsStore((s) => s.kdsStationFilter);
  const setFilter = useKdsStore((s) => s.setKdsStationFilter);

  const shown = CHIPS.filter((chip) => presentStations.has(chip.value));

  // Un filtre actif dont la chip a disparu (ticket servi, changement d'onglet)
  // viderait le tableau sans aucun contrôle visible pour l'expliquer — retour
  // à 'all' dès que la valeur active n'existe plus dans les données.
  useEffect(() => {
    if (value !== 'all' && !presentStations.has(value)) setFilter('all');
  }, [value, presentStations, setFilter]);

  // Une seule station présente (ou aucune) : filtrer n'a aucun sens, la rangée
  // disparaît entièrement.
  if (shown.length < 2) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="KDS station filter"
    >
      {[{ value: 'all' as const, label: 'All', aria: 'Show all KDS stations' }, ...shown].map(
        (chip) => {
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
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-overlay'
              }
            >
              {chip.label}
            </Button>
          );
        },
      )}
    </div>
  );
}
