// apps/backoffice/src/pages/reports/PerishableTurnoverPage.tsx
//
// Lot J (campagne Reports 2026-08-15) — DERNIER lot : la RPC
// `get_perishable_turnover_v1` était livrée, gatée et typée depuis le S30, et
// aucune page ne la consommait. C'est un branchement, pas une fonctionnalité
// neuve : le SQL n'est pas touché, la gate de la route recopie la gate serveur
// (`reports.inventory.read`).
//
// La question de l'écran : sur ce qui périme, est-ce qu'on l'écoule AVANT sa
// date ? D'où la forme :
//
//  1. Le taux de perte de la période en tuile héro. Il se recompose des
//     QUANTITÉS servies (Σ expiré / Σ (consommé + expiré)), jamais d'une moyenne
//     des `waste_pct` par produit — celle-ci donnerait le même poids à un
//     produit à 3 lots qu'à un produit à 300. Le `waste_pct` du serveur reste,
//     lui, affiché tel quel LIGNE À LIGNE.
//  2. Un seul graphe : jours en stock APPARIÉS à la durée de vie médiane, même
//     unité, un seul axe. Une barre courante qui dépasse sa barre de référence
//     dit d'un coup d'œil que le produit vit plus longtemps en réserve que sa
//     propre date ne le permet.
//  3. La table complète, triable, avec drill-down produit.
//
// PAS DE BOUTON « COMPARE », et c'est un choix : trois des colonnes servies —
// `current_active_qty`, `shelf_life_days_p50`, `lots_count` — ne sont PAS
// bornées par la fenêtre (le corps SQL les calcule sur tous les lots, à
// l'instant de la requête). Une période précédente les rendrait identiques à la
// courante, et une variation à 0 % sur la moitié des tuiles se lit comme « rien
// n'a bougé » alors qu'elle veut dire « cette grandeur n'a pas de période ». Le
// sous-titre le dit en clair plutôt que de poser un contrôle décoratif.
//
// Pas d'export PDF : aucun gabarit `perishable-turnover` n'existe dans le
// registre de l'EF `generate-pdf`. Le menu n'offre donc que le CSV.

