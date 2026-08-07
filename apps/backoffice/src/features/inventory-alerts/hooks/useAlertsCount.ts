// apps/backoffice/src/features/inventory-alerts/hooks/useAlertsCount.ts
//
// Refonte shell 2026-08-05 — le compte d'alertes stock du drop-panel.
//
// PÉRIMÈTRE — ce compteur vaut low stock + reorder, deux faits de STOCK, et
// c'est tout ce qu'il doit valoir : il chiffre le lien « Alerts » de la colonne
// Watch du panneau Stock, dont la destination est stock-only par définition.
// Élargir ce hook aux cinq sources de la file « Needs you » rendrait CE
// compteur-ci faux.
//
// La cloche de la top bar, elle, ne consomme PLUS ce hook (arbitrage du
// 2026-08-07, contre la première implémentation) : elle porte le total de la
// file, via `useActionQueue`. Les deux nombres diffèrent donc légitimement —
// mais ils ne sont plus jamais côte à côte, et chacun est chiffré à l'endroit
// où sa destination est celle qu'il annonce. Voir `TopBar.tsx`.
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
