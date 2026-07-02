// apps/backoffice/src/features/accounting/pages/SettingsAccountingPage.tsx
// Session 26b / Wave 5 — Settings page exposant la gestion des périodes fiscales.
// Route /settings/accounting (style /settings/security S19).

import { useState, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { Lock, ChevronRight, CalendarCheck } from 'lucide-react';
import { useFiscalPeriods, type FiscalPeriodRow } from '../hooks/useFiscalPeriods.js';
import { FiscalPeriodModal } from '../components/FiscalPeriodModal.js';
import { AnnualCloseModal } from '../components/AnnualCloseModal.js';
import { useAuthStore } from '@/stores/authStore.js';

function statusBadgeClass(status: string): string {
  if (status === 'locked') return 'bg-red-soft text-red';
  if (status === 'closed') return 'bg-amber-100 text-amber-900';
  return 'bg-green-100 text-green-700';
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Accounting settings</h1>
          <p className="text-sm text-text-secondary italic">
            Manage fiscal periods (close / lock for backdating prevention)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canClose && (
            <Button
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
        </div>
      </div>

      {periods.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {rows.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden">
          <table className="w-full text-sm" data-testid="fp-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Closed at</th>
                <th className="px-3 py-2">Locked at</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`fp-row-${row.period_start}`}
                  className="border-t border-border-subtle"
                >
                  <td className="px-3 py-2">
                    {row.period_start} → {row.period_end}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.closed_at ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.locked_at ?? '—'}
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
