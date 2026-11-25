// apps/backoffice/src/features/accounting/pages/FixedAssetDetailPage.tsx
//
// ADR-047 décision 4 — fiche d'un équipement : identité, origine, plan
// d'amortissement, dotations passées (ou refusées) et sortie. Tout vient de
// `get_fixed_asset_v1` ; la sortie passe par la fenêtre dédiée (PIN serveur).

import { useState, type JSX, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, LogOut } from 'lucide-react';
import { formatCurrency } from '@breakery/utils';
import { Card } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useFixedAsset } from '../hooks/useFixedAssets.js';
import { DisposeFixedAssetDialog } from '../components/DisposeFixedAssetDialog.js';
import {
  FIXED_ASSET_DEPRECIATION_STATUS_LABEL,
  FIXED_ASSET_DISPOSAL_REASON_LABEL,
  FIXED_ASSET_ORIGIN_LABEL,
  FIXED_ASSET_STATUS_LABEL,
  FIXED_ASSET_TAX_GROUP_LABEL,
  FIXED_ASSET_TYPE_LABEL,
} from '../components/fixedAssetContract.js';

const fmt = formatCurrency;
const month = (iso: string | null): string => (iso === null ? '—' : iso.slice(0, 7));

function Breadcrumb({ leaf }: { leaf: string }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
      <span>Finance</span>
      <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
      <Link to="/backoffice/accounting/fixed-assets" className="hover:text-text-primary">Fixed assets</Link>
      <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
      <span className="font-mono text-text-secondary">{leaf}</span>
    </nav>
  );
}

function Row({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }): JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={`text-right text-text-primary ${mono ? 'font-data tabular-nums' : ''}`}>{children}</dd>
    </div>
  );
}

