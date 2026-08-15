// apps/backoffice/src/pages/reports/StockVariancePage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 7/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// LA PÉRIODE EST UNE FENÊTRE GLISSANTE, et elle doit le rester. Les colonnes de
// flux sont des MOUVEMENTS cumulés sur la fenêtre : les réduire à une seule
// journée les ramène tous à zéro le plus souvent, et l'écran se dégrade alors en
// simple relevé de stock. Le contrôle de période est donc celui du socle, en
// variante `range`, avec son défaut de 28 jours et sa participation normale à la
// période partagée de la session.
//
// SIGNALEMENT LEVÉ (ADR-027) — l'ancien écran comparait deux termes qui ne
// vivaient pas dans le même temps : un `expected` déduit des mouvements de la
// FENÊTRE contre un `current_qty` pris à l'INSTANT présent. `get_stock_variance_v3`
// résout cela en servant une OUVERTURE reconstruite à la borne basse et une
// CLÔTURE calculée à la borne haute : `closing = opening + stock_in + sold +
// consumed + wasted + corrected + other` est une identité comptable, vraie sur
// n'importe quelle fenêtre, passée ou ouverte. Il n'y a plus d'écart résiduel à
// mesurer entre théorie et ledger — ce que l'écran mesure désormais, c'est la
// DÉMARQUE CONSTATÉE : les pertes déclarées et les corrections d'inventaire.
//
// Les mouvements sont SIGNÉS : `sold`, `consumed` et `wasted` sont négatifs ou
// nuls, `corrected` porte son signe (négatif = manque constaté au comptage,
// positif = surplus trouvé). La démarque d'une ligne vaut donc
// `-(wasted) + max(0, -corrected)`, le surplus `max(0, corrected)`.
//
// PAS DE COMPARAISON : l'écran sert à repérer QUELS produits dérivent, pas à
// mesurer si la démarque progresse. Le shrinkage d'une fenêtre à l'autre porte
// sur des produits différents ; un pourcentage global n'y désignerait rien.
//
// CE QUI NE CHANGE PAS : le socle Report shell v2, les bornes ANCRÉES AU JOUR
// (R-01 — des bornes à la milliseconde entraient dans la queryKey et la page
// bouclait en requêtes), l'ExportMenu. Le tri est celui du SERVEUR (pertinence :
// |corrected| + |wasted| décroissant) — on garde l'ordre reçu.
//
// Params URL : `start` / `end`. Le filtre `section_id` (R-05) est retiré avec la
// dimension elle-même (ADR-027).

