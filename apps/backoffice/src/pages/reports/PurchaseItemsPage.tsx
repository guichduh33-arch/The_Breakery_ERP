// apps/backoffice/src/pages/reports/PurchaseItemsPage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 8/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : les lignes viennent de `get_purchase_items_v1` et sont
// servies telles quelles ; le FILTRE FOURNISSEUR reste, en URL-state (R-17 : la
// vue est partageable et survit au rechargement) ; les drill-downs posés au lot
// A2 vers le bon de commande et vers le produit sont conservés ; la bannière du
// plafond serveur (1000 lignes) aussi, avec ce qu'elle implique — le classement
// des produits porte alors sur un SOUS-ENSEMBLE, et le sous-titre le dit au lieu
// de laisser croire à un Top de la période entière (R-08).
//
// Ce qui change : le graphe en barres horizontales devient une CARTE DE
// VENTILATION à pistes. Un classement de valeurs ÉTIQUETÉES n'a pas besoin d'un
// axe : la carte donne le libellé, la part et le montant sur la même ligne, là
// où le graphe faisait lire une longueur puis chercher le nom sur l'axe — et il
// tronquait les noms à 24 caractères pour tenir. Même arbitrage que les donuts
// de Cost & Spend Analytics au lot E.
//
// PAS DE COMPARAISON : l'écran est un JOURNAL de lignes d'achat, pas un
// agrégat. « Les lignes de la période précédente » ne se mettent pas en regard
// de celles-ci ligne à ligne ; l'agrégat comparable, lui, vit dans Purchase by
// Date et Purchase by Supplier, qui le portent tous deux.
//
// Params URL : `start` / `end` / `supplier_id` — les bornes portaient déjà les
// noms du socle, aucun repli legacy n'est nécessaire.

import { useMemo, type JSX } from 'react';
import { selectClassName, cn } from '@breakery/ui';
import { useQuery } from '@tanstack/react-query';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { BreakdownCard, type BreakdownRow } from '@/features/reports/components/BreakdownCard.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { categoricalColor, formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, periodLabel, sharePct, topSlice,
} from '@/features/reports/utils/reportFigures.js';
import { supabase } from '@/lib/supabase.js';
import {
  usePurchaseItems, type PurchaseItemLine,
} from '@/features/reports/hooks/usePurchaseItems.js';
import { useUrlState } from '@/hooks/useUrlState.js';

interface SupplierOption { id: string; name: string }

