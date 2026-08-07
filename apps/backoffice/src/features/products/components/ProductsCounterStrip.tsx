// apps/backoffice/src/features/products/components/ProductsCounterStrip.tsx
//
// Écran 2a — la bande de compteurs, qui remplace les quatre tuiles de KPI.
//
// Le changement n'est pas cosmétique : les tuiles AFFICHAIENT, ces cellules
// FILTRENT. Chacune répond à « quelles lignes dois-je regarder », et un clic
// pose la question à la table. Les deux dernières sont des compteurs de qualité
// de donnée — un produit désactivé qu'on a oublié de purger, un produit sans
// prix de revient — et ce sont eux qui justifient la bande : ils désignent du
// travail, là où « 318 produits » n'en désigne aucun.
//
// « No cost price » est en rouge parce qu'un produit sans coût n'a pas de
// marge : il disparaît silencieusement de toute analyse de rentabilité.

import type { JSX } from 'react';
import { Card, cn } from '@breakery/ui';
import type { ProductCounter, ProductsKpis } from '../types.js';

interface Props {
  kpis: ProductsKpis;
  active: ProductCounter;
  onSelect: (next: ProductCounter) => void;
  isLoading?: boolean;
}

interface Cell {
  id: ProductCounter;
  label: string;
  value: number;
  /** Compteur de défaut : la valeur se lit en rouge dès qu'elle n'est pas nulle. */
  defect?: boolean;
  muted?: boolean;
}

export function ProductsCounterStrip({
  kpis, active, onSelect, isLoading = false,
}: Props): JSX.Element {
  const cells: Cell[] = [
    { id: 'all',           label: 'All products',   value: kpis.total },
    { id: 'finished',      label: 'Finished',       value: kpis.finished },
    { id: 'semi-finished', label: 'Semi-finished',  value: kpis.semi_finished },
    { id: 'raw',           label: 'Raw materials',  value: kpis.raw_material },
    { id: 'combo',         label: 'Combos',         value: kpis.combo },
    { id: 'inactive',      label: 'Inactive',       value: kpis.inactive, muted: true },
    { id: 'no-cost',       label: 'No cost price',  value: kpis.no_cost_price, defect: true },
  ];

  return (
    <Card
      variant="default"
      padding="none"
      className="flex flex-wrap items-stretch overflow-hidden shadow-none"
      data-testid="products-counter-strip"
    >
      {cells.map((c) => {
        const isActive = c.id === active;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => { onSelect(isActive && c.id !== 'all' ? 'all' : c.id); }}
            data-testid={`counter-${c.id}`}
            className={cn(
              'flex min-w-[116px] flex-col gap-0.5 border-r border-border-muted px-[18px] py-[11px] text-left',
              'transition-colors last:border-r-0 hover:bg-surface-4',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold',
              isActive && 'bg-gold-soft shadow-[inset_2px_0_0_var(--gold-base)]',
            )}
          >
            <span className="font-data text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              {c.label}
            </span>
            <span
              className={cn(
                'font-data text-[20px] font-semibold tabular-nums',
                isLoading && 'text-text-muted',
                !isLoading && c.defect === true && c.value > 0 && 'text-danger',
                !isLoading && c.muted === true && 'text-text-muted',
                !isLoading && c.defect !== true && c.muted !== true && 'text-text-primary',
              )}
            >
              {isLoading ? '—' : c.value.toLocaleString('id-ID')}
            </span>
          </button>
        );
      })}
    </Card>
  );
}
