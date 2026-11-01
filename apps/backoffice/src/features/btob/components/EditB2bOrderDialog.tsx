import { useState, type FormEvent } from 'react';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { PENDING_MESSAGE } from '@/lib/pendingFinancialAttempts.js';
import type { B2bEditSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
import { useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { useB2bEditData, useB2bEditProducts, useEditB2bOrder } from '../hooks/useEditB2bOrder.js';

interface Row { key: string; id?: string; product_id: string; name: string; quantity: string }

export function EditB2bOrderDialog({ orderId, orderNumber, onClose }: {
  orderId: string; orderNumber: string; onClose: () => void;
}) {
  const query = useB2bEditData(orderId);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogTitle>Edit order — {orderNumber}</DialogTitle>
      <DialogDescription>
        Change products, quantities and notes before collection or any payment.
        Existing prices are kept. Added products use the current B2B price.
      </DialogDescription>
      {query.isLoading && <p role="status">Loading order…</p>}
      {query.isError && <div role="alert">Could not load this order.
        <Button variant="secondary" onClick={() => { void query.refetch(); }}>Try again</Button>
      </div>}
      {query.data && <EditForm orderId={orderId} initial={query.data} onClose={onClose} />}
    </DialogContent>
  </Dialog>;
}

function EditForm({ orderId, initial, onClose }: {
  orderId: string; initial: NonNullable<ReturnType<typeof useB2bEditData>['data']>; onClose: () => void;
}) {
  const products = useB2bEditProducts();
  const attempt = useFinancialAttempt('b2bEdit', orderId, true);
  const mutation = useEditB2bOrder();
  const [rows, setRows] = useState<Row[]>(() => attempt.pending
    ? attempt.pending.payload.items.map((item) => ({ key: item.id ?? crypto.randomUUID(), ...item,
      name: initial.order_items.find((entry) => entry.product_id === item.product_id)?.name_snapshot ?? 'Previously selected product',
      quantity: String(item.quantity) }))
    : initial.order_items.filter((item) => !item.is_cancelled)
      .map((item) => ({ key: item.id, id: item.id, product_id: item.product_id,
        name: item.name_snapshot, quantity: String(item.quantity) })));
  const [notes, setNotes] = useState(attempt.pending?.payload.notes ?? initial.notes ?? '');
  const [revision] = useState(attempt.pending?.payload.expectedUpdatedAt ?? initial.updated_at);
  const [error, setError] = useState<string | null>(null);
  const busy = attempt.busy || mutation.isPending;
  const locked = busy || attempt.pending !== null || !attempt.allowed || Boolean(attempt.storageError);
  const valid = rows.length > 0 && rows.every((row) => row.product_id && Number.isFinite(Number(row.quantity))
    && Number(row.quantity) > 0 && Number(row.quantity) <= 9999999.999
    && /^\d+(\.\d{1,3})?$/.test(row.quantity));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (!attempt.pending && !valid)) return;
    setError(null);
    const snapshot: B2bEditSnapshot = { orderId, notes, expectedUpdatedAt: revision,
      items: rows.map((row) => ({ ...(row.id ? { id: row.id } : {}), product_id: row.product_id, quantity: Number(row.quantity) })) };
    const outcome = await attempt.submit(snapshot, (value, key, current) => mutation.mutateAsync({ snapshot: value, key, current }));
    if (!outcome.current) return;
    if (outcome.error) setError((outcome.error as Error).message);
    else onClose();
  }
  return <form className="mt-4 space-y-4" onSubmit={(event) => { void submit(event); }}>
    {attempt.pending && <p role="alert" className="text-sm text-warning">{PENDING_MESSAGE}</p>}
    {attempt.storageError && <p role="alert" className="text-sm text-danger">{attempt.storageError}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <fieldset disabled={locked} className="space-y-3">
      <legend className="mb-2 font-semibold">Order items</legend>
      {rows.map((row, index) => <div key={row.key} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor={`edit-product-${row.key}`} className="text-sm">Product {index + 1}</label>
          {row.id ? <p id={`edit-product-${row.key}`} className="py-2">{row.name}</p> :
            <Select id={`edit-product-${row.key}`} value={row.product_id} required onChange={(event) => {
              const value = event.target.value;
              setRows((previous) => previous.map((entry) => entry.key === row.key ? { ...entry, product_id: value } : entry));
            }}>
              <option value="">Select a product</option>
              {(products.data ?? []).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}
            </Select>}
        </div>
        <div className="w-28">
          <label htmlFor={`edit-qty-${row.key}`} className="text-sm">Quantity {index + 1}</label>
          <Input id={`edit-qty-${row.key}`} type="number" inputMode="decimal" min="0.001" step="0.001" required
            value={row.quantity} onChange={(event) => {
              const value = event.target.value;
              setRows((previous) => previous.map((entry) => entry.key === row.key ? { ...entry, quantity: value } : entry));
            }} />
        </div>
        <Button type="button" variant="secondary" aria-label={`Remove product ${index + 1}`}
          onClick={() => { setRows((previous) => previous.filter((entry) => entry.key !== row.key)); }}>Remove</Button>
      </div>)}
      {products.isError && <p role="alert">Could not load products. <Button type="button" variant="secondary"
        onClick={() => { void products.refetch(); }}>Retry products</Button></p>}
      <Button type="button" variant="secondary" disabled={rows.length >= 500 || !products.data}
        onClick={() => { setRows((previous) => [...previous, { key: crypto.randomUUID(), product_id: '', name: '', quantity: '1' }]); }}>
        Add product
      </Button>
      <div>
        <label htmlFor="b2b-edit-notes" className="text-sm">Notes</label>
        <textarea id="b2b-edit-notes" maxLength={10000} value={notes} onChange={(event) => { setNotes(event.target.value); }}
          className={`mt-1 w-full rounded-md border border-border-strong bg-bg-input p-2 text-sm text-text-primary placeholder:text-text-muted ${FOCUS_RING}`} rows={3} />
      </div>
    </fieldset>
    <p className="text-sm text-text-muted">The server updates the total, stock and customer balance together.</p>
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Close</Button>
      <Button type="submit" disabled={busy || !attempt.allowed || Boolean(attempt.storageError) || (!attempt.pending && !valid)}>
        {busy ? 'Saving…' : attempt.pending ? 'Check pending edit' : 'Save changes'}
      </Button>
    </div>
  </form>;
}
