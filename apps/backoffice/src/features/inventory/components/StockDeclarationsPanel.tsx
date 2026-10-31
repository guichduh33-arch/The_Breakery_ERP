import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FOCUS_RING } from '@/components/focusRing.js';
import { formatDateTimeShortWita } from '@breakery/utils';
import { Button } from '@/components/BackofficeUi.js';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import { invalidateStockQueries } from '../invalidateStockQueries.js';

interface Declaration {
  id: string;
  operation: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  reason: string;
  declared_by: string;
  declared_by_name: string;
  status: string;
  unit: string;
  created_at: string;
  display_withdrawal_applied: boolean;
}

const OPERATION_LABELS: Record<string, string> = { adjust: 'Physical stock count', waste: 'Stock loss', display_adjust: 'Display count', display_waste: 'Display loss' };

// Les mêmes règles sont revérifiées côté serveur ; aucun stock attendu n'est envoyé au déclarant.
export function StockDeclarationsPanel() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const owner = user?.role_code === 'SUPER_ADMIN';
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const declarations = useQuery({
    queryKey: ['stock-declarations', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_stock_declarations_v1');
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) throw new Error('Invalid declaration list');
      return data as unknown as Declaration[];
    },
  });
  const review = useMutation({
    mutationFn: async ({ id, reject }: { id: string; reject: boolean }) => {
      const response = reject
        ? await supabase.rpc('reject_stock_declaration_v1', { p_declaration_id: id, p_reason: reasons[id] ?? '' })
        : await supabase.rpc('approve_stock_declaration_v3', { p_declaration_id: id });
      if (response.error) throw new Error(response.error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['stock-declarations'] });
      await invalidateStockQueries(qc);
    },
  });
  return (
    <section className="space-y-3 rounded-md border border-border-subtle p-4" aria-label="Stock declarations">
      <h2 className="font-semibold text-text-primary">Stock declarations</h2>
      <p className="text-sm text-text-secondary">Global stock corrections and losses require independent owner approval. Display losses are removed from the display immediately.</p>
      {declarations.isLoading && <p role="status">Loading declarations…</p>}
      {declarations.error && <p role="alert">{declarations.error.message}</p>}
      {review.error && <p role="alert">{review.error.message}</p>}
      {!declarations.isLoading && !declarations.error && declarations.data?.length === 0 && <p>No declarations.</p>}
      {declarations.data?.map((row) => (
        <article key={row.id} className="space-y-2 border-t border-border-subtle pt-3">
          <h3 className="font-medium">{row.product_name} · {row.product_sku}</h3>
          <p className="text-sm">{OPERATION_LABELS[row.operation] ?? row.operation} · {row.quantity} {row.unit} · {row.status}</p>
          {row.operation === 'display_waste' && (
            <p className="text-sm text-text-secondary">
              {row.display_withdrawal_applied
                ? 'Display quantity already removed. Owner approval changes global stock only. Rejection does not restore the display quantity.'
                : 'Display withdrawal has not been applied.'}
            </p>
          )}
          <p className="text-sm text-text-secondary">{row.declared_by_name} — {row.reason}</p>
          <time className="block text-xs text-text-muted" dateTime={row.created_at}>{formatDateTimeShortWita(row.created_at)}</time>
          {owner && row.status === 'pending' && row.declared_by !== user?.id && (
            <div className="flex flex-wrap items-end gap-2">
              <Button variant="secondary" disabled={review.isPending} onClick={() => { review.mutate({ id: row.id, reject: false }); }}>
                Approve {row.product_name}
              </Button>
              <div>
                <label htmlFor={`reject-${row.id}`} className="block text-xs">Rejection reason</label>
                <input id={`reject-${row.id}`} value={reasons[row.id] ?? ''} maxLength={500}
                  className={`${FOCUS_RING} rounded border border-border-strong bg-bg-input p-2 text-sm`}
                  onChange={(e) => { setReasons((current) => ({ ...current, [row.id]: e.target.value })); }} />
              </div>
              <Button variant="ghostDestructive" disabled={review.isPending || (reasons[row.id]?.trim().length ?? 0) < 3}
                onClick={() => { review.mutate({ id: row.id, reject: true }); }}>Reject {row.product_name}</Button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
