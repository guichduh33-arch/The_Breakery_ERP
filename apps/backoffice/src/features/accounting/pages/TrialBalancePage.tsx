// apps/backoffice/src/features/accounting/pages/TrialBalancePage.tsx
// Session 26b / Wave 4 — Trial Balance page.

import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';
import { formatCurrency, monthStartIsoDate, todayIsoDate } from '@breakery/utils';
import { Download, ChevronRight } from 'lucide-react';
import {
  useTrialBalance,
} from '@/features/accounting/hooks/useTrialBalance.js';
import { downloadTrialBalanceCsv } from '@/features/accounting/components/exportTrialBalanceCsv.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';

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
      {/* Critique 2026-08-31 — comptabilité et inventaire étaient les seuls
          domaines sans fil d'Ariane. Motif recopié d'OrdersListPage, en ligne :
          en extraire un composant partagé serait une décision d'architecture. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Finance</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Trial balance</span>
      </nav>

      <PageHeader
        title="Trial balance"
        subtitle="Asserts Σ debit = Σ credit across active accounts"
        // Bandeau de page = `TOOLBAR_BTN_*` (32 px), pas le primitif partagé
        // (56 px) — DESIGN.md § Components. Un export n'est pas une création :
        // il reste secondaire, la page ne porte donc aucun aplat encre.
        actions={tb.data ? (
          <button
            type="button"
            className={TOOLBAR_BTN_SECONDARY}
            onClick={() => downloadTrialBalanceCsv(tb.data)}
            data-testid="tb-csv-export"
          >
            <Download className={TOOLBAR_ICON} aria-hidden />
            Export CSV
          </button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="font-data font-semibold flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          From
          <Input
            type="date" lang="id-ID" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 h-9"
            data-testid="tb-filter-start"
          />
        </label>
        <label className="font-data font-semibold flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          To
          <Input
            type="date" lang="id-ID" value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 h-9"
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
                    {/* Critique 2026-08-31 — la balance rendait des `<tr>` nus :
                        aucun lien, aucun handler. On ne pouvait pas aller de
                        « 1141 Inventory · Rp 18.813.000 » aux écritures qui le
                        composent, sur l'écran comptable phare d'un produit dont
                        trois principes sur cinq portent sur la traçabilité.
                        Le lien est porté par le CODE (l'identifiant), comme le
                        numéro de bon l'est dans la liste des achats — une ligne
                        entière cliquable n'est ni focalisable ni annonçable.
                        `buildDrilldownUrl('account', …)` existait déjà et visait
                        exactement cette route ; il n'avait simplement aucun
                        appelant ici. La période affichée voyage avec le lien. */}
                    <td className="px-3 py-2 font-mono text-xs">
                      {(() => {
                        const href = buildDrilldownUrl(
                          'account', line.account_id, { start: startDate, end: endDate },
                        );
                        // `href` ne peut être null que sur un `account_id` vide.
                        // On rend alors le code EN CLAIR : un lien mort (`#`)
                        // ment davantage qu'un texte qui n'en est pas un.
                        return href === null ? line.code : (
                          <Link
                            to={href}
                            className={`text-gold hover:underline ${FOCUS_RING}`}
                            aria-label={`Open the general ledger for ${line.code} ${line.name}`}
                            data-testid={`tb-drilldown-${line.code}`}
                          >
                            {line.code}
                          </Link>
                        );
                      })()}
                    </td>
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
