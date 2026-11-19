// Rail de synthèse du relevé (archétype Document) : ce qui reste à expliquer
// — la seule surface encrée de la page —, les soldes, puis la frise d'états.
import { CheckCircle2, Circle } from 'lucide-react';
import type { BankDetail } from './contracts.js';
import { BANK_LABEL } from './bankUi.js';
import { bankMoney, decimalCents, decimalText } from './money.js';

function Row({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' | 'muted' | undefined }) {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-text-muted' : 'text-text-primary';
  return <div className="flex items-baseline justify-between gap-3 py-1.5"><dt className="text-sm text-text-secondary">{label}</dt>
    <dd className={`whitespace-nowrap font-data text-sm tabular-nums ${color}`}>{value}</dd></div>;
}
function Step({ reached, label, detail }: { reached: boolean; label: string; detail: string }) {
  const Icon = reached ? CheckCircle2 : Circle;
  return <li className="flex gap-2.5"><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${reached ? 'text-success' : 'text-text-inert'}`} aria-hidden />
    <div><p className={`text-sm ${reached ? 'text-text-primary' : 'text-text-secondary'}`}>{label}</p><p className="text-xs text-text-muted">{detail}</p></div></li>;
}

export function BankRail({ data, explained, total, openCount, openAmount, allLoaded }: {
  data: BankDetail; explained: number; total: number; openCount: number; openAmount: bigint; allLoaded: boolean;
}) {
  const rec = data.reconciliation;
  const progress = total === 0 ? 100 : Math.round((explained / total) * 100);
  const feesPosted = data.entries.reduce((sum,entry) => sum + decimalCents(entry.fee_amount),0n);
  const delta = data.balances.bank_closing === null ? null : decimalCents(data.balances.gl_closing) - decimalCents(data.balances.bank_closing);
  const balancesEntered = rec.opening_balance !== null && rec.closing_balance !== null;
  const finalized = rec.status === 'finalized';
  return <aside aria-label="Statement summary" className="space-y-4 lg:sticky lg:top-4">
    <section aria-label="Left to explain" className="rounded-md bg-ink p-4 text-ink-fg">
      <p className="font-data text-xs font-semibold uppercase tracking-[0.14em] text-ink-fg-dim">Left to explain</p>
      <p className="mt-1.5 whitespace-nowrap font-data text-[26px] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{bankMoney(decimalText(openAmount))}</p>
      <p className="mt-1 text-sm text-ink-fg-muted">{openCount} {openCount === 1 ? 'bank line' : 'bank lines'} open{allLoaded ? '' : ' among loaded lines'}</p>
      <div role="progressbar" aria-label="Bank lines explained" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-3 h-1.5 overflow-hidden rounded-sm bg-ink-raised">
        <div className="h-full bg-ink-success" style={{ width: `${progress}%` }} /></div>
      <p className="mt-1.5 font-data text-xs tabular-nums text-ink-fg-dim">{explained} of {total} explained · {progress}%</p>
    </section>
    <section aria-label="Balances" className="rounded-md border border-border-subtle bg-bg-elevated p-4">
      <h3 className={BANK_LABEL}>Balances</h3>
      <dl className="mt-2 divide-y divide-border-row">
        <Row label="Bank opening" value={rec.opening_balance === null ? 'Not entered' : bankMoney(data.balances.bank_opening)} tone={rec.opening_balance === null ? 'muted' : undefined} />
        <Row label="Bank closing" value={rec.closing_balance === null ? 'Not entered' : bankMoney(data.balances.bank_closing)} tone={rec.closing_balance === null ? 'muted' : undefined} />
        <Row label="Ledger closing" value={bankMoney(data.balances.gl_closing)} />
        <Row label="Ledger − bank" value={delta === null ? '—' : bankMoney(decimalText(delta))} tone={delta === null ? 'muted' : delta === 0n ? 'success' : 'danger'} />
        <Row label="Bank fees posted" value={bankMoney(decimalText(feesPosted))} />
      </dl>
    </section>
    <section aria-label="Progress" className="rounded-md border border-border-subtle bg-bg-elevated p-4">
      <h3 className={BANK_LABEL}>Progress</h3>
      <ol className="mt-3 space-y-3">
        <Step reached label="Statement imported" detail={`${data.imports.length} ${data.imports.length === 1 ? 'file' : 'files'} · ${rec.period_start} → ${rec.period_end}`} />
        <Step reached={explained === total && total > 0} label="Every bank line explained" detail="Grouped proposals first, then exact matches, then manual matching." />
        <Step reached={balancesEntered} label="Statement balances entered" detail={balancesEntered ? 'Opening and closing saved.' : 'Use Statement balances in the header.'} />
        <Step reached={finalized} label="Finalized" detail={finalized ? 'Frozen snapshot, further changes refused.' : 'Locks the period once everything agrees.'} />
      </ol>
    </section>
  </aside>;
}
