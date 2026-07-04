// apps/backoffice/src/features/products/components/StockAnalyticsPanel.tsx
//
// Product stock analytics on top of get_product_analytics_v1. Originally one
// monolithic panel on the product detail "Analytics" tab; since the stock data
// was dissociated from the product configuration sheet (2026-06-23) the body is
// split into exported sections so the ProductStockPage can spread them across
// tabs (Stock / Movements / Purchase / Transfers / Production) instead of one
// very long scroll.
//
// Exported sections (each takes the resolved analytics `data`):
//   - AnalyticsKpiRow       current stock · value · days remaining · status
//   - MovementsSection      stock timeline · movement breakdown · recent moves
//   - PurchaseSection       purchase price trend · purchase pattern · incoming POs
//   - TransfersSection      transfers (date · from→to · qty)
//   - ProductionLossSection weekly consumption · recipe usage · production · waste · opname
//
// `StockAnalyticsPanel` keeps the original all-in-one layout (own window
// selector) for standalone use.

import { useState, type JSX, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, ClipboardCheck, Clock,
  DollarSign, Factory, Inbox, Minus, Package, Trash2, TrendingUp, Truck, Utensils,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Badge, Card, EmptyState, KpiTile, SectionLabel, cn } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { CHART_GRID_STROKE } from '@/features/reports/utils/chartColors.js';
import { useProductAnalytics } from '../hooks/useProductAnalytics.js';
import type { ProductRow } from '../types.js';

export type ProductAnalyticsData = NonNullable<ReturnType<typeof useProductAnalytics>['data']>;

const WINDOWS: readonly { value: number; label: string }[] = [
  { value: 7,  label: '7 Days'  },
  { value: 30, label: '30 Days' },
  { value: 90, label: '90 Days' },
];

const GOLD = 'var(--gold-base)';

function fmtDate(s: string | null): string {
  if (s === null) return '—';
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

interface Props {
  product: ProductRow;
}

export function StockAnalyticsPanel({ product }: Props): JSX.Element {
  const [days, setDays] = useState<number>(30);
  const q = useProductAnalytics(product.id, days);

  return (
    <div className="space-y-6">
      {/* Window selector */}
      <div className="flex items-center justify-end">
        <div className="inline-flex rounded-lg border border-border-subtle bg-bg-elevated p-1" role="group" aria-label="Analytics window">
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              aria-pressed={days === w.value}
              onClick={() => setDays(w.value)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-widest transition-colors duration-fast',
                days === w.value ? 'bg-gold text-bg-base' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && (
        <div className="py-16 text-center text-sm text-text-secondary">Loading analytics…</div>
      )}
      {q.error !== null && q.error !== undefined && (
        <div role="alert" className="rounded-lg border border-red bg-red-soft p-3 text-sm text-red">
          Failed to load analytics: {(q.error).message}
        </div>
      )}

      {q.data !== null && q.data !== undefined && (
        <div className="space-y-6" data-testid="stock-analytics-body">
          <AnalyticsKpiRow data={q.data} />
          <MovementsSection data={q.data} />
          <PurchaseSection data={q.data} />
          <TransfersSection data={q.data} />
          <ProductionLossSection data={q.data} />
        </div>
      )}
    </div>
  );
}

/* ── Exported sections (consumed by ProductStockPage tabs) ─────────────────── */

export function AnalyticsKpiRow({ data }: { data: ProductAnalyticsData }): JSX.Element {
  const k = data.kpis;
  const statusLabel = k.stock_status === 'out' ? 'Out of Stock' : k.stock_status === 'low' ? 'Low Stock' : 'In Stock';
  const daysRemaining = k.days_remaining === null ? '0d' : `${Math.round(Number(k.days_remaining))}d`;

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Stock KPIs">
      <KpiTile
        label="Current stock"
        value={`${fmtNum(k.current_stock, 3)} ${k.unit}`}
        icon={Package}
        footer={`Min: ${k.min_stock_threshold > 0 ? fmtNum(k.min_stock_threshold, 3) : 'N/A'}`}
      />
      <KpiTile
        label="Stock value"
        value={Math.round(Number(k.stock_value))}
        valueFormat="currency"
        icon={DollarSign}
        footer={`@${formatIdr(Number(k.unit_cost))}/unit`}
      />
      <KpiTile
        label="Days remaining"
        value={daysRemaining}
        icon={Clock}
        footer={`Avg ${fmtNum(k.avg_daily_consumption, 1)}/day`}
      />
      <KpiTile
        label="Stock status"
        value={statusLabel}
        icon={AlertTriangle}
        footer={k.min_stock_threshold > 0 ? `Threshold ${fmtNum(k.min_stock_threshold, 3)}` : 'No min level set'}
      />
    </section>
  );
}

