// apps/pos/src/features/kds/components/RecallButton.tsx
//
// Session 13 / Phase 4.B — Recall button for a served order. Opens a Radix
// Dialog (Phase 1.D primitive) with a reason textarea and confirms by
// calling `kds_recall_order_v1`. Surfaces a toast with the recalled count.

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@breakery/ui';
import { toast } from 'sonner';

import { useKdsRecallOrder } from '../hooks/useKdsRecallOrder';

interface RecallButtonProps {
  orderId: string;
  orderNumber: string;
  disabled?: boolean;
}

export function RecallButton({ orderId, orderNumber, disabled }: RecallButtonProps) {
  const recall = useKdsRecallOrder();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    recall.mutate(
      { orderId, reason: reason.trim() || undefined },
      {
        onSuccess: (count: number) => {
          if (count === 0) {
            toast.info(`Order #${orderNumber} has no served items to recall.`);
          } else {
            toast.success(`Recalled ${count} item${count === 1 ? '' : 's'} on #${orderNumber}`);
          }
          setOpen(false);
          setReason('');
        },
        onError: (err: Error & { code?: string }) => {
          toast.error(err.message || 'Could not recall order');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          size="md"
          disabled={disabled}
          aria-label={`Recall served items on order ${orderNumber}`}
        >
          Recall
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recall order #{orderNumber}</DialogTitle>
          <DialogDescription>
            Move served items back to preparing. Optionally record a reason
            for the audit trail.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          rows={3}
          className="w-full rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary"
          aria-label="Recall reason"
        />
        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={recall.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={recall.isPending}
          >
            Confirm recall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
