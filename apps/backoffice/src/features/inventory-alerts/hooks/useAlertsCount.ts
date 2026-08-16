// apps/backoffice/src/features/inventory-alerts/hooks/useAlertsCount.ts
//
// Refonte shell 2026-08-05 — le compte d'alertes stock du drop-panel.
//
// PÉRIMÈTRE — ce compteur vaut low stock + reorder, deux faits de STOCK, et
// c'est tout ce qu'il doit valoir : il chiffre le lien « Alerts » de la colonne
// Watch du panneau Stock, dont la destination est stock-only par définition.
// L'élargir à d'autres familles de faits rendrait CE compteur-ci faux.
//
// Il est désormais le SEUL compteur d'attention du shell : la file « Needs you »
// et la cloche de la top bar qui en portait le total ont été retirées de la
// conception le 2026-08-08. Aucun autre nombre ne peut donc le contredire.
//
// Il n'est pas gaté ici : son appelant est lui-même rendu sous
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
  const low = useLowStock();
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
