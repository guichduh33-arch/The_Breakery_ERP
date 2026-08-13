// apps/backoffice/src/pages/orders/OrderDetailPage.tsx
//
// Détail d'une commande — instance de l'archétype DOCUMENT : le corps du
// document à gauche (paires libellé/valeur, puis la table de ses lignes), le
// rail d'argent à droite (totaux, paiements, remboursements, frise d'états).
// Plusieurs statuts INDÉPENDANTS cohabitent dans l'en-tête quand la réalité
// les sépare — une commande peut être payée sans être complétée, remboursée
// sans être annulée. La frise montre les étapes à venir en creux.
//
// Lecture seule (route gate `orders.read`) : les gestes — void, édition —
// vivent sur la liste, au plus près du flux. Rien ne s'édite ici : un
// remboursement est une contre-écriture, jamais une correction.

import type { JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, cn } from '@breakery/ui';
// formatDateTimeShortWita : le format de lecture des tables du BO (24 h, mois
// en lettres) — plus de fuseau ni de formatteur redéclarés ici (ADR-019 D5).
import { formatCurrency, formatDateTimeShortWita } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { useOrderDetail, type OrderDetail } from '@/features/orders/hooks/useOrderDetail.js';
import {
  ORDER_STATUS_BADGE,
  isOrderDetailPaid,
  isSettledStatus,
  orderStatusBadgeTone,
  orderStatusLabel,
  orderTypeLabel,
} from '@/features/orders/statusMeta.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';

const fmtDateTime = formatDateTimeShortWita;

function rp(n: number | null): string {
  return formatCurrency(Number(n ?? 0));
}

const SECTION_LABEL = 'font-data text-[11px] font-semibold uppercase tracking-widest text-text-muted';
const TH = 'px-3.5 py-2.5 text-left font-data text-[10px] font-semibold uppercase tracking-widest text-text-muted';

// Le fil d'Ariane porte l'invariant C4/BO-12 (retour vers /backoffice/orders) :
// il se rend dans TOUS les états — l'erreur est celui où l'on en a le plus
// besoin (review PR #367, un lien périmé ne doit pas être un cul-de-sac).
function Crumbs({ leaf }: { leaf?: string }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
      <span>Sales</span>
      <span className="text-text-inert" aria-hidden>›</span>
      <Link to="/backoffice/orders" className="hover:text-text-primary">Orders</Link>
      {leaf !== undefined && (
        <>
          <span className="text-text-inert" aria-hidden>›</span>
          <span className="font-data text-text-secondary">{leaf}</span>
        </>
      )}
    </nav>
  );
}

