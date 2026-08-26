// apps/backoffice/src/features/accounting/pages/SettingsAccountingPage.tsx
// Session 26b / Wave 5 — Settings page exposant la gestion des périodes fiscales.
// Route /settings/accounting (style /settings/security S19).

import { useState, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { formatDateTimeShortWita } from '@breakery/utils';
import { Lock, ChevronRight, CalendarCheck } from 'lucide-react';
import { useFiscalPeriods, type FiscalPeriodRow } from '../hooks/useFiscalPeriods.js';
import { fiscalPeriodLabel } from '../utils/fiscalPeriodLabel.js';
import { FiscalPeriodModal } from '../components/FiscalPeriodModal.js';
import { AnnualCloseModal } from '../components/AnnualCloseModal.js';
import { useAuthStore } from '@/stores/authStore.js';
import { PageHeader } from '@/components/PageHeader.js';

function statusBadgeClass(status: string): string {
  if (status === 'locked') return 'bg-red-soft text-red';
  if (status === 'closed') return 'bg-warning-soft text-warning';
  return 'bg-success-soft text-success';
}

export default function SettingsAccountingPage(): JSX.Element {
  const periods = useFiscalPeriods();
  const canClose = useAuthStore((s) => s.hasPermission('accounting.period.close'));
  const canCloseYear = useAuthStore((s) => s.hasPermission('accounting.year.close'));
  const [showAnnual, setShowAnnual]     = useState(false);
  const [pickedPeriod, setPickedPeriod] = useState<FiscalPeriodRow | null>(null);
  const [showAll, setShowAll]           = useState(false);

  function openModalFor(p: FiscalPeriodRow | null) {
    setPickedPeriod(p);
    setShowAll(true);
  }

  const rows = periods.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting settings"
        // `italic` retiré : l'italique n'est pas un rôle typographique de ce
        // thème (DESIGN.md § Typographie).
        subtitle="Manage fiscal periods (close / lock for backdating prevention)"
        actions={
          <>
            {canClose && (
              <Button
                variant="ink"
                onClick={() => openModalFor(null)}
                className="inline-flex items-center gap-2"
                data-testid="fp-new-btn"
              >
                <Lock className="h-4 w-4" aria-hidden />
                Close a period
              </Button>
            )}
            {canCloseYear && (
              <Button
                variant="secondary"
                onClick={() => setShowAnnual(true)}
                className="inline-flex items-center gap-2"
                data-testid="ac-open-btn"
              >
                <CalendarCheck className="h-4 w-4" aria-hidden />
                Annual close
              </Button>
            )}
          </>
        }
      />

      {periods.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {rows.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-x-auto">
          <table className="w-full text-sm" data-testid="fp-table">
            <caption className="sr-only">Period, status, closing date and locking date per fiscal period</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th scope="col" className="px-3 py-2">Period</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Closed at</th>
                <th scope="col" className="px-3 py-2">Locked at</th>
                <th scope="col" className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`fp-row-${row.period_start}`}
                  className="border-t border-border-subtle"
                >
                  {/* Un mois se nomme (« December 2027 ») — les bornes ISO
                      parlaient le dialecte de la base à l'endroit le plus
                      irréversible de l'app (critique design 2026-08-26). */}
                  <td className="px-3 py-2">
                    {fiscalPeriodLabel(row.period_start, row.period_end)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  {/* Le cran « ligne de table » du récapitulatif de dates.ts —
                      l'ISO à microsecondes reste dans l'audit-log, pas ici. */}
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.closed_at === null ? '—' : formatDateTimeShortWita(row.closed_at)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.locked_at === null ? '—' : formatDateTimeShortWita(row.locked_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canClose && row.status !== 'locked' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openModalFor(row)}
                        data-testid={`fp-action-${row.period_start}`}
                        className="inline-flex items-center gap-1"
                      >
                        {row.status === 'open' ? 'Close' : 'Lock'}
                        <ChevronRight className="h-3 w-3" aria-hidden />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAll && (
        <FiscalPeriodModal
          onClose={() => setShowAll(false)}
          initialPeriodId={pickedPeriod?.id}
        />
      )}

      {showAnnual && <AnnualCloseModal onClose={() => setShowAnnual(false)} />}
    </div>
  );
}
