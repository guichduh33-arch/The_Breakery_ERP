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
// DE MÊME POUR LE FEED : `useStockLedger` (`get_stock_movement_ledger_v4`) est
// partagé avec la page Inventory. On ne le touche pas : il accepte déjà
// `productId`, que la page Inventory passe depuis son propre filtre.
//
// S3-22 (2026-11-10) — les filtres passent sur `ReportFilterBar` : l'ARTICLE
// (`product_id`, que la RPC acceptait sans que l'écran le propose) et le type
// de mouvement, tous deux dans l'URL. La liste des types est contrôlée contre
// l'enum Postgres (`Record` exhaustif) : stricte, elle ne peut rien perdre.
// L'article est un `select` alimenté par le catalogue opérationnel
// (`useProducts`) : la recherche d'article de la page Inventory est un
// composant privé de sa barre, qui ne sait pas réafficher un article lu dans
// l'URL — elle afficherait un filtre actif invisible.
//
// CE QUI NE CHANGE PAS : la bannière de troncature (plafond serveur), portée par
// le tableau ; et l'absence de PDF, assumée (DEV-S30-4.X-01) — l'export est
// CSV, aux 15 colonnes de la fiche de référence.
//
// Params URL : `start` / `end` / `movement_type` / `product_id`.

import { useMemo, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Database } from '@breakery/supabase';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { ReportFilterBar } from '@/features/reports/components/ReportFilterBar.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useReportFilters, type ReportFilterDef, type ReportFilterOption,
} from '@/features/reports/hooks/useReportFilters.js';
import { periodLabel } from '@/features/reports/utils/reportFigures.js';
import { useStockLedger } from '@/features/inventory-movements/hooks/useStockLedger.js';
import { StockLedgerTable } from '@/features/inventory-movements/components/StockLedgerTable.js';
import { enrichLedgerLines, stockLedgerCsvColumns } from '@/features/inventory-movements/stockLedgerColumns.js';
import { useProducts } from '@/features/products/hooks/useProducts.js';

type MovementType = Database['public']['Enums']['movement_type'];

// Enum `movement_type` complet — le `Record` refuse de compiler si Postgres
// ajoute ou retire une valeur. L'ordre est celui de lecture du sélecteur.
const MOVEMENT_TYPE_ORDER: Record<MovementType, number> = {
  sale: 0, sale_void: 1, purchase: 2, purchase_return: 3, incoming: 4,
  transfer_in: 5, transfer_out: 6, production: 7, production_in: 8, production_out: 9,
  adjustment: 10, adjustment_in: 11, adjustment_out: 12,
  opname_in: 13, opname_out: 14, waste: 15, cost_price_correction: 16,
  reservation_hold: 17, reservation_release: 18,
};

const MOVEMENT_TYPE_OPTIONS: readonly ReportFilterOption[] = Object.entries(MOVEMENT_TYPE_ORDER)
  .sort(([, a], [, b]) => a - b)
  .map(([t]) => ({ value: t, label: t }));

type FilterKey = 'product_id' | 'movement_type';

export default function StockMovementHistoryPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const { data: products } = useProducts();
  const [params] = useSearchParams();
  const urlProductId = (params.get('product_id') ?? '').trim();

  const filterDefs = useMemo<readonly ReportFilterDef<FilterKey>[]>(() => [
    {
      // Non stricte : la liste arrive après le premier rendu. Les articles
      // suivis en stock seulement — ceux qui ont une fiche — plus celui que
      // l'URL désigne, pour qu'un lien vers un article non suivi reste lisible.
      kind: 'select', key: 'product_id', label: 'Item', allLabel: 'All items', width: 'w-56',
      options: (products ?? [])
        .filter((p) => p.track_inventory || p.id === urlProductId)
        .map((p) => ({
          value: p.id,
          label: p.variant_label !== null && p.variant_label !== ''
            ? `${p.name} — ${p.variant_label}` : p.name,
        })),
    },
    {
      kind: 'select', key: 'movement_type', label: 'Movement type', allLabel: 'All types',
      options: MOVEMENT_TYPE_OPTIONS, strict: true,
    },
  ], [products, urlProductId]);
  const filters = useReportFilters(filterDefs);
  const { product_id: productId, movement_type: typeFilter } = filters.values;

  const query = useStockLedger({
    start, end,
    productId:    productId || undefined,
    movementType: typeFilter || undefined,
  });

  const result = query.data ?? { lines: [], truncated: false, row_count: 0 };
  const rows = useMemo(() => enrichLedgerLines(result.lines), [result.lines]);

  const activeCount = Object.keys(filters.active).length;
  const meta = [
    periodLabel(start, end),
    'per-product stock card: opening → in/out → balance',
    ...(activeCount > 0 ? [`${activeCount} filter${activeCount === 1 ? '' : 's'} active`] : []),
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows, columns: stockLedgerCsvColumns, filename: `stock-movements-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Stock Movement History"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      filters={<ReportFilterBar defs={filterDefs} filters={filters} />}
      error={query.error}
      isEmpty={!query.isLoading && query.error === null && query.data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No stock movements',
        description: 'No movement was recorded over this period for the selected filters.',
      }}
    >
      <StockLedgerTable rows={rows} truncated={result.truncated} isLoading={query.isLoading} />
    </ReportShell>
  );
}
