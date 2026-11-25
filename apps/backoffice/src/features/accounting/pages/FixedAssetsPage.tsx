// apps/backoffice/src/features/accounting/pages/FixedAssetsPage.tsx
//
// ADR-047 — registre des équipements amortis. Lecture sous
// `reports.statements.read` (décision 9, gate de route + gate serveur).
// Les chiffres sont ceux du serveur : cumul, valeur nette et mois refusés
// viennent de `get_fixed_assets_v1`, l'écran ne recalcule que les totaux.
//
// Un mois refusé (période fermée) n'est jamais reporté sur un autre mois
// (ADR-047, « Écriture de dotation ») : il est signalé sur la ligne, sinon il
// passerait inaperçu jusqu'au bilan.

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Package, Plus } from 'lucide-react';
import { formatCurrency } from '@breakery/utils';
import { EmptyState } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useFixedAssets } from '../hooks/useFixedAssets.js';
import { RegisterFixedAssetDialog } from '../components/RegisterFixedAssetDialog.js';
import {
  FIXED_ASSET_STATUS_LABEL,
  FIXED_ASSET_TAX_GROUP_LABEL,
  FIXED_ASSET_TYPE_LABEL,
  activeTotals,
} from '../components/fixedAssetContract.js';

const fmt = formatCurrency;

const HEAD: readonly { label: string; right: boolean }[] = [
  { label: 'Number',       right: false },
  { label: 'Name',         right: false },
  { label: 'Type',         right: false },
  { label: 'Tax group',    right: false },
  { label: 'In service',   right: false },
  { label: 'Cost',         right: true  },
  { label: 'Accumulated',  right: true  },
  { label: 'Net book value', right: true },
  { label: 'Status',       right: false },
];

export default function FixedAssetsPage(): JSX.Element {
  const q = useFixedAssets();
  const canManage = useAuthStore((s) => s.hasPermission('accounting.fixed_assets.manage'));
  const [registerOpen, setRegisterOpen] = useState(false);

  const rows = q.data ?? [];
  const totals = activeTotals(rows);
  const qError = q.isError ? q.error : null;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Finance</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Fixed assets</span>
      </nav>

      <PageHeader
        title="Fixed assets"
        subtitle="Equipment depreciated monthly by the server, straight-line over its tax group"
        actions={canManage ? (
          <button
            type="button"
            className={TOOLBAR_BTN_PRIMARY}
            onClick={() => setRegisterOpen(true)}
            data-testid="fa-register-open"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Register existing asset
          </button>
        ) : undefined}
      />

      {qError !== null && (
        <QueryErrorBanner detail={errorDetailText(qError)} onRetry={() => { void q.refetch(); }} data-testid="fa-error">
          The fixed asset register could not be loaded.
        </QueryErrorBanner>
      )}

      {q.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {q.data && rows.length === 0 && (
        <EmptyState
          icon={Package}
          title="No fixed assets yet"
          description="Equipment enters the register when an expense marked as equipment is approved."
          size="md"
        />
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-x-auto">
          <table className="w-full text-sm" data-testid="fa-table">
            <caption className="sr-only">Fixed assets with cost, accumulated depreciation and net book value</caption>
            <thead>
              <tr className="border-b border-border-subtle bg-surface-inert text-left">
                {HEAD.map((h) => (
                  <th key={h.label} scope="col" className={`px-3 py-2.5 font-data ${h.right ? 'text-right' : ''}`}>
                    <SectionLabel as="span" size="xs">{h.label}</SectionLabel>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-border-subtle" data-testid={`fa-row-${a.asset_number}`}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      to={`/backoffice/accounting/fixed-assets/${a.id}`}
                      className={`text-gold hover:underline ${FOCUS_RING}`}
                      aria-label={`Open ${a.asset_number} ${a.name}`}
                    >
                      {a.asset_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{a.name}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{FIXED_ASSET_TYPE_LABEL[a.asset_type]}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{FIXED_ASSET_TAX_GROUP_LABEL[a.tax_group]}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-data tabular-nums text-xs">{a.in_service_date}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(a.cost)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(a.accumulated_depreciation)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(a.net_book_value)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        a.status === 'active' ? 'bg-success-soft text-success' : 'bg-surface-inert text-text-secondary'
                      }`}>
                        {FIXED_ASSET_STATUS_LABEL[a.status]}
                      </span>
                      {a.refused_months > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-sm bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning"
                          data-testid={`fa-refused-${a.asset_number}`}
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {a.refused_months} {a.refused_months === 1 ? 'month' : 'months'} refused (closed period)
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-strong font-semibold">
                <th scope="row" colSpan={5} className="px-3 py-2 text-right font-semibold">
                  Total of active assets ({totals.count})
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums" data-testid="fa-total-cost">{fmt(totals.cost)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums" data-testid="fa-total-accumulated">{fmt(totals.accumulated)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums" data-testid="fa-total-net">{fmt(totals.net)}</td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canManage && <RegisterFixedAssetDialog open={registerOpen} onClose={() => setRegisterOpen(false)} />}
    </div>
  );
}
