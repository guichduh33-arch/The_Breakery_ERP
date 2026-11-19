import { Button } from '@/components/BackofficeUi.js';
import type { BankManageSnapshot } from '@/lib/bankAttemptSchema.js';
import { BANK_TD } from './bankUi.js';
import { bankMoney } from './money.js';
import { useBankSuggestions } from './useBankQueries.js';
const clean = (text: string) => text.replace(/"/g, '').trim();
export function BankSuggestions({ reconciliationId, onReview }: { reconciliationId: string; onReview: (payload: BankManageSnapshot) => void }) {
  const query = useBankSuggestions(reconciliationId,true);
  const suggestions = query.data?.pages.flatMap((page) => page.items) ?? [];
  return <section aria-label="Exact match suggestions" className="overflow-hidden rounded-md border border-border-subtle bg-bg-elevated">
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3.5"><h2 className="text-lg font-medium tracking-tight">Exact matches</h2>
      <p className="text-xs text-text-muted">Same date and amount, one candidate on each side.</p></div>
    {query.isLoading && <p role="status" className="px-4 py-3 text-sm">Checking suggestions…</p>}
    {query.error && <p role="alert" className="px-4 py-3 text-sm text-danger">{query.error.message} <Button variant="secondary" onClick={() => { void query.refetch(); }}>Retry</Button></p>}
    {!query.isLoading && !query.error && suggestions.length === 0 && <p className="px-4 py-3 text-sm text-text-secondary">No unambiguous exact match. Ambiguous lines stay for manual matching.</p>}
    {suggestions.length > 0 && <div className="mt-2 max-h-72 overflow-auto"><table className="w-full min-w-[36rem] text-sm"><tbody>{suggestions.map((s) => <tr key={s.bank_line_id} className="border-t border-border-row">
      <td className={`${BANK_TD} whitespace-nowrap font-data text-xs`}>{s.bank_date}</td>
      <td className={`${BANK_TD} break-words`}><p>{clean(s.bank_description)}</p><p className="text-xs text-text-muted"><span className="font-data">{s.entry_number}</span> · {s.gl_description}</p></td>
      <td className={`${BANK_TD} whitespace-nowrap text-right font-data tabular-nums`}>{bankMoney(s.bank_amount)}</td>
      <td className={`${BANK_TD} text-right`}><Button variant="secondary" onClick={() => onReview({ kind: 'match',reconciliationId,bankIds: [s.bank_line_id],glIds: [s.gl_line_id] })}>Review match</Button></td>
    </tr>)}</tbody></table></div>}
    {query.hasNextPage && <div className="border-t border-border-subtle px-4 py-2.5"><Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>Load more suggestions</Button></div>}
  </section>;
}
