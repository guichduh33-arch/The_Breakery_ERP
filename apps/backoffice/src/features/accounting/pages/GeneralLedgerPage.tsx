// apps/backoffice/src/features/accounting/pages/GeneralLedgerPage.tsx
// Session 26b / Wave 3 — General Ledger drilldown page.
// Account selector + date range picker + lines table (running_balance computed
// client-side from opening_balance) + Load more button.

import { useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input } from '@breakery/ui';
import { formatCurrency, monthStartIsoDate, todayIsoDate } from '@breakery/utils';
import { useChartOfAccounts } from '@/features/accounting/hooks/useChartOfAccounts.js';
import {
  useGeneralLedger,
  type GLLineRaw,
} from '@/features/accounting/hooks/useGeneralLedger.js';
import { resolveJeSourceEntity } from '@/features/accounting/utils/resolveJeSourceEntity.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { FOCUS_RING } from '@/components/focusRing.js';

const fmt = formatCurrency;
// Défaut MUTUALISÉ (`@breakery/utils`) — même helper que le journal, la balance,
// les coffres et le hub. Le calcul local qu'il remplace passait par
// `toISOString()`, donc par l'UTC : entre minuit et 08 h WITA, la période
// s'ouvrait la veille, et le premier du mois métier tombait au mois précédent.

interface AccumulatedLine extends GLLineRaw {
  running_balance: number;
}

export default function GeneralLedgerPage(): JSX.Element {
  const accounts = useChartOfAccounts();
  const [searchParams] = useSearchParams();

  // S32 — seed initial state from URL params (?account_id=&start=&end=).
  // No 2-way sync — user changes don't write URL (deferred S33+).
  const initialAccountId = searchParams.get('account_id') ?? '';
  const initialStart     = searchParams.get('start')      ?? monthStartIsoDate();
  const initialEnd       = searchParams.get('end')        ?? todayIsoDate();

  const [accountId, setAccountId] = useState<string>(initialAccountId);
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate,   setEndDate]   = useState(initialEnd);

  // `useInfiniteQuery` : plus d'accumulateur maison. Changer de compte ou de
  // période change la clé de requête, donc réinitialise les pages — l'effet de
  // remise à zéro et celui qui poussait chaque page (avec un `setState` posé
  // dans l'updater d'un autre, que StrictMode pouvait rejouer) n'ont plus
  // d'objet.
  const gl = useGeneralLedger({ accountId: accountId || null, startDate, endDate });

  // Période et solde d'ouverture sont calculés sur la période entière côté RPC :
  // identiques sur toutes les pages, on les lit sur la première.
  const firstPage = gl.data?.pages[0] ?? null;
  const openingBalance = firstPage?.opening_balance ?? 0;

  const account = useMemo(
    () => (accounts.data ?? []).find((a) => a.id === accountId) ?? null,
    [accounts.data, accountId],
  );

  const lines = useMemo<GLLineRaw[]>(
    () => (gl.data?.pages ?? []).flatMap((p) => p.lines),
    [gl.data],
  );

  const accumulated = useMemo<AccumulatedLine[]>(() => {
    if (!account) return [];
    const out: AccumulatedLine[] = [];
    let running = openingBalance;
    for (const line of lines) {
      const delta =
        account.balance_type === 'debit'
          ? (Number(line.debit) - Number(line.credit))
          : (Number(line.credit) - Number(line.debit));
      running += delta;
      out.push({ ...line, running_balance: running });
    }
    return out;
  }, [lines, openingBalance, account]);

  // Aucune branche d'échec n'existait : un compte choisi et une requête refusée
  // laissaient la page sur ses trois filtres, sans table ni un mot. Même remède
  // que le journal et la balance — le bandeau dit ce qui manque, et « Try
  // again » évite de perdre le compte et la période déjà saisis.
  const glError = gl.isError ? gl.error : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="General ledger"
        subtitle="Drilldown by account with running balance"
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Account
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={`mt-1 rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm min-w-72 ${FOCUS_RING}`}
            data-testid="gl-account-select"
          >
            <option value="">— select an account —</option>
            {(accounts.data ?? [])
              .filter((a) => a.is_postable && a.is_active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          From
          <Input
            type="date" lang="id-ID"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1"
            data-testid="gl-filter-start"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          To
          <Input
            type="date" lang="id-ID"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1"
            data-testid="gl-filter-end"
          />
        </label>
      </div>

      {accountId === '' && (
        <p className="text-sm text-text-secondary">Pick an account to see its ledger.</p>
      )}

      {glError !== null && (
        <QueryErrorBanner
          detail={errorDetailText(glError)}
          onRetry={() => { void gl.refetch(); }}
          data-testid="gl-error"
        >
          This account&apos;s ledger could not be loaded — the period may well
          hold entries this request never reached.
        </QueryErrorBanner>
      )}

      {accountId !== '' && gl.isLoading && (
        <p className="text-sm text-text-secondary">Loading ledger…</p>
      )}

      {accountId !== '' && firstPage !== null && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-x-auto">
          <table className="w-full text-sm" data-testid="gl-table">
            <caption className="sr-only">Date, entry number, description, source, debit, credit and running balance for the selected account</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th scope="col" className="px-3 py-2">Date</th>
                <th scope="col" className="px-3 py-2">Entry #</th>
                <th scope="col" className="px-3 py-2">Description</th>
                <th scope="col" className="px-3 py-2">Source</th>
                <th scope="col" className="px-3 py-2 text-right">Debit</th>
                <th scope="col" className="px-3 py-2 text-right">Credit</th>
                <th scope="col" className="px-3 py-2 text-right">Running balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border-subtle bg-bg-overlay font-semibold">
                <td colSpan={6} className="px-3 py-2 text-right">Opening balance</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(openingBalance)}</td>
              </tr>
              {accumulated.map((line, idx) => {
                const source = resolveJeSourceEntity(line.reference_type, line.reference_id);
                return (
                  <tr
                    key={`${line.je_id}-${idx}`}
                    data-testid={`gl-row-${line.entry_number}`}
                    className="border-t border-border-subtle"
                  >
                    <td className="px-3 py-2">{line.entry_date}</td>
                    <td className="px-3 py-2 font-mono text-xs">{line.entry_number}</td>
                    <td className="px-3 py-2">
                      {line.description ?? '—'}
                      {line.line_description && (
                        <span className="ml-2 text-xs text-text-secondary">{line.line_description}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {source !== null ? (
                        <DrilldownLink
                          entity={source.entity}
                          id={source.id}
                          label={line.reference_type ?? '—'}
                          icon={false}
                        />
                      ) : (
                        <span className="text-text-secondary">{line.reference_type ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(line.debit) > 0 ? fmt(Number(line.debit)) : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(line.credit) > 0 ? fmt(Number(line.credit)) : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(line.running_balance)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border-strong font-semibold">
                <td colSpan={4} className="px-3 py-2 text-right">Period totals</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(firstPage.total_debit)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(firstPage.total_credit)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {gl.hasNextPage && (
        <Button
          variant="secondary"
          // `sm` (36 px) : le cran unique de « Load more » dans tout le
          // back-office. Sans lui ce bouton rendait au défaut `md`, soit 56 px —
          // le même contrôle existait en 32, 36 et 56 px sur six pages.
          size="sm"
          onClick={() => { void gl.fetchNextPage(); }}
          disabled={gl.isFetchingNextPage}
          data-testid="gl-load-more"
        >
          {gl.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
