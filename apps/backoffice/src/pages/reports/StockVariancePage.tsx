// apps/backoffice/src/pages/reports/StockVariancePage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 7/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// LA PÉRIODE EST UNE FENÊTRE GLISSANTE, et elle doit le rester. `opened`,
// `sold` et `adjusted` sont des MOUVEMENTS cumulés sur la fenêtre : les réduire
// à une seule journée les ramène tous à zéro le plus souvent, et l'écart affiché
// se dégrade alors en simple relevé de stock — l'écran cesse de mesurer quoi que
// ce soit. Le contrôle de période est donc celui du socle, en variante `range`,
// avec son défaut unique de 28 jours (l'ancien défaut maison de 29 jours cède à
// l'uniformisation ; c'est la SÉMANTIQUE de fenêtre qui compte, pas son
// cardinal) et sa participation normale à la période partagée de la session.
//
// SIGNALEMENT CONNU, NON RÉSOLU ICI — les deux termes de l'écart ne vivent pas
// dans le même temps : `expected` se déduit des mouvements de la FENÊTRE, tandis
// que `current_qty` est le stock à l'INSTANT présent. L'écart n'est donc
// rigoureusement interprétable que sur une fenêtre qui se referme sur
// aujourd'hui ; sur une fenêtre passée, il mélange un cumul et un instantané.
// Corriger cela demanderait à `get_stock_variance_v2` de servir un stock daté à
// la borne de fin — un changement de RPC, hors de cette campagne. On documente,
// on ne bricole pas côté page : une correction d'affichage masquerait l'écart
// sans le résoudre.
//
// PAS DE COMPARAISON : l'écran sert à repérer QUELS produits dérivent, pas à
// mesurer si la démarque progresse. Le shrinkage d'une fenêtre à l'autre porte
// sur des produits différents ; un pourcentage global n'y désignerait rien.
//
// CE QUI NE CHANGE PAS : les lignes viennent de `get_stock_variance_v2` (v2 et
// non v1 — la v1 était gatée sur `inventory.read` alors que la route exige
// `reports.inventory.read`) ; aucun écart n'est recalculé ici. Le filtre section
// (R-05) et les bornes ANCRÉES AU JOUR (R-01 — des bornes à la milliseconde
// entraient dans la queryKey et la page bouclait en requêtes) sont conservés.
//
// Params URL : `start` / `end` / `section_id` — les bornes portaient déjà les
// noms du socle, aucun repli legacy n'est nécessaire.

import { useMemo, type JSX } from 'react';
import { cn, selectClassName } from '@breakery/ui';
import { toLocalDayStartUTC, toLocalDayEndUTC, type CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { formatCount, periodLabel } from '@/features/reports/utils/reportFigures.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  useStockVariance, type StockVarianceRow,
} from '@/features/reports/hooks/useStockVariance.js';