const csvColumns: CsvColumn<PurchaseItemLine>[] = [
  { header: 'PO#',           accessor: (r) => r.po_number,         format: 'text' },
  { header: 'Date',          accessor: (r) => r.order_date,        format: 'text' },
  { header: 'Supplier',      accessor: (r) => r.supplier_name,     format: 'text' },
  { header: 'Product',       accessor: (r) => r.product_name,      format: 'text' },
  { header: 'SKU',           accessor: (r) => r.sku,               format: 'text' },
  { header: 'Qty',           accessor: (r) => r.quantity,          format: 'number' },
  { header: 'Received',      accessor: (r) => r.received_quantity, format: 'number' },
  { header: 'Unit cost (IDR)', accessor: (r) => r.unit_cost,       format: 'idr-round100' },
  { header: 'Subtotal (IDR)', accessor: (r) => r.subtotal,         format: 'idr-round100' },
  { header: 'Status',        accessor: (r) => r.status,            format: 'text' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

interface ProductAgg { id: string; name: string; value: number; qty: number }

/** Valeur achetée par produit, décroissante. */
function aggregateProducts(lines: PurchaseItemLine[]): ProductAgg[] {
  const acc = new Map<string, ProductAgg>();
  for (const l of lines) {
    const cur = acc.get(l.product_id)
      ?? { id: l.product_id, name: l.product_name, value: 0, qty: 0 };
    cur.value += l.subtotal;
    cur.qty   += l.quantity;
    acc.set(l.product_id, cur);
  }
  return [...acc.values()].sort((a, b) => b.value - a.value);
}

interface KpiDescriptor { key: string; label: string; value: string; title?: string; note?: string | undefined }

export default function PurchaseItemsPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;
  // R-17 — filtre en URL-state (convention S57) : la vue devient partageable et
  // survit au rechargement.
  const [supplierId, setSupplierId] = useUrlState('supplier_id', '');

  const { data: supplierOptions } = useQuery<SupplierOption[]>({
    queryKey: ['suppliers-options'],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, error } = usePurchaseItems({
    start, end, supplierId: supplierId || null,
  });

  const lines     = useMemo(() => data?.lines ?? [], [data]);
  const truncated = data?.truncated === true;

  const products = useMemo(() => aggregateProducts(lines), [lines]);
  const top      = topSlice(products, (p) => p.value, 'purchased value', 8);
  const productRows: BreakdownRow[] = top.rows.map((p, i) => ({
    key: p.id || p.name,
    label: p.name,
    amount: p.value,
    sharePct: sharePct(p.value, top.total),
    color: categoricalColor(i),
    count: `${formatCount(p.qty)} pcs`,
  }));

  const orderedQty  = lines.reduce((s, l) => s + l.quantity, 0);
  const receivedQty = lines.reduce((s, l) => s + l.received_quantity, 0);
  const receivedShare = orderedQty > 0 ? sharePct(receivedQty, orderedQty) : null;
  const poCount       = new Set(lines.map((l) => l.po_id)).size;
  const supplierCount = new Set(lines.map((l) => l.supplier_name)).size;

  const tiles: KpiDescriptor[] = [
    {
      key: 'total', label: 'Purchased value',
      value: formatIdrCompact(data?.summary.total_value ?? 0),
      title: formatIdrFull(data?.summary.total_value ?? 0),
      note:  `${formatCount(data?.summary.line_count ?? 0)} line${(data?.summary.line_count ?? 0) === 1 ? '' : 's'}`,
    },
    {
      key: 'orders', label: 'Purchase orders',
      value: formatCount(poCount),
      note:  truncated ? 'across the listed lines' : undefined,
    },
    {
      key: 'suppliers', label: 'Suppliers',
      value: formatCount(supplierCount),
      note:  supplierId === '' ? undefined : 'filtered to one supplier',
    },
    {
      key: 'products', label: 'Products',
      value: formatCount(products.length),
    },
    {
      key: 'qty', label: 'Units ordered',
      value: formatCount(orderedQty),
      note:  `${formatCount(receivedQty)} received`,
    },
    {
      key: 'received', label: 'Received rate',
      value: receivedShare === null ? '—' : formatPct1(receivedShare),
      note:  'of ordered units',
    },
  ];

  const toolbar = (
    <>
      <PeriodControl period={period} />
      {/* <select> natif — @breakery/ui n'exporte pas de composant Select. */}
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="sr-only">Supplier</span>
        <select
          className={cn(selectClassName, 'h-9 w-auto')}
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          aria-label="Filter by supplier"
        >
          <option value="">All suppliers</option>
          {(supplierOptions ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <ExportMenu
        csv={{ rows: lines, columns: csvColumns, filename: `purchase-items-${start}_${end}` }}
        disabled={lines.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Purchase Items"
      subtitle={`${periodLabel(start, end)} · line items across received purchase orders`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && data !== undefined && lines.length === 0}
      emptyState={{
        title: 'No purchase lines',
        description: 'No purchase line for this period and supplier.',
      }}
      kpis={
        <KpiBand isLoading={isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
            >
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {truncated && (
        <p role="status" className="rounded-sm border border-warning bg-warning-soft px-4 py-2 text-sm text-warning">
          First 1000 lines shown — narrow the date range to see them all.
        </p>
      )}

      <div className="mt-3">
        <BreakdownCard
          title="Top products by value"
          // R-08 — `products` agrège `lines`, que la RPC plafonne à 1000. Quand
          // la troncature est active, le classement porte sur un sous-ensemble.
          subtitle={truncated
            ? 'Ranked across the first 1000 lines only — not the whole period.'
            : (top.note ?? 'Share of the purchased value over the period.')}
          variant="track"
          rows={productRows}
          total={{ label: 'Total purchased', amount: top.total }}
          isLoading={isLoading}
          emptyText="No purchase line to ventilate for this period."
          testId="breakdown-purchase-products"
        />
      </div>

      <PanelCard
        title="Purchase lines"
        className="mt-3"
        subtitle="Every ordered line, with its order, its product and its status."
        isLoading={isLoading}
        testId="purchase-items-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Purchase order, date, supplier, product, quantities, unit cost, subtotal and status per line
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">PO#</th>
                <th scope="col" className="py-2 text-left">Date</th>
                <th scope="col" className="py-2 text-left">Supplier</th>
                <th scope="col" className="py-2 text-left">Product</th>
                <th scope="col" className="py-2 text-left">SKU</th>
                <th scope="col" className="py-2 text-right">Qty</th>
                <th scope="col" className="py-2 text-right">Received</th>
                <th scope="col" className="py-2 text-right">Unit cost</th>
                <th scope="col" className="py-2 text-right">Subtotal</th>
                <th scope="col" className="py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((r, idx) => (
                <tr key={`${r.po_id}-${r.product_id}-${idx}`} className="border-b border-border-subtle">
                  <td className="py-2 font-medium">
                    {/* Lot A2 — po_id / product_id étaient disponibles, aucun lien posé. */}
                    <DrilldownLink entity="purchase_order" id={r.po_id} label={r.po_number} />
                  </td>
                  <td className="py-2 font-data text-xs text-text-secondary">{String(r.order_date).slice(0, 10)}</td>
                  <td className="py-2 text-text-secondary">{r.supplier_name}</td>
                  <td className="py-2">
                    <DrilldownLink entity="product" id={r.product_id} label={r.product_name} />
                  </td>
                  <td className="py-2 font-data text-xs text-text-secondary">{r.sku}</td>
                  <td className={NUM_CELL}>{formatCount(r.quantity)}</td>
                  <td className={NUM_CELL}>{formatCount(r.received_quantity)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.unit_cost)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.subtotal)}</td>
                  <td className="py-2 capitalize text-text-secondary">{r.status}</td>
                </tr>
              ))}
            </tbody>
            {lines.length > 0 && data !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2" colSpan={8}>Total ({formatCount(data.summary.line_count)} lines)</td>
                  <td className={NUM_CELL}>{formatIdrFull(data.summary.total_value)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