import { useMemo, type JSX } from 'react';
import { cn } from '@breakery/ui';
import { toLocalDayStartUTC, toLocalDayEndUTC, type CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { formatCount, periodLabel } from '@/features/reports/utils/reportFigures.js';
import {
  useStockVariance, type StockVarianceRow,
} from '@/features/reports/hooks/useStockVariance.js';

const csvColumns: CsvColumn<StockVarianceRow>[] = [
  { header: 'Product',   accessor: (r) => r.product_name, format: 'text'   },
  { header: 'SKU',       accessor: (r) => r.sku,          format: 'text'   },
  { header: 'Opening',   accessor: (r) => r.opening,      format: 'number' },
  { header: 'In',        accessor: (r) => r.stock_in,     format: 'number' },
  { header: 'Sold',      accessor: (r) => r.sold,         format: 'number' },
  { header: 'Consumed',  accessor: (r) => r.consumed,     format: 'number' },
  { header: 'Wasted',    accessor: (r) => r.wasted,       format: 'number' },
  { header: 'Corrected', accessor: (r) => r.corrected,    format: 'number' },
  { header: 'Closing',   accessor: (r) => r.closing,      format: 'number' },
  { header: 'Current',   accessor: (r) => r.current_qty,  format: 'number' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

/** Démarque d'une ligne : les pertes déclarées, plus le manque constaté au comptage. */
function shrinkOf(r: StockVarianceRow): number {
  return -r.wasted + Math.max(0, -r.corrected);
}

/** Surplus d'une ligne : ce que le comptage a trouvé EN PLUS de la théorie. */
function surplusOf(r: StockVarianceRow): number {
  return Math.max(0, r.corrected);
}

/** Une correction se lit SIGNÉE : « 5 » et « +5 » ne disent pas la même chose
 *  à côté d'un « −5 » dans la colonne voisine. */
function signed(v: number): string {
  return v > 0 ? `+${formatCount(v)}` : formatCount(v);
}

function correctedTone(v: number): string {
  if (v === 0) return 'text-text-secondary';
  if (v > 0)   return 'text-success';                  // surplus trouvé
  if (v < -5)  return 'text-danger font-semibold';
  return 'text-warning';                               // petit manque
}

interface KpiDescriptor { key: string; label: string; value: string; note?: string | undefined }

export default function StockVariancePage(): JSX.Element {
  // Fenêtre glissante du socle — voir l'en-tête : les mouvements se CUMULENT
  // sur la période, ils ne se photographient pas.
  const period = useReportPeriod();
  const { start, end } = period;

  // La RPC attend des TIMESTAMPTZ. On convertit les dates métier locales en
  // bornes UTC ancrées au JOUR : pour un même couple (start, end) la valeur est
  // identique d'un render à l'autre, donc la queryKey est stable — c'est le
  // cœur du correctif R-01.
  const filters = useMemo(() => ({
    dateStart: toLocalDayStartUTC(start).toISOString(),
    dateEnd:   toLocalDayEndUTC(end).toISOString(),
  }), [start, end]);

  const { data, isLoading, error } = useStockVariance(filters);
  // Ordre SERVEUR conservé : les lignes arrivent déjà triées par pertinence.
  const rows = useMemo(() => data ?? [], [data]);

  const losses    = rows.reduce((s, r) => s + shrinkOf(r), 0);
  const surplus   = rows.reduce((s, r) => s + surplusOf(r), 0);
  const corrected = rows.filter((r) => r.corrected !== 0).length;
  const waste     = rows.reduce((s, r) => s - r.wasted, 0);

  const tiles: KpiDescriptor[] = [
    {
      key: 'losses', label: 'Losses',
      value: formatCount(losses),
      note:  'units — waste declared plus shortfalls found at count',
    },
    {
      key: 'surplus', label: 'Surplus found',
      value: formatCount(surplus),
      note:  'units counted above the ledger',
    },
    {
      key: 'corrected', label: 'Products corrected',
      value: formatCount(corrected),
      note:  rows.length > 0 ? `of ${formatCount(rows.length)} tracked` : undefined,
    },
    {
      key: 'waste', label: 'Waste declared',
      value: formatCount(waste),
      note:  'units written off on purpose',
    },
    {
      key: 'tracked', label: 'Products tracked',
      value: formatCount(rows.length),
      note:  'with movement in this window',
    },
  ];

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `stock-variance-${start}_${end}` }}
        pdf={{
          template: 'stock_variance',
          data: rows,
          period: { start, end },
          filename: `stock-variance-${start}_${end}`,
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Stock Variance"
      subtitle={`${periodLabel(start, end)} · declared shrinkage — waste written off and stock-count corrections`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && error == null && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No movement',
        description: 'No stock movement for the selected period.',
      }}
      kpis={
        <KpiBand isLoading={isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile key={t.key} label={t.label} value={t.value} hero={i === 0} testId={`kpi-${t.key}`}>
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      <PanelCard
        title="Per product"
        // Le sous-titre nomme l'identité que la table donne à lire ligne à ligne.
        subtitle="Biggest corrections first. Closing = opening + in + sold + consumed + wasted + corrected; outflows are negative."
        isLoading={isLoading}
        testId="stock-variance-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Opening stock, inflows, sales, production consumption, waste, stock-count
              corrections, closing stock and current stock per product
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Product</th>
                <th scope="col" className="py-2 text-right">Opening</th>
                <th scope="col" className="py-2 text-right">In</th>
                <th scope="col" className="py-2 text-right">Sold</th>
                <th scope="col" className="py-2 text-right">Consumed</th>
                <th scope="col" className="py-2 text-right">Wasted</th>
                <th scope="col" className="py-2 text-right">Corrected</th>
                <th scope="col" className="py-2 text-right">Closing</th>
                <th scope="col" className="py-2 text-right">Current</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id} className="border-b border-border-subtle">
                  <td className="py-2">
                    <div className="font-medium">
                      <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                    </div>
                    <div className="font-data text-xs text-text-secondary">{r.sku}</div>
                  </td>
                  <td className={NUM_CELL}>{formatCount(r.opening)}</td>
                  <td className={NUM_CELL}>{formatCount(r.stock_in)}</td>
                  <td className={NUM_CELL}>{formatCount(r.sold)}</td>
                  <td className={NUM_CELL}>{formatCount(r.consumed)}</td>
                  <td className={cn(NUM_CELL, r.wasted < 0 ? 'text-warning' : undefined)}>
                    {formatCount(r.wasted)}
                  </td>
                  <td className={cn(NUM_CELL, correctedTone(r.corrected))}>{signed(r.corrected)}</td>
                  <td className={cn(NUM_CELL, 'font-semibold')}>{formatCount(r.closing)}</td>
                  <td className={NUM_CELL}>{formatCount(r.current_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
