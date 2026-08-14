// apps/backoffice/src/features/reports/components/KpiBand.tsx
//
// Lot B (campagne Reports 2026-08-15) — la bande de KPI de l'archétype Report :
// `repeat(6,1fr)` en extra-large, marches franches en dessous. Elle porte les
// états que chaque page réimplantait : squelettes pendant le chargement (fini
// le strip qui affiche « Rp 0 » sous un « Loading… »), tirets quand la donnée
// est inconnue — un zéro affirmerait une journée sans vente.

import type { JSX, ReactNode } from 'react';
import { Card, SectionLabel, cn } from '@breakery/ui';
import {
  KPI_CARD, KPI_CARD_HERO, KPI_LABEL, KPI_LABEL_HERO,
  KPI_NOTE, KPI_NOTE_HERO, KPI_VALUE, KPI_VALUE_HERO,
} from '@/components/kpi/KpiTile.js';

export interface KpiBandProps {
  isLoading?: boolean;
  /** Échec de la requête : tuiles en tiret « unavailable », pas des zéros. */
  error?: Error | null;
  /** Nombre de tuiles attendues — pilote squelettes et tuiles indisponibles. */
  tiles?: number;
  /** Libellés des tuiles, pour la branche « unavailable » (sinon anonymes). */
  labels?: string[];
  className?: string;
  children?: ReactNode;
}

const GRID = 'grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6';

export function KpiBand({
  isLoading = false,
  error = null,
  tiles = 6,
  labels,
  className,
  children,
}: KpiBandProps): JSX.Element {
  if (!isLoading && error !== null) {
    return (
      <div className={cn(GRID, className)} data-testid="report-kpi-band">
        {Array.from({ length: tiles }).map((_, i) => (
          <Card
            key={i}
            variant="default"
            padding="none"
            className={i === 0 ? KPI_CARD_HERO : KPI_CARD}
            data-testid="kpi-unavailable"
          >
            <SectionLabel as="h3" className={i === 0 ? KPI_LABEL_HERO : KPI_LABEL}>
              {labels?.[i] ?? ' '}
            </SectionLabel>
            <span className={i === 0 ? KPI_VALUE_HERO : KPI_VALUE}>—</span>
            <div className="flex min-h-[16px] items-baseline">
              <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>unavailable</span>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cn(GRID, className)} data-testid="report-kpi-band">
        {Array.from({ length: tiles }).map((_, i) => (
          <Card
            key={i}
            variant="default"
            padding="none"
            className={cn(KPI_CARD, 'animate-pulse motion-reduce:animate-none')}
            data-testid="kpi-skeleton"
          >
            {/* surface-4 et non bg-overlay : ce dernier vaut #fff sur la carte
                blanche → squelette invisible. */}
            <div className="h-2.5 w-20 rounded bg-surface-4" />
            <div className="h-6 w-24 rounded bg-surface-4" />
            <div className="h-3 w-16 rounded bg-surface-4" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={cn(GRID, className)} data-testid="report-kpi-band">
      {children}
    </div>
  );
}
