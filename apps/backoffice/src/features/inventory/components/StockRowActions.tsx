// apps/backoffice/src/features/inventory/components/StockRowActions.tsx
//
// Menu d'actions d'une ligne de la liste de stock.
//
// Ce fichier portait l'implémentation du motif de menu bouton (WAI-ARIA APG).
// Elle a été extraite dans `@/components/RowActionsMenu` par la critique du
// 2026-08-31 (P1) : Orders et Products rendaient chacun leur propre grammaire
// d'icônes nues, et converger sur celle-ci ne vaut que si les trois pages
// partagent LE MÊME composant — sinon on remplace trois grammaires par une
// grammaire et deux copies qui divergeront.
//
// Ce qui reste ici est ce qui est propre à l'inventaire : l'ordre des entrées
// et les permissions qui les filtrent. Deux lectures d'abord, puis les
// écritures. « View movements » ouvre le journal en tiroir : on voit d'où vient
// le chiffre sans perdre sa place dans la liste, ni son filtre, ni sa page
// (principe produit nº 3).

import type { JSX } from 'react';
import { RowActionsMenu, type RowActionEntry } from '@/components/RowActionsMenu.js';
import type { StockLevelRow as Row } from '../hooks/useStockLevels.js';

export interface StockRowActionsProps {
  row:          Row;
  canAdjust:    boolean;
  canWaste:     boolean;
  onView:       (r: Row) => void;
  onMovements:  (r: Row) => void;
  onAdjust:     (r: Row) => void;
  onWaste:      (r: Row) => void;
}

export function StockRowActions({
  row, canAdjust, canWaste, onView, onMovements, onAdjust, onWaste,
}: StockRowActionsProps): JSX.Element | null {
  const entries: RowActionEntry[] = [
    { key: 'view',      label: 'View stock',     activate: () => { onView(row); } },
    { key: 'movements', label: 'View movements', activate: () => { onMovements(row); } },
    ...(canAdjust ? [{ key: 'adjust', label: 'Adjust stock', activate: () => { onAdjust(row); } }] : []),
    ...(canWaste  ? [{ key: 'waste',  label: 'Record waste', danger: true, activate: () => { onWaste(row); } }] : []),
  ];

  return <RowActionsMenu subject={row.name} entries={entries} />;
}