export function OrderDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useOrderDetail(id);

  if (error) {
    return (
      <div className="flex flex-col gap-[13px]">
        <Crumbs />
        <p role="alert" className="rounded-md border border-red bg-red-soft p-4 text-sm text-red-as-text">
          This order could not be loaded. It may have been recorded on another
          environment, or the link is stale.{' '}
          <Link to="/backoffice/orders" className="underline">Back to orders</Link>
        </p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-[13px]" aria-busy="true">
        <Crumbs />
        <div className="h-8 w-72 animate-pulse rounded bg-surface-4 motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-md bg-surface-4 motion-reduce:animate-none" />
      </div>
    );
  }

  const refundTotal = data.refunds.reduce((s, r) => s + Number(r.total), 0);
  const refundState: 'none' | 'partial' | 'full' =
    refundTotal <= 0 ? 'none' : refundTotal >= data.total ? 'full' : 'partial';
  // RÉGLÉ : définition unique partagée avec le tiroir (isOrderDetailPaid).
  const isPaid = isOrderDetailPaid(data);
  const orderNo = data.order_number.replace(/^#+/, '');

  return (
    <div className="flex flex-col gap-[13px]">
      <Crumbs leaf={`#${orderNo}`} />

      <PageHeader
        title={`Order #${orderNo}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {/* Statuts indépendants : cycle de vie, encaissement, remboursement. */}
            <span className={cn(ORDER_STATUS_BADGE, orderStatusBadgeTone(data.status))}>
              {orderStatusLabel(data.status)}
            </span>
            {/* Le badge d'encaissement ne se montre que s'il ajoute une
                information : « paid »/« completed » disent déjà l'argent. */}
            {isPaid
              ? !isSettledStatus(data.status) && (
                  <span className={cn(ORDER_STATUS_BADGE, 'bg-success-soft text-success')}>Paid</span>
                )
              : data.status !== 'voided' && (
                  <span className={cn(ORDER_STATUS_BADGE, 'bg-warning-soft text-warning')}>Unpaid</span>
                )}
            {refundState !== 'none' && (
              <span className={cn(ORDER_STATUS_BADGE, 'bg-danger-soft text-danger')}>
                {refundState === 'full' ? 'Fully refunded' : 'Partially refunded'}
              </span>
            )}
            <span>
              {orderTypeLabel(data.order_type)}
              {data.table_number != null && ` · Table ${data.table_number}`}
              {' · '}
              <span className="font-data tabular-nums">{fmtDateTime(data.created_at)}</span>
            </span>
          </span>
        }
      />

      <div className="grid items-start gap-[13px] lg:grid-cols-[1.7fr_1fr]">
        {/* ------------------------------------------------ corps du document */}
        <div className="flex flex-col gap-[13px]">
          <Card variant="default" padding="md" className="shadow-none">
            <h2 className={SECTION_LABEL}>Order</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              <MetaPair label="Customer">
                {data.customer_id !== null && data.customer_name !== null
                  ? <DrilldownLink entity="customer" id={data.customer_id} label={data.customer_name} />
                  : <span className="text-text-subtle">Walk-in</span>}
              </MetaPair>
              <MetaPair label="Served by">
                {data.served_by_name !== null
                  ? <DrilldownLink entity="user" id={data.served_by ?? ''} label={data.served_by_name} icon={false} />
                  : <span className="text-text-subtle" aria-hidden>—</span>}
              </MetaPair>
              <MetaPair label="Type">
                {orderTypeLabel(data.order_type)}
                {data.table_number != null && ` — table ${data.table_number}`}
              </MetaPair>
              <MetaPair label="Created">
                <span className="font-data tabular-nums">{fmtDateTime(data.created_at)}</span>
              </MetaPair>
            </dl>
          </Card>

          <Card variant="default" padding="none" className="overflow-x-auto shadow-none">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Order items</caption>
              <thead className="bg-surface-inert">
                <tr>
                  <th scope="col" className={TH}>Item</th>
                  <th scope="col" className={cn(TH, 'text-right')}>Qty</th>
                  <th scope="col" className={cn(TH, 'text-right')}>Unit</th>
                  <th scope="col" className={cn(TH, 'text-right')}>Line total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr
                    key={it.id}
                    className={cn('border-t border-border-row', it.is_cancelled && 'opacity-50')}
                  >
                    <td className="px-3.5 py-2.5">
                      <span className={cn(it.is_cancelled && 'line-through')}>
                        <DrilldownLink entity="product" id={it.product_id} label={it.name_snapshot} icon={false} />
                      </span>
                      {it.is_cancelled && (
                        <span className={cn(ORDER_STATUS_BADGE, 'ml-2 bg-surface-4 text-text-secondary')}>Cancelled</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-data tabular-nums">{it.quantity}</td>
                    <td className="px-3.5 py-2.5 text-right font-data tabular-nums">{rp(it.unit_price)}</td>
                    <td className="px-3.5 py-2.5 text-right font-data tabular-nums">{rp(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-inert">
                <tr>
                  <td colSpan={4} className="px-3.5 py-2.5 font-data text-[11px] tabular-nums text-text-muted">
                    {data.items.length} {data.items.length === 1 ? 'item' : 'items'}
                    {data.items.some((it) => it.is_cancelled) &&
                      ` · ${data.items.filter((it) => it.is_cancelled).length} cancelled`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </div>

        {/* ------------------------------------------------------ rail d'argent */}
        <div className="flex flex-col gap-[13px]">
          <Card variant="default" padding="md" className="shadow-none">
            <h2 className={SECTION_LABEL}>Totals</h2>
            {/* NON-PKP (ADR-005) : la PB1 est INCLUSE dans le prix affiché. La
                pile se lit donc de bas en haut — le total est le prix payé, et
                la base s'en déduit. Rien n'est recalculé côté serveur ici :
                `subtotal − tax_amount` est un affichage, pas une écriture. */}
            <dl className="mt-3 space-y-1.5 text-sm">
              <MoneyRow label="Base (excl. PB1)" value={rp(data.subtotal - data.tax_amount)} />
              {data.discount_amount > 0 && (
                <MoneyRow label="Discount" value={`− ${rp(data.discount_amount)}`} />
              )}
              {data.promotions.map((promo, i) => (
                <MoneyRow key={i} label={promo.description} value={`− ${rp(promo.amount)}`} />
              ))}
              {/* Seule ligne FISCALE du bloc : elle cesse d'être en creux. */}
              <MoneyRow label="PB1 (included)" value={rp(data.tax_amount)} />
              <div className="flex items-baseline justify-between border-t border-border-subtle pt-2">
                <dt className="text-sm font-semibold text-text-primary">Total (incl. PB1)</dt>
                <dd className="font-data text-[23px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-text-primary">
                  {rp(data.total)}
                </dd>
              </div>
              {refundTotal > 0 && (
                <MoneyRow label="Refunded" value={`− ${rp(refundTotal)}`} tone="danger" />
              )}
            </dl>
          </Card>

          <Card variant="default" padding="md" className="shadow-none">
            <h2 className={SECTION_LABEL}>Payments</h2>
            {data.payments.length === 0 ? (
              <p className="mt-3 text-sm text-text-secondary">
                {data.status === 'voided'
                  ? 'Voided before payment.'
                  : isPaid
                    ? 'Settled without a POS payment row — B2B settlements are recorded in the AR ledger.'
                    : 'Not paid yet.'}
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {data.payments.map((p) => (
                  <li key={p.id} className="text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="capitalize text-text-primary">{p.method.replace('_', ' ')}</span>
                      <span className="font-data tabular-nums">{rp(p.amount)}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between text-xs text-text-muted">
                      <span className="font-data tabular-nums">{fmtDateTime(p.paid_at)}</span>
                      {p.cash_received !== null && p.change_given !== null && (
                        <span className="font-data tabular-nums">
                          {rp(p.cash_received)} given · {rp(p.change_given)} change
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.refunds.length > 0 && (
            <Card variant="default" padding="md" className="shadow-none">
              <h2 className={SECTION_LABEL}>Refunds</h2>
              <ul className="mt-3 space-y-2.5">
                {data.refunds.map((r) => (
                  <li key={r.id} className="text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="font-data text-xs text-text-secondary">{r.refund_number}</span>
                      <span className="font-data tabular-nums text-danger">− {rp(r.total)}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between text-xs text-text-muted">
                      <span>{r.is_full_void ? 'Full void' : 'Partial'} — {r.reason}</span>
                      <span className="font-data tabular-nums">{fmtDateTime(r.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card variant="default" padding="md" className="shadow-none">
            <h2 className={SECTION_LABEL}>Timeline</h2>
            <Timeline data={data} isPaid={isPaid} refundState={refundState} />
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function MetaPair({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="font-data text-[10px] font-semibold uppercase tracking-widest text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text-primary">{children}</dd>
    </div>
  );
}

function MoneyRow({
  label, value, tone,
}: {
  label: string; value: string; tone?: 'danger';
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className={cn('font-data text-sm tabular-nums', tone === 'danger' ? 'text-danger' : 'text-text-primary')}>
        {value}
      </dd>
    </div>
  );
}

// La frise du Document : les étapes franchies portent leur horodatage, les
// étapes à venir restent en creux. Void et remboursement sont des étapes
// exceptionnelles — elles n'apparaissent que si elles ont eu lieu.
function Timeline({
  data, isPaid, refundState,
}: {
  data: OrderDetail;
  isPaid: boolean;
  refundState: 'none' | 'partial' | 'full';
}): JSX.Element {
  // Les paiements sont triés chronologiquement par le hook ; l'horodatage du
  // règlement préfère paid_at (serveur), puis le premier paiement. Un ordre
  // réglé PAR STATUT sans ligne de paiement (B2B) marque l'étape accomplie,
  // avec ou sans date (review PR #367).
  const firstPayment = data.payments[0];
  const paidAt = data.paid_at ?? firstPayment?.paid_at;
  const steps: { key: string; label: string; at?: string; done: boolean; tone?: 'danger' }[] = [
    { key: 'created', label: 'Created', at: data.created_at, done: true },
  ];
  if (data.status === 'voided') {
    if (isPaid) steps.push({ key: 'paid', label: 'Paid', ...(paidAt !== undefined ? { at: paidAt } : {}), done: true });
    steps.push({ key: 'voided', label: 'Voided', done: true, tone: 'danger' });
  } else {
    steps.push(
      isPaid
        ? { key: 'paid', label: 'Paid', ...(paidAt !== undefined ? { at: paidAt } : {}), done: true }
        : { key: 'paid', label: 'Paid', done: false },
    );
    steps.push({ key: 'completed', label: 'Completed', done: data.status === 'completed' });
  }
  if (refundState !== 'none') {
    const last = data.refunds[data.refunds.length - 1];
    steps.push({
      key: 'refunded',
      label: refundState === 'full' ? 'Fully refunded' : 'Partially refunded',
      ...(last !== undefined ? { at: last.created_at } : {}),
      done: true,
      tone: 'danger',
    });
  }

  return (
    <ol className="mt-3 space-y-0">
      {steps.map((step, i) => (
        <li key={step.key} className="relative flex gap-3 pb-3.5 last:pb-0">
          {i < steps.length - 1 && (
            <span aria-hidden className="absolute left-[3.5px] top-3 h-full w-px bg-border-strong" />
          )}
          <span
            aria-hidden
            className={cn(
              'relative mt-1.5 h-2 w-2 shrink-0 rounded-full',
              step.done
                ? step.tone === 'danger' ? 'bg-danger' : 'bg-success'
                : 'border border-border-strong bg-transparent',
            )}
          />
          <span className="min-w-0 flex-1">
            {/* Le séparateur est TEXTUEL, pas une marge : deux nœuds texte
                adjacents se copient et se lisent « Completedpending » (audit
                UX/UI 2026-08-13, lot 6a). Vaut pour Paid comme pour Completed. */}
            <span className={cn('block text-sm', step.done ? 'text-text-primary' : 'text-text-muted')}>
              {step.label}
              {!step.done && <span className="text-xs text-text-subtle">{' — pending'}</span>}
            </span>
            {step.at !== undefined && (
              <span className="block font-data text-xs tabular-nums text-text-muted">{fmtDateTime(step.at)}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