import { useMemo, type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { cn } from '@breakery/ui';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { SortableTh } from '@/features/reports/components/SortableTh.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSortedRows, type SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import { CHART_1 } from '@/features/reports/utils/chartColors.js';
import { formatCount, formatPct1, periodLabel, sharePct } from '@/features/reports/utils/reportFigures.js';
import {
  usePerishableTurnover,
  type PerishableProductRow,
} from '@/features/reports/hooks/usePerishableTurnover.js';

/** Barres appariées lisibles côte à côte — au-delà, les noms de produit se
 *  chevauchent sur l'axe. La coupe est annoncée dans le sous-titre de la carte. */
const CHART_PRODUCTS = 8;

/** Crans du bucket de vélocité servi par la RPC (1-5). */
const VELOCITY_STEPS = [1, 2, 3, 4, 5] as const;

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

const csvColumns: CsvColumn<PerishableProductRow>[] = [
  { header: 'Product',            accessor: (r) => r.product_name,        format: 'text' },
  { header: 'Dated lots',         accessor: (r) => r.lots_count,          format: 'number' },
  { header: 'Consumed qty',       accessor: (r) => r.consumed_qty,        format: 'number' },
  { header: 'Expired qty',        accessor: (r) => r.expired_qty,         format: 'number' },
  // `format: 'percent'` multiplierait par 100 — la RPC sert déjà 0-100.
  { header: 'Waste %',            accessor: (r) => r.waste_pct,           format: 'number' },
  { header: 'Avg days in stock',  accessor: (r) => r.avg_days_in_stock,   format: 'number' },
  { header: 'Shelf life p50 (d)', accessor: (r) => r.shelf_life_days_p50, format: 'number' },
  { header: 'Active qty (now)',   accessor: (r) => r.current_active_qty,  format: 'number' },
  { header: 'Velocity (1-5)',     accessor: (r) => r.velocity_score,      format: 'number' },
];

type SortKey =
  | 'product' | 'lots' | 'consumed' | 'expired'
  | 'waste' | 'days' | 'shelf' | 'onhand' | 'velocity';

/** Défini au niveau module : `useSortedRows` le prend en dépendance, une
 *  identité neuve à chaque rendu retrierait le tableau sans fin. */
const SORT_SPECS: Readonly<Record<SortKey, SortSpec<PerishableProductRow>>> = {
  product:  { kind: 'string', value: (r) => r.product_name },
  lots:     { kind: 'number', value: (r) => r.lots_count },
  consumed: { kind: 'number', value: (r) => r.consumed_qty },
  expired:  { kind: 'number', value: (r) => r.expired_qty },
  waste:    { kind: 'number', value: (r) => r.waste_pct },
  days:     { kind: 'number', value: (r) => r.avg_days_in_stock },
  shelf:    { kind: 'number', value: (r) => r.shelf_life_days_p50 },
  onhand:   { kind: 'number', value: (r) => r.current_active_qty },
  velocity: { kind: 'number', value: (r) => r.velocity_score },
};

/** Nom raccourci pour l'axe — un libellé long y passe en travers. */
function shortName(name: string): string {
  return name.length > 13 ? `${name.slice(0, 12)}…` : name;
}

/** Une valeur inconnue est un TIRET. `avg_days_in_stock` nul veut dire « aucun
 *  lot consommé sur la fenêtre », pas « écoulé en zéro jour ». */
function orDash(v: number | null): string {
  return v === null ? '—' : formatCount(v);
}

/**
 * Le bucket 1-5 de la RPC, rendu en cinq crans. Ce n'est pas un graphe : c'est
 * la MÊME grandeur que la colonne « Avg days » juste à côté, dont elle dérive
 * côté serveur — l'identité ne repose donc jamais sur la seule couleur, et
 * `aria-label` porte le chiffre pour la lecture vocale.
 */
function VelocityMeter({ score }: { score: number }): JSX.Element {
  const n = Math.max(0, Math.min(5, Math.round(score)));
  return (
    <span
      className="inline-flex items-center gap-0.5 align-middle"
      role="img"
      aria-label={`Velocity ${formatCount(n)} of 5`}
    >
      {VELOCITY_STEPS.map((i) => (
        <span
          key={i}
          className={cn('h-2.5 w-1.5 rounded-[1px]', i > n && 'bg-surface-4')}
          style={i <= n ? { background: CHART_1 } : undefined}
        />
      ))}
    </span>
  );
}

interface KpiDescriptor {
  key: string; label: string; value: string; note?: string | undefined;
}

/** Ligne dont la RPC a pu mesurer les jours en stock — donc comparable aux
 *  autres sur cette grandeur. */
type TimedRow = PerishableProductRow & { avg_days_in_stock: number };

export default function PerishableTurnoverPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const query = usePerishableTurnover({ start, end });
  const data  = query.data;

  const rows = useMemo(() => data?.by_product ?? [], [data?.by_product]);

  // Agrégats DÉRIVÉS des lignes : l'enveloppe n'a pas de bloc `summary`.
  const totals = useMemo(() => {
    let consumed = 0;
    let expired  = 0;
    let onHand   = 0;
    let atRisk   = 0;
    for (const r of rows) {
      consumed += r.consumed_qty;
      expired  += r.expired_qty;
      onHand   += r.current_active_qty;
      if (r.expired_qty > 0) atRisk += 1;
    }
    return { consumed, expired, onHand, atRisk, turned: consumed + expired };
  }, [rows]);

  // Les deux extrêmes sont des VALEURS SERVIES, pas des moyennes reconstruites :
  // on nomme le produit le plus lent et le plus rapide, sans agréger des durées
  // dont les poids nous échappent.
  const timed = useMemo(
    () => rows.filter((r): r is TimedRow => r.avg_days_in_stock !== null),
    [rows],
  );
  const slowest = timed.reduce<TimedRow | undefined>(
    (best, r) => (best === undefined || r.avg_days_in_stock > best.avg_days_in_stock ? r : best),
    undefined,
  );
  const fastest = timed.reduce<TimedRow | undefined>(
    (best, r) => (best === undefined || r.avg_days_in_stock < best.avg_days_in_stock ? r : best),
    undefined,
  );

  const chartData = useMemo(
    () => rows
      .filter((r) => r.avg_days_in_stock !== null && r.shelf_life_days_p50 !== null)
      .slice(0, CHART_PRODUCTS)
      .map((r) => ({
        name:  shortName(r.product_name),
        days:  r.avg_days_in_stock,
        shelf: r.shelf_life_days_p50,
      })),
    [rows],
  );

  const sorted = useSortedRows<PerishableProductRow, SortKey>(rows, SORT_SPECS);

  const tiles: KpiDescriptor[] = [
    {
      key: 'waste-rate', label: 'Waste rate',
      value: formatPct1(sharePct(totals.expired, totals.turned)),
      note: totals.turned > 0
        ? `${formatCount(totals.expired)} of ${formatCount(totals.turned)} units expired`
        : 'no lot closed in this period',
    },
    {
      key: 'expired', label: 'Expired',
      value: formatCount(totals.expired),
      note: `${formatCount(totals.atRisk)} product${totals.atRisk === 1 ? '' : 's'} affected`,
    },
    {
      key: 'consumed', label: 'Consumed',
      value: formatCount(totals.consumed),
      note: `${formatCount(rows.length)} perishable product${rows.length === 1 ? '' : 's'} tracked`,
    },
    {
      key: 'on-hand', label: 'Active on hand',
      value: formatCount(totals.onHand),
      note: 'live lots — not period-scoped',
    },
    {
      key: 'slowest', label: 'Slowest mover',
      value: slowest !== undefined ? `${formatCount(slowest.avg_days_in_stock)} days` : '—',
      note: slowest?.product_name ?? 'no lot consumed in this period',
    },
    {
      key: 'fastest', label: 'Fastest mover',
      value: fastest !== undefined ? `${formatCount(fastest.avg_days_in_stock)} days` : '—',
      note: fastest?.product_name ?? 'no lot consumed in this period',
    },
  ];

  const meta = [
    periodLabel(start, end),
    'consumption and spoilage of dated lots — shelf life, lot count and stock on hand are live, not period-scoped',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `perishable-turnover-${start}_${end}` }}
        disabled={data === undefined || rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Perishable Turnover"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={query.error}
      isEmpty={!query.isLoading && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No perishable stock',
        description: 'No product carries a dated lot, so there is no shelf life to turn over.',
      }}
      kpis={
        <KpiBand
          isLoading={query.isLoading}
          error={query.error}
          tiles={tiles.length}
          labels={tiles.map((t) => t.label)}
        >
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
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
      <PanelCard
        title="Days in stock vs shelf life"
        subtitle={rows.length > chartData.length
          ? `Top ${formatCount(CHART_PRODUCTS)} by consumption, among the products with a lot closed in this period. A bar taller than its shelf-life pair sat longer in reserve than its own date allowed.`
          : 'A bar taller than its shelf-life pair sat longer in reserve than its own date allowed.'}
        isLoading={query.isLoading}
        testId="chart-perishable-days"
      >
        {chartData.length > 0 ? (
          <PairedBarsChart
            data={chartData}
            xKey="name"
            currentKey="days"
            currentName="Avg days in stock"
            compareKey="shelf"
            compareName="Shelf life (median)"
            yTickFormatter={formatCount}
            valueFormatter={(v) => `${formatCount(v)} days`}
            ariaLabel={`Average days in stock against median shelf life, per product, ${start} to ${end}.`}
          />
        ) : (
          <p className="py-2 text-xs text-text-muted">
            No lot was consumed in this period, so there is nothing to hold against a shelf life.
          </p>
        )}
      </PanelCard>

      <PanelCard
        title="Perishable products"
        className="mt-3"
        subtitle="Every product carrying a dated lot, in server order (most consumed first). Any column header re-ranks the table."
        isLoading={query.isLoading}
        testId="perishable-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Dated lots, consumed and expired quantities, waste rate, average days in
              stock, median shelf life, active quantity and velocity bucket per product
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <SortableTh label="Product"    sortKey="product"  sorted={sorted} />
                <SortableTh label="Lots"       sortKey="lots"     align="right" sorted={sorted} />
                <SortableTh label="Consumed"   sortKey="consumed" align="right" sorted={sorted} />
                <SortableTh label="Expired"    sortKey="expired"  align="right" sorted={sorted} />
                <SortableTh label="Waste"      sortKey="waste"    align="right" sorted={sorted} />
                <SortableTh label="Avg days"   sortKey="days"     align="right" sorted={sorted} />
                <SortableTh label="Shelf life" sortKey="shelf"    align="right" sorted={sorted} />
                <SortableTh label="On hand"    sortKey="onhand"   align="right" sorted={sorted} />
                <SortableTh label="Velocity"   sortKey="velocity" align="right" sorted={sorted} />
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((r) => (
                <tr key={r.product_id} className="border-b border-border-subtle">
                  <td className="py-2 font-medium">
                    <DrilldownLink
                      entity="product"
                      id={r.product_id}
                      label={r.product_name}
                      icon={false}
                    />
                  </td>
                  <td className={NUM_CELL}>{formatCount(r.lots_count)}</td>
                  <td className={NUM_CELL}>{formatCount(r.consumed_qty)}</td>
                  <td className={NUM_CELL}>{formatCount(r.expired_qty)}</td>
                  <td className={NUM_CELL}>{formatPct1(r.waste_pct)}</td>
                  <td className={NUM_CELL}>{orDash(r.avg_days_in_stock)}</td>
                  <td className={NUM_CELL}>{orDash(r.shelf_life_days_p50)}</td>
                  <td className={NUM_CELL}>{formatCount(r.current_active_qty)}</td>
                  <td className="py-2 text-right">
                    <VelocityMeter score={r.velocity_score} />
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2" colSpan={2}>Total</td>
                  <td className={NUM_CELL}>{formatCount(totals.consumed)}</td>
                  <td className={NUM_CELL}>{formatCount(totals.expired)}</td>
                  <td className={NUM_CELL}>{formatPct1(sharePct(totals.expired, totals.turned))}</td>
                  {/* Les durées ne se totalisent pas, et une moyenne de moyennes
                      n'aurait pas les bons poids : deux tirets valent mieux
                      qu'un chiffre faux. */}
                  <td className={NUM_CELL}>—</td>
                  <td className={NUM_CELL}>—</td>
                  <td className={NUM_CELL}>{formatCount(totals.onHand)}</td>
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
