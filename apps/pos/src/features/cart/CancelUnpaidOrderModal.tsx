import { useRef, useState } from 'react';
import { Button, FullScreenModal, Input, NumpadPin } from '@breakery/ui';
import { useUnpaidOrderSnapshot } from './hooks/useUnpaidOrderSnapshot';
import { useCancelUnpaidOrder, type CancelUnpaidAttempt } from './hooks/useCancelUnpaidOrder';

interface Props { open: boolean; orderId: string | null; onClose: () => void }
export function CancelUnpaidOrderModal({ open, orderId, onClose }: Props) {
  const query = useUnpaidOrderSnapshot(orderId, open);
  const mutation = useCancelUnpaidOrder();
  const attempt = useRef<CancelUnpaidAttempt | null>(null);
  const [reason, setReason] = useState('');
  const [losses, setLosses] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [pinKey, setPinKey] = useState(0);
  const snapshot = attempt.current?.snapshot ?? query.data;
  const lines = snapshot?.order_items.filter((item) => !item.is_cancelled) ?? [];
  const served = lines.some((item) => item.kitchen_status === 'served');
  const frozen = attempt.current !== null;
  const changedOrder = Boolean(snapshot && snapshot.id !== orderId);

  function clear() {
    attempt.current = null;
    setReason(''); setLosses({}); setError(null); setCanReview(false);
    setPinKey((key) => key + 1);
  }
  function close() {
    if (mutation.isPending) return;
    // Une réponse perdue garde la clé et le contenu au prochain affichage.
    if (!attempt.current) clear();
    onClose();
  }
  async function submit(managerPin: string) {
    if (snapshot?.id !== orderId || !snapshot || served || mutation.isPending) return;
    if (!attempt.current && (query.isFetching || query.isError)) return;
    setError(null); setCanReview(false);
    if (!attempt.current) {
      if (reason.trim().length < 3) { setError('Enter a reason (at least 3 characters).'); return; }
      const declarations = lines.map((item) => ({ id: item.id,
        waste_qty: item.is_locked ? Number(losses[item.id] ?? item.quantity) : 0 }));
      if (declarations.some((item, index) => !Number.isFinite(item.waste_qty) || item.waste_qty < 0
        || item.waste_qty > (lines[index]?.quantity ?? 0) || losses[item.id] === '')) {
        setError('Declare a waste quantity between zero and the line quantity.'); return;
      }
      attempt.current = { snapshot, reason: reason.trim(), losses: declarations, idempotencyKey: crypto.randomUUID() };
    }
    try {
      await mutation.mutateAsync({ attempt: attempt.current, managerPin });
      clear(); onClose();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const definitive = status === 400 || status === 409 || status === 422;
      setCanReview(definitive);
      setError(status === 409 ? 'The order changed. Review its current lines before trying again.'
        : definitive ? 'Cancellation was refused. Review the order and waste declarations.'
        : 'Cancellation is not confirmed. Retry this same attempt with the manager PIN.');
      setPinKey((key) => key + 1);
    }
  }
  return <FullScreenModal open={open} onOpenChange={(value) => { if (!value) close(); }} accessibleTitle="Cancel unpaid order" className="overflow-y-auto">
    <div className="mx-auto w-full max-w-xl space-y-4 p-6">
      <h2 className="text-xl font-bold">Cancel unpaid order</h2>
      <p>No payment will be refunded. Declare waste for each item sent to the kitchen.</p>
      {query.isLoading && !snapshot && <p role="status">Loading current order…</p>}
      {query.isError && !snapshot && <p role="alert">The order could not be loaded. Close and try again.</p>}
      {snapshot && <>
        <p>{snapshot.order_number}</p>
        {changedOrder && <p role="alert">A previous cancellation is unconfirmed. Restore this order to retry the same attempt.</p>}
        {lines.map((item) => <div key={item.id} className="space-y-2 rounded-md border border-border-subtle p-3">
          <p>{item.name_snapshot} × {item.quantity}</p>
          {item.is_locked ? <>
            <label htmlFor={`loss-${item.id}`}>Waste quantity (0–{item.quantity})</label>
            <Input id={`loss-${item.id}`} type="number" min={0} max={item.quantity} step="any"
              value={losses[item.id] ?? String(item.quantity)} disabled={frozen || served || mutation.isPending}
              onChange={(event) => setLosses((values) => ({ ...values, [item.id]: event.target.value }))} />
          </> : <p>Not sent to kitchen — no waste.</p>}
        </div>)}
        {served && <p role="alert">A served item cannot be cancelled in this flow.</p>}
        <label htmlFor="cancel-unpaid-reason">Reason</label>
        <Input id="cancel-unpaid-reason" value={reason} disabled={frozen || mutation.isPending}
          onChange={(event) => setReason(event.target.value)} data-vkp="qwerty" />
        {error && <p role="alert">{error}</p>}
        {canReview && <Button onClick={() => { clear(); void query.refetch(); }}>Review current order</Button>}
        {!served && !canReview && !changedOrder && <NumpadPin key={pinKey} isLoading={mutation.isPending || (!frozen && query.isFetching)} onSubmit={(pin) => { void submit(pin); }} />}
      </>}
      <Button variant="secondary" disabled={mutation.isPending} onClick={close}>Close</Button>
    </div>
  </FullScreenModal>;
}
