import { useRef, useState, type JSX } from 'react';
import { Dialog, DialogDescription, Input } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import {
  useCancelUnpaidOrder, useUnpaidOrderSnapshot, type CancelUnpaidAttempt,
} from '../hooks/useCancelUnpaidOrder.js';

interface Props { open: boolean; orderId: string | null; onClose: () => void }

/** Conserver cette modale montée pour garder la tentative après une réponse perdue. */
export function CancelUnpaidOrderModal({ open, orderId, onClose }: Props): JSX.Element {
  const attempt = useRef<CancelUnpaidAttempt | null>(null);
  const [resumeOpen, setResumeOpen] = useState(false);
  const activeOrderId = resumeOpen && attempt.current ? attempt.current.snapshot.id : orderId;
  const dialogOpen = open || resumeOpen;
  const query = useUnpaidOrderSnapshot(activeOrderId, dialogOpen);
  const mutation = useCancelUnpaidOrder();
  const [reason, setReason] = useState('');
  const [losses, setLosses] = useState<Record<string, string>>({});
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const snapshot = attempt.current?.snapshot ?? query.data;
  const lines = snapshot?.order_items.filter((item) => !item.is_cancelled) ?? [];
  const served = lines.some((item) => item.kitchen_status === 'served');
  const kitchenSent = snapshot?.order_items.some((item) => item.is_locked) ?? false;
  const frozen = attempt.current !== null;
  const changedOrder = snapshot !== undefined && snapshot.id !== activeOrderId;
  const validLosses = lines.every((item) => {
    const value = losses[item.id] ?? String(item.quantity);
    return value.trim() !== '' && Number.isFinite(Number(value))
      && Number(value) >= 0 && Number(value) <= item.quantity;
  });
  const canSubmit = snapshot !== undefined && !changedOrder && !served && kitchenSent
    && /^\d{6}$/.test(pin) && reason.trim().length >= 3 && validLosses
    && !canReview && !mutation.isPending && (frozen || (!query.isFetching && !query.isError));

  function clear(): void {
    attempt.current = null;
    setResumeOpen(false);
    setReason(''); setLosses({}); setPin(''); setError(null); setCanReview(false);
  }
  function close(): void {
    if (mutation.isPending) return;
    if (!attempt.current) clear();
    setResumeOpen(false);
    setPin('');
    onClose();
  }
  async function submit(): Promise<void> {
    if (!canSubmit || !snapshot) return;
    setError(null);
    attempt.current ??= {
      snapshot, reason: reason.trim(), idempotencyKey: crypto.randomUUID(),
      losses: lines.map((item) => ({
        id: item.id, waste_qty: item.is_locked ? Number(losses[item.id] ?? item.quantity) : 0,
      })),
    };
    try {
      await mutation.mutateAsync({ attempt: attempt.current, managerPin: pin });
      clear(); onClose();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const definitive = status === 400 || status === 404 || status === 409 || status === 422;
      setCanReview(definitive);
      setError(status === 409 ? 'The order changed. Review its current lines before trying again.'
        : status === 401 ? 'Check the manager PIN and your session, then retry the same attempt.'
        : status === 403 ? 'You do not have permission to cancel this order.'
        : definitive ? 'Cancellation was refused. Review the order and waste declarations.'
        : 'Cancellation is not confirmed. Retry this same attempt with the manager PIN.');
      setPin('');
    }
  }

  return (
    <>
    {!dialogOpen && frozen && (
      <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-warning">
        <span>Unconfirmed cancellation for {attempt.current?.snapshot.order_number}</span>
        <Button size="sm" variant="secondary" onClick={() => { setResumeOpen(true); }}>Resume unpaid void</Button>
      </div>
    )}
    <Dialog open={dialogOpen} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" role="alertdialog">
        <DialogTitle>Void unpaid order</DialogTitle>
        <DialogDescription>
          Cancels the unpaid order. Declare waste for items sent to the kitchen.
        </DialogDescription>
        {query.isLoading && !snapshot && <p role="status">Loading current order…</p>}
        {query.isError && !frozen && <p role="alert">The order could not be loaded. Close and try again.</p>}
        {snapshot && (
          <>
            <p className="font-data text-sm">{snapshot.order_number}</p>
            {changedOrder && <p role="alert">A previous cancellation is unconfirmed. Reopen that order to retry it.</p>}
            {lines.map((item) => (
              <div key={item.id} className="space-y-2 rounded-md border border-border-subtle p-3">
                <p>{item.name_snapshot} × {item.quantity}</p>
                {item.is_locked && (
                  <div>
                    <label htmlFor={`loss-${item.id}`}>Waste quantity (0–{item.quantity})</label>
                    <Input id={`loss-${item.id}`} type="number" min={0} max={item.quantity} step="any"
                      value={losses[item.id] ?? String(item.quantity)} disabled={frozen || served || mutation.isPending}
                      onChange={(event) => setLosses((values) => ({ ...values, [item.id]: event.target.value }))} />
                  </div>
                )}
              </div>
            ))}
            {served && <p role="alert">A served item cannot be cancelled in this flow.</p>}
            {!kitchenSent && <p role="alert">This order has no kitchen-sent items. Use the POS discard flow.</p>}
            <label htmlFor="cancel-unpaid-reason">Reason</label>
            <Input id="cancel-unpaid-reason" value={reason} disabled={frozen || mutation.isPending}
              onChange={(event) => setReason(event.target.value)} />
            <label htmlFor="cancel-unpaid-pin">Manager PIN</label>
            <Input id="cancel-unpaid-pin" type="password" inputMode="numeric" maxLength={6}
              value={pin} disabled={mutation.isPending} autoComplete="off"
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} />
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {canReview && <Button variant="secondary" onClick={() => { clear(); void query.refetch(); }}>Review current order</Button>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={mutation.isPending} onClick={close}>Close</Button>
          <Button variant="ink" className="bg-danger text-danger-fg hover:bg-danger-hover"
            disabled={!canSubmit} onClick={() => { void submit(); }}>
            {mutation.isPending ? 'Voiding…' : 'Void unpaid order'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