const csvColumns: CsvColumn<StockVarianceRow>[] = [
  { header: 'Product',      accessor: (r) => r.product_name,  format: 'text' },
  { header: 'SKU',          accessor: (r) => r.sku,           format: 'text' },
  { header: 'Opened',       accessor: (r) => r.opened,        format: 'number' },
  { header: 'Sold',         accessor: (r) => r.sold,          format: 'number' },
  { header: 'Adjusted',     accessor: (r) => r.adjusted,      format: 'number' },
  { header: 'Current',      accessor: (r) => r.current_qty,   format: 'number' },
  { header: 'Expected',     accessor: (r) => r.expected,      format: 'number' },
  { header: 'Variance',     accessor: (r) => r.variance,      format: 'number' },
  { header: 'Variance %',   accessor: (r) => r.variance_pct,  format: 'number' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

function varianceTone(v: number): string {
  if (v === 0) return 'text-text-primary';
  if (v > 0)   return 'text-success';                 // surplus
  if (v < -5)  return 'text-danger font-semibold';
  return 'text-warning';                              // petite perte
}

/** Un écart se lit SIGNÉ : « 5 » et « +5 » ne disent pas la même chose à côté
 *  d'un « −5 » dans la colonne voisine. */
function signed(v: number): string {
  return v > 0 ? `+${formatCount(v)}` : formatCount(v);
}

interface KpiDescriptor { key: string; label: string; value: string; note?: string | undefined }

export default function StockVariancePage(): JSX.Element {
  // Fenêtre glissante du socle — voir l'en-tête : les mouvements se CUMULENT
  // sur la période, ils ne se photographient pas.
  const period = useReportPeriod();
  const { start, end } = period;

  const [sectionId, setSectionId] = useUrlState('section_id', '');
  const { data: sections } = useSections();

  // La RPC attend des TIMESTAMPTZ et compare en BETWEEN (inclusif). On convertit
  // les dates métier locales en bornes UTC ancrées au JOUR : pour un même couple
  // (start, end) la valeur est identique d'un render à l'autre, donc la queryKey
  // est stable — c'est le cœur du correctif R-01.
  const filters = useMemo(() => {
    const f: { dateStart: string; dateEnd: string; sectionId?: string } = {
      dateStart: toLocalDayStartUTC(start).toISOString(),
      dateEnd:   toLocalDayEndUTC(end).toISOString(),
    };
    if (sectionId) f.sectionId = sectionId;
    return f;
  }, [start, end, sectionId]);

  const { data, isLoading, error } = useStockVariance(filters);
  const rows = useMemo(() => data ?? [], [data]);

  const ranked = useMemo(
    () => rows.slice().sort((a, b) => a.variance - b.variance),
    [rows],
  );

  const net       = rows.reduce((s, r) => s + r.variance, 0);
  const shrinkage = rows.reduce((s, r) => s + (r.variance < 0 ? -r.variance : 0), 0);
  const surplus   = rows.reduce((s, r) => s + (r.variance > 0 ?  r.variance : 0), 0);
  const off       = rows.filter((r) => r.variance !== 0).length;
  const worst     = ranked[0];

  const sectionName = sectionId === ''
    ? 'all sections'
    : (sections ?? []).find((s) => s.id === sectionId)?.name ?? 'one section';

  const tiles: KpiDescriptor[] = [
    {
      key: 'net', label: 'Net variance',
      value: rows.length === 0 ? '—' : signed(net),
      note:  'units, surplus minus shrinkage',
    },
    {
      key: 'shrinkage', label: 'Shrinkage',
      value: formatCount(shrinkage),
      note:  'units unaccounted for',
    },
    {
      key: 'surplus', label: 'Surplus',
      value: formatCount(surplus),
      note:  'units above expectation',
    },
    {
      key: 'off', label: 'Products off',
      value: formatCount(off),
      note:  rows.length > 0 ? `of ${formatCount(rows.length)} tracked` : undefined,
    },
    {
      key: 'tracked', label: 'Products tracked',
      value: formatCount(rows.length),
      note:  sectionName,
    },
    {
      key: 'worst', label: 'Worst shrinkage',
      value: worst !== undefined && worst.variance < 0 ? signed(worst.variance) : '—',
      note:  worst !== undefined && worst.variance < 0
        ? worst.product_name
        : 'no shrinkage in this window',
    },
  ];

  const toolbar = (
    <>
      <PeriodControl period={period} />
      {/* <select> natif — @breakery/ui n'exporte pas de composant Select. */}
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="sr-only">Section</span>
        <select
          className={cn(selectClassName, 'h-8 w-auto')}
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          aria-label="Filter by section"
        >
          <option value="">All sections</option>
          {(sections ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
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
      subtitle={`${periodLabel(start, end)} · expected vs current stock — positive is surplus, negative is shrinkage`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && error == null && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No movement',
        description: 'No stock movement for the selected period and section.',
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
        // Le sous-titre nomme le décalage documenté en tête : les mouvements
        // sont ceux de la FENÊTRE, le stock courant est celui de MAINTENANT.
        subtitle="Worst shrinkage first. Opened, sold and adjusted are cumulated over the window; current is today's stock."
        isLoading={isLoading}
        testId="stock-variance-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Opening, sold, adjusted, current and expected quantities with the resulting variance per product
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Product</th>
                <th scope="col" className="py-2 text-right">Opened</th>
                <th scope="col" className="py-2 text-right">Sold</th>
                <th scope="col" className="py-2 text-right">Adjusted</th>
                <th scope="col" className="py-2 text-right">Current</th>
                <th scope="col" className="py-2 text-right">Expected</th>
                <th scope="col" className="py-2 text-right">Variance</th>
                <th scope="col" className="py-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.product_id} className="border-b border-border-subtle">
                  <td className="py-2">
                    <div className="font-medium">
                      <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                    </div>
                    <div className="font-data text-xs text-text-secondary">{r.sku}</div>
                  </td>
                  <td className={NUM_CELL}>{formatCount(r.opened)}</td>
                  <td className={NUM_CELL}>{formatCount(r.sold)}</td>
                  <td className={NUM_CELL}>{formatCount(r.adjusted)}</td>
                  <td className={NUM_CELL}>{formatCount(r.current_qty)}</td>
                  <td className={NUM_CELL}>{formatCount(r.expected)}</td>
                  <td className={cn(NUM_CELL, varianceTone(r.variance))}>{signed(r.variance)}</td>
                  <td className={cn(NUM_CELL, varianceTone(r.variance))}>
                    {r.variance_pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
