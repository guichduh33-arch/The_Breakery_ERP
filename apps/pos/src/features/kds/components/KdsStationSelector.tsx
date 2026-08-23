// apps/pos/src/features/kds/components/KdsStationSelector.tsx
//
// Session 2 — Tabs to switch between the 3 dispatch stations.
// Persisted via `useKdsStore` (sessionStorage).

import { Tabs, TabsList, TabsTrigger } from '@breakery/ui';

import { useKdsStore, type KdsStation } from '@/stores/kdsStore';

const STATIONS: readonly { value: KdsStation; label: string }[] = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'barista', label: 'Barista' },
  // « Display » seul — « / Vitrine » était la dernière chaîne française
  // visible de la surface (langue d'interface : anglais, PRODUCT.md).
  { value: 'display', label: 'Display' },
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
      {/* Audit 2026-08-24 (responsive P1) — surcharge locale du primitif
          partagé : la commande principale du KDS se tape mains farinées et se
          lit à 2-3 m ; le h-10/text-sm du BO est trop petit ici. */}
      <TabsList className="h-14">
        {STATIONS.map(({ value, label }) => (
          <TabsTrigger key={value} value={value} className="min-h-touch-min px-4 text-base">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
