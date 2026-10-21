import { useState } from 'react';
import { Button, Currency, FullScreenModal, NumpadPin } from '@breakery/ui';
import { PENDING_MESSAGE } from '@breakery/utils';
import { usePendingRefundTargets, useRefundAttempt } from '../hooks/useRefundAttempt';
import { useRefundOrder, type RefundResponse } from '../hooks/useRefundOrder';

function PendingRefund({ target, onClose, onConfirmed }: {
  target: string; onClose: () => void; onConfirmed: (res: RefundResponse) => void;
}) {
  const attempt = useRefundAttempt(target, true);
  const mutation = useRefundOrder();
  const [error, setError] = useState<string | null>(null);
  const [pinKey, setPinKey] = useState(0);
  const saved = attempt.pending?.payload;
  return <FullScreenModal open accessibleTitle="Resume pending refund" onOpenChange={(open) => { if (!open) onClose(); }}>
    <div className="m-auto max-w-lg w-full p-6 space-y-4 bg-bg-elevated rounded-xl">
      <h2 className="text-xl font-bold">Resume pending refund</h2>
      <p>{PENDING_MESSAGE}</p>
      <p className="text-sm break-all">Order: {target}</p>
      {saved && <div className="space-y-2">
        <p>{saved.reason}</p>
        <ul>{saved.lines.map((line) => <li key={line.order_item_id}>{line.qty} × {line.order_item_id}</li>)}</ul>
        {saved.tenders.map((tender, i) => <p key={i}>{tender.method}: <Currency amount={tender.amount} /></p>)}
      </div>}
      {(attempt.storageError ?? error) && <p role="alert">{attempt.storageError ?? error}</p>}
      {!saved && !attempt.storageError && <p role="status">This attempt has changed. Close and reopen to check its result.</p>}
      <p className="text-sm font-semibold">Manager PIN</p>
      <NumpadPin key={pinKey} maxLength={6} isLoading={!saved || !attempt.allowed || attempt.busy || Boolean(attempt.storageError)}
        onSubmit={(managerPin) => { if (!saved) return; void (async () => {
          try {
            await attempt.submit(saved, async (payload, idempotencyKey, current) => {
              const result = await mutation.mutateAsync({ ...payload, managerPin, idempotencyKey, sessionGuard: current });
              if (current()) onConfirmed(result);
              return result;
            });
          } catch (err) { setError(err instanceof Error ? err.message : 'Refund confirmation unavailable'); setPinKey((n) => n + 1); }
        })(); }} />
      <Button variant="secondary" onClick={onClose}>Close</Button>
    </div>
  </FullScreenModal>;
}

export function PendingRefundRecovery({ onConfirmed }: { onConfirmed: (res: RefundResponse) => void }) {
  const { targets, error } = usePendingRefundTargets();
  const [target, setTarget] = useState<string | null>(null);
  return <>
    {error && <p role="alert">{error}</p>}
    {targets.length > 0 && <section aria-label="Pending refunds" className="space-y-2">
      <p>Refund confirmations need attention</p>
      {targets.map((id) => <Button key={id} variant="secondary" className="h-auto min-h-touch-min w-full whitespace-normal break-all text-left" onClick={() => setTarget(id)}>Resume pending refund — {id}</Button>)}
    </section>}
    {target && <PendingRefund key={target} target={target} onClose={() => setTarget(null)} onConfirmed={(res) => { setTarget(null); onConfirmed(res); }} />}
  </>;
}
