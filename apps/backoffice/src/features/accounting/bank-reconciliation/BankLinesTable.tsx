import { Button } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { bankMoney } from './money.js';
export interface BankDisplayLine { id: string; date: string; label: string; reference: string; amount: string; matchId: string | null }
export function BankLinesTable({ title, lines, selected, editable, onToggle, onUnmatch }: {
  title: string; lines: BankDisplayLine[]; selected: string[]; editable: boolean;
  onToggle: (id: string, checked: boolean) => void; onUnmatch: (matchId: string) => void;
}) {
  return <section aria-label={title} className="min-w-0 rounded border border-border-subtle bg-bg-elevated">
    <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle p-3"><h2 className="font-medium">{title}</h2><span className="text-xs text-text-secondary">{lines.length} loaded</span></div>
    <div className="max-h-[34rem] overflow-auto"><table className="w-full min-w-[34rem] table-fixed text-sm"><colgroup><col className="w-10" /><col className="w-[24%]" /><col /><col className="w-[27%]" /></colgroup>
      <thead className="sticky top-0 bg-bg-elevated"><tr><th scope="col"><span className="sr-only">Select</span></th><th scope="col">Date / source</th><th scope="col">Description</th><th scope="col">Amount / status</th></tr></thead>
      <tbody>{lines.map((line) => <tr key={line.id} className="border-t border-border-subtle">
        <td className="align-top"><input className={FOCUS_RING} type="checkbox" aria-label={`Select ${title} ${line.date} ${line.id.slice(0,8)}`} checked={selected.includes(line.id)} disabled={!editable || Boolean(line.matchId)} onChange={(e) => onToggle(line.id,e.target.checked)} /></td>
        <td className="align-top"><span className="whitespace-nowrap">{line.date}</span><p className="break-words text-xs text-text-secondary">{line.reference || 'No reference'}</p></td>
        <td className="break-words align-top">{line.label}</td>
        <td className="align-top"><span className="whitespace-nowrap font-data tabular-nums">{bankMoney(line.amount)}</span><p className="text-xs text-text-secondary">{line.matchId ? 'Matched' : 'Unmatched'}</p>
          {line.matchId && editable && <Button variant="ghost" size="sm" onClick={() => onUnmatch(line.matchId!)}>Remove match</Button>}</td>
      </tr>)}</tbody>
    </table></div>
    {lines.length === 0 && <p className="p-5 text-sm text-text-secondary">No lines in this selection.</p>}
  </section>;
}
