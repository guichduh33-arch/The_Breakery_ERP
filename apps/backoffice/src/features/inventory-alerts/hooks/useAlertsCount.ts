// apps/backoffice/src/features/inventory-alerts/hooks/useAlertsCount.ts
//
// Refonte shell 2026-08-05 — le compte d'alertes stock, partagé.
//
// La cloche de la top bar et le compteur du lien « Alerts » du drop-panel Stock
// doivent afficher LE MÊME nombre : deux compteurs qui divergent en font douter
// des deux. Ce hook est l'unique source, les deux consommateurs s'y branchent.
//
// Il n'est pas gaté ici : ses deux appelants sont eux-mêmes rendus sous
// `hasPermission('inventory.read')`, comme l'ancien AlertsBadge du sidebar.

import { useLowStock } from './useLowStock.js';
import { useReorderSuggestions } from './useReorderSuggestions.js';

export interface AlertsCount {
  lowStock: number;
  reorder: number;
  total: number;
  isLoading: boolean;
}

export function useAlertsCount(): AlertsCount {
  const low = useLowStock(null);
  const reorder = useReorderSuggestions(30, 14);

  const lowStock = low.data?.length ?? 0;
  const reorderCount = reorder.data?.length ?? 0;

  return {
    lowStock,
    reorder: reorderCount,
    total: lowStock + reorderCount,
    isLoading: low.isLoading || reorder.isLoading,
  };
}
