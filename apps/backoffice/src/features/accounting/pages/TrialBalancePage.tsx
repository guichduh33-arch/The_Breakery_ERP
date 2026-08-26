// apps/backoffice/src/features/accounting/pages/TrialBalancePage.tsx
// Session 26b / Wave 4 — Trial Balance page.

import { useState, type JSX } from 'react';
import { Button, Input, SectionLabel } from '@breakery/ui';
import { formatCurrency, monthStartIsoDate, todayIsoDate } from '@breakery/utils';
import { Download } from 'lucide-react';
import {
  useTrialBalance,
} from '@/features/accounting/hooks/useTrialBalance.js';
import { downloadTrialBalanceCsv } from '@/features/accounting/components/exportTrialBalanceCsv.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';

const CLASS_LABELS: Record<number, string> = {
  1: 'Asset', 2: 'Liability', 3: 'Equity', 4: 'Revenue', 5: 'COGS', 6: 'Expense',
};

const fmt = formatCurrency;

const TB_HEAD: readonly { label: string; right: boolean }[] = [
  { label: 'Code',    right: false },
  { label: 'Name',    right: false },
  { label: 'Class',   right: false },
  { label: 'Debit',   right: true  },
  { label: 'Credit',  right: true  },
  { label: 'Balance', right: true  },
];

export default function TrialBalancePage(): JSX.Element {
  // Défaut MUTUALISÉ (`@breakery/utils`) : le calcul local passait par
  // `toISOString()`, donc par l'UTC, et rendait la veille entre minuit et 08 h
  // WITA. Le hub comptable précharge la balance avec ces mêmes helpers pour que
  // les deux clés de requête coïncident.
  const [startDate, setStartDate] = useState(monthStartIsoDate());
  const [endDate,   setEndDate]   = useState(todayIsoDate());
  const tb = useTrialBalance(startDate, endDate);

  // La page n'avait AUCUNE branche d'échec : requête refusée, elle rendait son
  // titre, ses deux champs de date, et plus rien — un écran qui se lit
  // « la période est vide » alors que le serveur n'a pas répondu. Patron du
  // journal (QueryErrorBanner + état vide qui se tait sous l'erreur).
  const tbError = tb.isError ? tb.error : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trial balance"
        subtitle="Asserts Σ debit = Σ credit across active accounts"
        actions={tb.data ? (
          <Button
            variant="secondary"
            onClick={() => downloadTrialBalanceCsv(tb.data)}
            className="inline-flex items-center gap-2"
            data-testid="tb-csv-export"
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          From
          <Input
            type="date" lang="id-ID" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1"
            data-testid="tb-filter-start"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          To
          <Input
            type="date" lang="id-ID" value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1"
            data-testid="tb-filter-end"
          />
        </label>
      </div>

      {tbError !== null && (
        <QueryErrorBanner
          detail={errorDetailText(tbError)}
          onRetry={() => { void tb.refetch(); }}
          data-testid="tb-error"
        >
          The trial balance could not be loaded — this period may well hold
          activity this request never reached.
        </QueryErrorBanner>
      )}

      {tb.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {tb.data && (
        <>
          <div data-testid="tb-balanced-badge">
            {tb.data.balanced ? (
              // Le GLYPHE est du bruit au lecteur d'écran — « check mark
              // Balanced » — là où le MOT porte déjà tout le fait. Il reste à
              // l'œil, `aria-hidden`, comme un simple renfort visuel.
              <span className="inline-flex items-center gap-2 rounded-sm bg-success-soft px-3 py-1 text-xs font-semibold text-success">
                <span aria-hidden>✓</span> Balanced
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-sm bg-red-soft px-3 py-1 text-xs font-semibold text-red">
                <span aria-hidden>✗</span> Unbalanced — Δ{' '}
                <span className="font-data tabular-nums">{fmt(Math.abs(tb.data.delta))}</span>
              </span>
            )}
          </div>

          <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-x-auto">
            <table className="w-full text-sm" data-testid="tb-table">
              <caption className="sr-only">Code, name, class, debit, credit and balance per account</caption>
              {/* Canon des tableaux (patron `WalletLedgerTable`) : papier
                  inerte et libellés en label mono capitales. */}
              <thead>
                <tr className="border-b border-border-subtle bg-surface-inert text-left">
                  {TB_HEAD.map((h) => (
                    <th
                      key={h.label}
                      scope="col"
                      className={`px-3 py-2.5 font-data ${h.right ? 'text-right' : ''}`}
                    >
                      <SectionLabel as="span" size="xs">{h.label}</SectionLabel>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tb.data.lines.map((line) => (
                  <tr
                    key={line.account_id}
                    data-testid={`tb-row-${line.code}`}
                    className="border-t border-border-subtle"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{line.code}</td>
                    <td className="px-3 py-2">{line.name}</td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {CLASS_LABELS[line.account_class] ?? line.account_class}
                    </td>
                    {/* `whitespace-nowrap` : « Rp 4.850.000 » se coupait au
                        « Rp » quand la colonne se resserre. */}
                    <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(line.total_debit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(line.total_credit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(line.balance)}</td>
                  </tr>
                ))}
              </tbody>
              {/* Le total est un PIED de tableau, pas une ligne de compte :
                  `<tfoot>` + `<th scope="row">` (patron `DailySalesPage`). En
                  `tbody`, il se lisait comme un compte de plus. */}
              <tfoot>
                <tr className="border-t-2 border-border-strong font-semibold">
                  <th scope="row" colSpan={3} className="px-3 py-2 text-right font-semibold">Total</th>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(tb.data.total_debit)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(tb.data.total_credit)}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* L'état vide n'est vrai que si le serveur a répondu. */}
      {!tb.isLoading && tbError === null && tb.data?.lines.length === 0 && (
        <p className="text-sm text-text-secondary">No activity in this period.</p>
      )}
    </div>
  );
}
