import { Button } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { BANK_LABEL, BANK_TH } from './bankUi.js';
import { bankMoney, decimalCents } from './money.js';
export interface BankDisplayLine { id: string; date: string; label: string; reference: string; amount: string; matchId: string | null }
/** Un relevé exporte souvent ses libellés entre guillemets : on les retire à l'affichage, jamais à la donnée. */
const clean = (text: string) => text.replace(/^"+|"+$/g, '').trim();
export function BankLinesTable({ title, lines, selected, editable, onToggle, onUnmatch }: {
  title: string; lines: BankDisplayLine[]; selected: string[]; editable: boolean;
  onToggle: (id: string, checked: boolean) => void; onUnmatch: (matchId: string) => void;
}) {
  return <section aria-label={title} className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border-subtle bg-bg-elevated">
    <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5"><h3 className="text-sm font-semibold">{title}</h3>
      <span className="font-data text-xs text-text-muted">{lines.length} shown</span></div>
    <div className="max-h-[34rem] overflow-auto"><table className="w-full min-w-[30rem] table-fixed text-sm"><colgroup><col className="w-10" /><col className="w-[6.5rem]" /><col /><col className="w-[9.5rem]" /></colgroup>
      <thead className="sticky top-0 z-[1]"><tr><th scope="col" className={BANK_TH}><span className="sr-only">Select</span></th><th scope="col" className={BANK_TH}>Date</th>
        <th scope="col" className={BANK_TH}>Description</th><th scope="col" className={`${BANK_TH} text-right`}>Amount</th></tr></thead>
      <tbody>{lines.map((line) => {
        const checked = selected.includes(line.id);
        const negative = decimalCents(line.amount) < 0n;
        return <tr key={line.id} className={`border-t border-border-row ${checked ? 'bg-surface-4' : line.matchId ? 'text-text-muted' : 'hover:bg-surface-inert'}`}>
          <td className="px-3.5 py-2.5 align-top"><input className={FOCUS_RING} type="checkbox" aria-label={`Select ${title} ${line.date} ${line.id.slice(0,8)}`} checked={checked}
            disabled={!editable || Boolean(line.matchId)} onChange={(e) => onToggle(line.id,e.target.checked)} /></td>
          <td className="whitespace-nowrap px-1 py-2.5 align-top font-data text-xs tabular-nums">{line.date}</td>
          <td className="break-words px-3.5 py-2.5 align-top"><p className={line.matchId ? '' : 'text-text-primary'}>{clean(line.label) || 'No description'}</p>
            {line.reference && <p className="font-data text-xs text-text-muted">{line.reference}</p>}</td>
          <td className="px-3.5 py-2.5 text-right align-top"><span className={`whitespace-nowrap font-data tabular-nums ${line.matchId ? '' : negative ? 'text-text-primary' : 'text-success'}`}>{bankMoney(line.amount)}</span>
            {line.matchId && <p className={BANK_LABEL}>Matched</p>}
            {line.matchId && editable && <Button variant="ghost" size="sm" className="-mr-2 h-7 px-2 text-xs" onClick={() => onUnmatch(line.matchId!)}>Remove match</Button>}</td>
        </tr>;
      })}</tbody>
    </table>
    {lines.length === 0 && <p className="p-5 text-sm text-text-secondary">No lines in this selection.</p>}</div>
  </section>;
}
