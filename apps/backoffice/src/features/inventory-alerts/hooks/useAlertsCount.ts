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
//
// PÉRIMÈTRE — arbitré le 2026-08-07, ne pas « corriger » l'écart.
// Ce compteur vaut low stock + reorder, deux faits de STOCK. Il ne vaut PAS le
// total de la file « Needs you » du dashboard (`get_dashboard_action_queue_v1`,
// 5 sources : register non clôturé, low stock, reorder, PO en attente de
// réception, B2B en retard). Les deux nombres diffèrent parce qu'ils comptent
// deux choses différentes, et la cloche doit rester alignée sur le compteur
// « Alerts » du drop-panel Stock, qui est stock-only par définition. Élargir ce
// hook aux 5 sources rendrait ce second compteur faux.

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
