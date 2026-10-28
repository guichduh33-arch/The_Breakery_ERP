import { Button } from '@/components/BackofficeUi.js';
import type { BankManageSnapshot } from '@/lib/bankAttemptSchema.js';
import { bankMoney } from './money.js';
import { useBankSuggestions } from './useBankQueries.js';
export function BankSuggestions({ reconciliationId, onReview }: { reconciliationId: string; onReview: (payload: BankManageSnapshot) => void }) {
  const query = useBankSuggestions(reconciliationId,true);
  const suggestions = query.data?.pages.flatMap((page) => page.items) ?? [];
  return <section aria-label="Exact match suggestions" className="rounded border border-border-subtle bg-bg-elevated p-4 space-y-3">
    <h2 className="font-medium">Exact match suggestions</h2><p className="text-sm text-text-secondary">Same date and amount, unique across all eligible unmatched lines. Ambiguous transactions require manual selection.</p>
    {query.isLoading && <p role="status">Checking suggestions…</p>}
    {query.error && <p role="alert" className="text-sm text-danger">{query.error.message}<Button variant="secondary" onClick={() => { void query.refetch(); }}>Retry</Button></p>}
    {!query.isLoading && !query.error && suggestions.length === 0 && <p className="text-sm">No unambiguous exact matches.</p>}
    <div className="max-h-72 overflow-auto divide-y divide-border-subtle">{suggestions.map((s) => <div key={s.bank_line_id} className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0"><p>{s.bank_date} · <span className="font-data whitespace-nowrap">{bankMoney(s.bank_amount)}</span> · {s.entry_number}</p><p className="break-words text-text-secondary">{s.bank_description} ↔ {s.gl_description}</p></div>
      <Button className="shrink-0" variant="secondary" onClick={() => onReview({ kind: 'match',reconciliationId,bankIds: [s.bank_line_id],glIds: [s.gl_line_id] })}>Review match</Button>
    </div>)}</div>
    {query.hasNextPage && <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>Load more suggestions</Button>}
  </section>;
}
