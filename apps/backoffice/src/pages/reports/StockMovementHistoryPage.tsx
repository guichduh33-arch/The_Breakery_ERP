// apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx
//
// Lot G (campagne Reports 2026-08-15) — vague Journaux, page 5/5. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : PurchaseItemsPage).
//
// C'EST UNE FICHE DE STOCK : par produit, ouverture → entrées / sorties →
// solde, avec le coût et la valeur du mouvement. Un grand livre, donc — pas un
// agrégat. Pas de bande de KPI, pas de comparaison : un solde qui court ne se
// met pas en regard du solde de la période précédente.
//
// LE TABLEAU N'EST PAS À MOI. `StockLedgerTable` vit dans
// `features/inventory-movements/` et sert AUSSI `pages/inventory/StockMovementsPage`.
// Il porte déjà son propre tri de colonne (date / type / produit), avec
// `aria-sort` et le même cycle à trois temps que `useSortedRows` — le lot ne le
// réécrit pas et ne l'aligne pas de force sur l'util neuf : ce serait toucher
// une surface partagée hors périmètre. Le tri de colonne de cette page est donc
// celui du tableau, déjà en place.
//
// DE MÊME POUR LE FEED : `useStockLedger` (`get_stock_movement_ledger_v1`) est
// partagé avec la page Inventory. On ne le touche pas.
//
// CE QUI NE CHANGE PAS : le filtre par type de mouvement, en URL-state (R-17) ;
// la bannière de troncature (plafond serveur), portée par le tableau ; et
// l'absence de PDF, assumée (DEV-S30-4.X-01) — l'export est CSV, aux 15 colonnes
// de la fiche de référence.
//
// Params URL : `start` / `end` / `movement_type` — les bornes portaient DÉJÀ les
// noms du socle (`useUrlState('start'/'end')`), aucun repli legacy n'est
// nécessaire. Seul le défaut change : 29 jours maison → 28 jours du socle.

import { useMemo, type JSX } from 'react';
import { selectClassName, cn } from '@breakery/ui';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { periodLabel } from '@/features/reports/utils/reportFigures.js';
import { useStockLedger } from '@/features/inventory-movements/hooks/useStockLedger.js';
import { StockLedgerTable } from '@/features/inventory-movements/components/StockLedgerTable.js';
import { enrichLedgerLines, stockLedgerCsvColumns } from '@/features/inventory-movements/stockLedgerColumns.js';
import { useUrlState } from '@/hooks/useUrlState.js';

// Enum `movement_type` complet (V3) — le sélecteur cadre la fiche.
const MOVEMENT_TYPES = [
  'sale', 'sale_void', 'purchase', 'purchase_return', 'incoming',
  'transfer_in', 'transfer_out', 'production_in', 'production_out',
  'adjustment', 'adjustment_in', 'adjustment_out',
  'opname_in', 'opname_out', 'waste', 'cost_price_correction',
  'reservation_hold', 'reservation_release',
];

export default function StockMovementHistoryPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;
  // R-17 — filtre en URL-state (convention S57) : la vue devient partageable et
  // survit au rechargement.
  const [typeFilter, setTypeFilter] = useUrlState('movement_type', '');

  const query = useStockLedger({
    start, end, movementType: typeFilter || undefined,
  });

  const result = query.data ?? { lines: [], truncated: false, row_count: 0 };
  const rows = useMemo(() => enrichLedgerLines(result.lines), [result.lines]);

  const toolbar = (
    <>
      <PeriodControl period={period} />
      {/* <select> natif — le module cadre ses filtres de bandeau ainsi. */}
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="sr-only">Movement type</span>
        <select
          className={cn(selectClassName, 'h-9 w-auto')}
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); }}
          aria-label="Filter by movement type"
        >
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <ExportMenu
        csv={{ rows, columns: stockLedgerCsvColumns, filename: `stock-movements-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Stock Movement History"
      subtitle={`${periodLabel(start, end)} · per-product stock card: opening → in/out → balance`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={query.error}
      isEmpty={!query.isLoading && query.error === null && query.data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No stock movements',
        description: 'No movement was recorded over this period for this movement type.',
      }}
    >
      <StockLedgerTable rows={rows} truncated={result.truncated} isLoading={query.isLoading} />
    </ReportShell>
  );
}