export default function FixedAssetDetailPage(): JSX.Element {
  const id = useParams<{ id: string }>().id ?? '';
  const q = useFixedAsset(id);
  const canManage = useAuthStore((s) => s.hasPermission('accounting.fixed_assets.manage'));
  const [disposeOpen, setDisposeOpen] = useState(false);

  if (q.isLoading) return <div className="space-y-4"><Breadcrumb leaf="…" /><p className="text-sm text-text-secondary">Loading…</p></div>;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-4">
        <Breadcrumb leaf="—" />
        <QueryErrorBanner detail={q.error ? errorDetailText(q.error) : undefined} onRetry={() => { void q.refetch(); }} data-testid="fa-detail-error">
          This fixed asset could not be loaded. It may not exist, or you may not have access.
        </QueryErrorBanner>
      </div>
    );
  }

  const a = q.data;
  const refused = a.depreciations.filter((d) => d.status === 'refused');

  return (
    <div className="space-y-6 max-w-5xl">
      <Breadcrumb leaf={a.asset_number} />
      <PageHeader
        titleClassName="tabular-nums"
        title={`${a.asset_number} — ${a.name}`}
        subtitle={`${FIXED_ASSET_STATUS_LABEL[a.status]} · ${FIXED_ASSET_TYPE_LABEL[a.asset_type]} · ${FIXED_ASSET_TAX_GROUP_LABEL[a.tax_group]}`}
        actions={a.status === 'active' && canManage ? (
          <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={() => setDisposeOpen(true)} data-testid="fa-dispose-open">
            <LogOut className={TOOLBAR_ICON} aria-hidden /> Dispose
          </button>
        ) : undefined}
      />

      {refused.length > 0 && (
        <p role="status" className="rounded border border-border-subtle bg-warning-soft px-3 py-2 text-sm text-warning" data-testid="fa-detail-refused">
          {refused.length} {refused.length === 1 ? 'month was' : 'months were'} refused because the period was
          closed. A refused month is retried at its own date while its period is open; it is never moved to
          another month.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card variant="default" padding="md" className="space-y-3">
          <SectionLabel as="h2" size="sm" className="text-gold">Asset</SectionLabel>
          <dl className="space-y-2">
            <Row label="Account" mono>{a.account_code} — {a.account_name}</Row>
            <Row label="In-service date" mono>{a.in_service_date}</Row>
            <Row label="Cost (incl. VAT)" mono>{fmt(a.cost)}</Row>
            <Row label="Origin">
              {a.origin === 'expense' && a.expense_id !== null ? (
                <Link to={`/backoffice/expenses/${a.expense_id}`} className={`font-mono text-gold hover:underline ${FOCUS_RING}`} data-testid="fa-detail-expense-link">
                  Expense {a.expense_number ?? a.expense_id}
                </Link>
              ) : FIXED_ASSET_ORIGIN_LABEL[a.origin]}
            </Row>
            {a.origin === 'opening' && (
              <Row label="Accumulated at registration" mono>
                {fmt(a.opening_accumulated)}{a.opening_accumulated_as_of !== null ? ` at ${a.opening_accumulated_as_of}` : ''}
              </Row>
            )}
          </dl>
        </Card>

        <Card variant="default" padding="md" className="space-y-3">
          <SectionLabel as="h2" size="sm" className="text-gold">Depreciation plan</SectionLabel>
          <dl className="space-y-2">
            <Row label="Monthly depreciation" mono>{fmt(a.monthly_depreciation)}</Row>
            <Row label="Useful life" mono>{a.useful_life_months} months</Row>
            <Row label="Automatic depreciation from" mono>{month(a.depreciation_start_month)}</Row>
            <Row label="Months posted" mono>{a.months_posted}</Row>
            <Row label="Last posted month" mono>{month(a.last_posted_month)}</Row>
            <Row label="Accumulated depreciation" mono>{fmt(a.accumulated_depreciation)}</Row>
            <Row label="Net book value" mono><span data-testid="fa-detail-nbv">{fmt(a.net_book_value)}</span></Row>
          </dl>
        </Card>
      </div>

      {a.status === 'disposed' && (
        <Card variant="default" padding="md" className="space-y-3" data-testid="fa-detail-disposal">
          <SectionLabel as="h2" size="sm" className="text-gold">Disposal</SectionLabel>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Row label="Date" mono>{a.disposed_at ?? '—'}</Row>
            <Row label="Reason">{a.disposal_reason !== null ? FIXED_ASSET_DISPOSAL_REASON_LABEL[a.disposal_reason] : '—'}</Row>
            {a.disposal_price !== null && <Row label="Sale price" mono>{fmt(a.disposal_price)}</Row>}
            {a.disposal_proceeds_account_code !== null && <Row label="Received in" mono>{a.disposal_proceeds_account_code}</Row>}
            <Row label="Journal entry" mono>{a.disposal_entry_number ?? '—'}</Row>
            {a.disposal_notes !== null && <Row label="Notes">{a.disposal_notes}</Row>}
          </dl>
        </Card>
      )}

      <section className="space-y-2">
        <SectionLabel as="h2" size="sm" className="text-gold">Depreciation entries</SectionLabel>
        {a.depreciations.length === 0 ? (
          <p className="text-sm text-text-secondary">No depreciation posted yet. The server posts each month once it has ended.</p>
        ) : (
          <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-x-auto">
            <table className="w-full text-sm" data-testid="fa-depreciation-table">
              <caption className="sr-only">Monthly depreciation entries with status and journal entry number</caption>
              <thead>
                <tr className="border-b border-border-subtle bg-surface-inert text-left">
                  {['Month', 'Plan month', 'Entry date', 'Amount', 'Status', 'Journal entry'].map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-2.5 font-data ${i === 3 ? 'text-right' : ''}`}>
                      <SectionLabel as="span" size="xs">{h}</SectionLabel>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.depreciations.map((d) => (
                  <tr key={d.period_month} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-data tabular-nums">{month(d.period_month)}</td>
                    <td className="px-3 py-2 font-data tabular-nums text-text-secondary">{d.month_index} / {a.useful_life_months}</td>
                    <td className="px-3 py-2 font-data tabular-nums text-text-secondary">{d.entry_date}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(d.amount)}</td>
                    <td className="px-3 py-2">
                      <span className={d.status === 'posted' ? 'text-success' : 'text-warning'}>
                        {FIXED_ASSET_DEPRECIATION_STATUS_LABEL[d.status]}
                      </span>
                      {d.status === 'refused' && (
                        <span className="block text-xs text-text-muted">
                          {d.refused_reason ?? 'Closed period'}{d.attempts > 1 ? ` · ${d.attempts} attempts` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{d.entry_number ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {a.status === 'active' && canManage && (
        <DisposeFixedAssetDialog open={disposeOpen} onClose={() => setDisposeOpen(false)} asset={a} />
      )}
    </div>
  );
}