export function MovementsSection({ data }: { data: ProductAnalyticsData }): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Stock Level Timeline">
          {hasMovement(data.stock_timeline) ? (
            <div className="h-64 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.stock_timeline.map((p) => ({ label: fmtDate(p.day), balance: Number(p.balance) }))}>
                  <defs>
                    <linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GOLD} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip />
                  <Area type="monotone" dataKey="balance" stroke={GOLD} strokeWidth={2} fill="url(#stockFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <CardEmpty icon={Boxes} text="No movement data for this period" />
          )}
        </Panel>

        <Panel title="Movement Breakdown">
          {data.movement_breakdown.length === 0 ? (
            <CardEmpty icon={Boxes} text="No movements for this period" />
          ) : (
            <div className="space-y-2 p-4">
              {data.movement_breakdown.map((m) => (
                <div key={m.movement_type} className="flex items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-0">
                  <span className="font-mono text-xs uppercase tracking-wide text-text-secondary">
                    {m.movement_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-text-muted">{m.count}×</span>
                  <span className="font-mono tabular-nums text-text-primary">{fmtNum(m.qty_total, 3)}</span>
                  <span className="w-28 text-right font-mono text-xs tabular-nums text-text-secondary">{formatIdr(Number(m.value_total))}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <RecordCard title="Recent Movements" icon={Boxes} count={data.recent_movements.length} unit={`of ${data.recent_movements.length}`} empty="No movements for this period" wide>
        {data.recent_movements.map((m) => (
          <Line3 key={m.id}
            a={<span className="font-mono text-xs uppercase tracking-wide">{m.movement_type.replace(/_/g, ' ')}</span>}
            b={<span className="text-xs text-text-muted">{m.reason ?? ''}</span>}
            c={<span className={Number(m.quantity) > 0 ? 'text-success' : 'text-red'}>{Number(m.quantity) > 0 ? '+' : ''}{fmtNum(m.quantity, 3)} {m.unit}</span>}
            d={fmtDate(m.created_at)}
          />
        ))}
      </RecordCard>
    </div>
  );
}

export function PurchaseSection({ data }: { data: ProductAnalyticsData }): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Purchase Price Trend"
          right={
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest">
              <span className="flex items-center gap-1 text-success"><span className="h-2 w-2 rounded-full bg-success" />Lower</span>
              <span className="flex items-center gap-1 text-red"><span className="h-2 w-2 rounded-full bg-red" />Higher</span>
            </div>
          }
        >
          {data.purchase_price_trend.length >= 2 ? (
            <div className="h-56 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={[...data.purchase_price_trend].reverse().map((p) => ({ label: fmtDate(p.date), cost: Number(p.unit_cost) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={48} tickFormatter={(v: number) => formatIdr(v)} />
                  <Tooltip formatter={(v: number) => formatIdr(v)} />
                  <Line type="monotone" dataKey="cost" stroke={GOLD} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <CardEmpty icon={TrendingUp} text="Not enough purchase data to show price trend." />
          )}
        </Panel>

        <Panel title="Purchase Pattern" subtitle="Monthly quantity purchased & order frequency">
          {data.purchase_pattern.length > 0 ? (
            <div className="h-56 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.purchase_pattern.map((p) => ({ label: fmtDate(p.month), qty: Number(p.qty), orders: Number(p.order_count) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip />
                  <Bar dataKey="qty" fill={GOLD} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <CardEmpty icon={Truck} text="Not enough purchase data to show patterns." />
          )}
        </Panel>
      </div>

      <RecordCard title="Incoming (Purchase Orders)" icon={Truck} count={data.incoming_pos.length} unit="orders" empty="No purchase orders for this product" wide>
        {data.incoming_pos.map((po) => (
          <Line3 key={po.po_id}
            a={po.po_number}
            b={<Badge variant="outline" className="uppercase">{po.status}</Badge>}
            c={`${fmtNum(po.received_quantity ?? 0)}/${fmtNum(po.quantity)} ${po.unit}`}
            d={fmtDate(po.order_date)}
          />
        ))}
      </RecordCard>
    </div>
  );
}

export function TransfersSection({ data }: { data: ProductAnalyticsData }): JSX.Element {
  return (
    <RecordCard title="Transfers" icon={Truck} count={data.transfers.length} unit="transfers" empty="No transfers for this product" wide>
      {data.transfers.map((t) => (
        <Line3 key={t.id}
          a={t.transfer_number}
          b={<span className="text-xs text-text-muted">{t.from_section_code ?? '—'} → {t.to_section_code ?? '—'}</span>}
          c={`${fmtNum(t.quantity_received ?? t.quantity_requested, 3)} ${t.unit}`}
          d={fmtDate(t.transferred_at ?? t.created_at)}
        />
      ))}
    </RecordCard>
  );
}

export function ProductionLossSection({ data }: { data: ProductAnalyticsData }): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Weekly Consumption" right={<TrendChip trend={data.consumption_trend} />}>
          {data.weekly_consumption.some((w) => Number(w.units) > 0) ? (
            <div className="h-56 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.weekly_consumption.map((w) => ({ label: fmtDate(w.week_start), units: Number(w.units) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip />
                  <Bar dataKey="units" fill={GOLD} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <CardEmpty icon={Utensils} text="Not enough data. Select a longer date range for trend analysis." />
          )}
        </Panel>

        <Panel title="Recipe Usage" icon={Utensils} right={<span className="text-xs text-text-muted">{data.recipe_usage.length} products</span>}>
          {data.recipe_usage.length === 0 ? (
            <CardEmpty icon={Utensils} text="This product is not used in any recipe." />
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-elevated text-[10px] uppercase tracking-widest text-text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Qty/Batch</th>
                    <th className="px-3 py-2 text-right">% Demand</th>
                    <th className="px-4 py-2 text-right">Est. Used</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recipe_usage.map((r) => (
                    <tr key={r.product_id} className="border-t border-border-subtle">
                      <td className="px-4 py-2 text-text-primary">{r.product_name}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="uppercase">
                          {r.is_semi_finished ? 'Semi' : r.product_type ?? 'Finished'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtNum(r.qty_per_batch, 3)} {r.unit}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-gold">{fmtNum(r.demand_pct, 1)}%</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-text-secondary">{fmtNum(r.est_used, 3)} {r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecordCard title="Production" icon={Factory} count={data.production.length} unit="records" empty="No production records">
          {data.production.map((p) => (
            <Line3 key={p.id}
              a={p.production_number}
              b={p.reverted ? <Badge variant="destructive" className="uppercase">Reverted</Badge> : <Badge variant="secondary" className="uppercase">Done</Badge>}
              c={`${fmtNum(p.quantity_produced, 3)} produced`}
              d={fmtDate(p.production_date)}
            />
          ))}
        </RecordCard>

        <RecordCard title="Wastage Analysis" icon={Trash2} count={data.wastage.length} unit="records" empty="No waste records">
          {data.wastage.map((w) => (
            <Line3 key={w.id}
              a={<span className="text-red">−{fmtNum(w.quantity, 3)} {w.unit}</span>}
              b={<span className="truncate text-xs text-text-muted">{w.reason ?? 'Waste'}</span>}
              c={formatIdr(Number(w.value))}
              d={fmtDate(w.created_at)}
            />
          ))}
        </RecordCard>

        <RecordCard title="Stock Counts (Opname)" icon={ClipboardCheck} count={data.opname.length} unit="counts" empty="No stock counts for this product" wide>
          {data.opname.map((o) => (
            <Line3 key={o.id}
              a={o.count_number}
              b={<Badge variant="outline" className="uppercase">{o.status}</Badge>}
              c={`Var ${o.variance === null ? '—' : fmtNum(o.variance, 3)}`}
              d={fmtDate(o.finalized_at ?? o.created_at)}
            />
          ))}
        </RecordCard>
      </div>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function hasMovement(timeline: { balance: number }[]): boolean {
  if (timeline.length < 2) return false;
  const vals = timeline.map((p) => Number(p.balance));
  return Math.max(...vals) !== Math.min(...vals) || vals.some((v) => v !== 0);
}

function Panel({ title, subtitle, icon: Icon, right, children }: {
  title: string; subtitle?: string; icon?: typeof Boxes; right?: ReactNode; children: ReactNode;
}): JSX.Element {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-gold" aria-hidden />}
          <div>
            <SectionLabel as="h3" size="sm">{title}</SectionLabel>
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

function CardEmpty({ icon, text }: { icon: typeof Boxes; text: string }): JSX.Element {
  return (
    <div className="flex h-56 items-center justify-center px-6 text-center">
      <EmptyState icon={icon} title={text} size="sm" />
    </div>
  );
}

function RecordCard({ title, icon: Icon, count, unit, empty, wide, children }: {
  title: string; icon: typeof Boxes; count: number; unit: string; empty: string; wide?: boolean; children: ReactNode;
}): JSX.Element {
  return (
    <Card padding="none" className={cn('overflow-hidden', wide && 'lg:col-span-2')}>
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gold" aria-hidden />
          <SectionLabel as="h3" size="sm">{title}</SectionLabel>
        </div>
        <span className="text-xs text-text-muted">{count} {unit}</span>
      </div>
      {count === 0 ? (
        <div className="flex h-32 items-center justify-center text-center">
          <EmptyState icon={Inbox} title={empty} size="sm" />
        </div>
      ) : (
        <div className="divide-y divide-border-subtle">{children}</div>
      )}
    </Card>
  );
}

function Line3({ a, b, c, d }: { a: ReactNode; b: ReactNode; c: ReactNode; d: ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[1.2fr_1.4fr_1fr_auto] items-center gap-3 px-4 py-2 text-sm">
      <span className="truncate font-medium text-text-primary">{a}</span>
      <span className="truncate">{b}</span>
      <span className="truncate text-right font-mono text-xs tabular-nums text-text-secondary">{c}</span>
      <span className="text-right text-xs text-text-muted">{d}</span>
    </div>
  );
}

function TrendChip({ trend }: { trend: 'up' | 'down' | 'stable' }): JSX.Element {
  const cfg = trend === 'up'
    ? { Icon: ArrowUpRight, cls: 'text-red', label: 'Consumption rising' }
    : trend === 'down'
    ? { Icon: ArrowDownRight, cls: 'text-success', label: 'Consumption falling' }
    : { Icon: Minus, cls: 'text-text-muted', label: 'Consumption stable' };
  const { Icon } = cfg;
  return (
    <span className={cn('flex items-center gap-1 text-xs', cfg.cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {cfg.label}
    </span>
  );
}
