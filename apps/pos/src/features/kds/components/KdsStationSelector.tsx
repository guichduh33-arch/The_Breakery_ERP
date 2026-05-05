// apps/pos/src/features/kds/components/KdsStationSelector.tsx
//
// Session 2 — Tabs to switch between the 3 dispatch stations.
// Persisted via `useKdsStore` (sessionStorage).

import { Tabs, TabsList, TabsTrigger } from '@breakery/ui';

import { useKdsStore, type KdsStation } from '@/stores/kdsStore';

const STATIONS: readonly { value: KdsStation; label: string }[] = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'barista', label: 'Barista' },
  { value: 'bakery', label: 'Bakery' },
];

export function KdsStationSelector() {
  const station = useKdsStore((s) => s.selectedStation);
  const setStation = useKdsStore((s) => s.setStation);

  return (
    <Tabs
      value={station}
      onValueChange={(value) => {
        setStation(value as KdsStation);
      }}
    >
      <TabsList>
        {STATIONS.map(({ value, label }) => (
          <TabsTrigger key={value} value={value}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
