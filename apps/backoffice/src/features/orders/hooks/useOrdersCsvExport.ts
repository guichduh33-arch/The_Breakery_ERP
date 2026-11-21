// apps/backoffice/src/features/orders/hooks/useOrdersCsvExport.ts
//
// Export CSV de la liste des commandes sur TOUTE la fenêtre serveur
// (constat 2026-11-21) : l'ancien bouton n'exportait que les pages déjà
// chargées (50 lignes par page). Au clic, on charge les pages restantes du
// MÊME filtre serveur via la query infinie de l'écran, puis on exporte. La
// recherche texte locale s'applique ensuite : le fichier suit ce que l'écran
// montre, et le toast le dit.

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { OrdersListLine, OrdersListPage } from './useOrdersList.js';

/** Plafond de sécurité : 400 pages × 50 = 20 000 commandes. Au-delà, on
 *  refuse plutôt que de produire un fichier silencieusement tronqué. */
export const MAX_EXPORT_PAGES = 400;

interface PagesSnapshot {
  data?: { pages: OrdersListPage[] } | undefined;
  hasNextPage: boolean;
  isError?: boolean;
  error?: Error | null;
}

export interface ExportableOrdersQuery extends PagesSnapshot {
  fetchNextPage: (options?: { cancelRefetch?: boolean }) => Promise<PagesSnapshot>;
}

/** Charge toutes les pages restantes ; lève si le curseur n'avance plus. */
export async function loadAllOrderPages(query: ExportableOrdersQuery): Promise<OrdersListLine[]> {
  let snapshot: PagesSnapshot = query;
  let count = snapshot.data?.pages.length ?? 0;
  while (snapshot.hasNextPage) {
    if (count >= MAX_EXPORT_PAGES) {
      throw new Error(`More than ${(MAX_EXPORT_PAGES * 50).toLocaleString('id-ID')} orders — narrow the dates before exporting.`);
    }
    snapshot = await query.fetchNextPage({ cancelRefetch: false });
    if (snapshot.isError) throw snapshot.error ?? new Error('Orders could not be loaded.');
    const next = snapshot.data?.pages.length ?? 0;
    if (next <= count) throw new Error('Orders could not be fully loaded — the export was cancelled.');
    count = next;
  }
  return (snapshot.data?.pages ?? []).flatMap((p) => p.lines);
}

/** Même prédicat que la recherche de l'écran : n° de commande ou client. */
export function matchesQuickFind(line: OrdersListLine, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return line.order_number.toLowerCase().includes(q)
    || (line.customer_name ?? '').toLowerCase().includes(q);
}

export function useOrdersCsvExport(
  query: ExportableOrdersQuery,
  write: (lines: OrdersListLine[]) => void,
) {
  const [exporting, setExporting] = useState(false);
  const running = useRef(false);

  const run = useCallback(async (searchTerm: string): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setExporting(true);
    try {
      const all = await loadAllOrderPages(query);
      const term = searchTerm.trim();
      const rows = term ? all.filter((l) => matchesQuickFind(l, term)) : all;
      if (rows.length === 0) {
        toast.info(term ? `No orders match “${term}” in this window.` : 'No orders to export in this window.');
        return;
      }
      write(rows);
      const noun = rows.length === 1 ? 'order' : 'orders';
      toast.success(term
        ? `Exported ${rows.length.toLocaleString('id-ID')} ${noun} matching “${term}” (of ${all.length.toLocaleString('id-ID')} in the window)`
        : `Exported ${rows.length.toLocaleString('id-ID')} ${noun}`);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    } finally {
      running.current = false;
      setExporting(false);
    }
  }, [query, write]);

  return { exporting, run };
}
