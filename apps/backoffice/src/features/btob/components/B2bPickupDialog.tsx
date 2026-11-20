import { useRef, useState, type JSX } from 'react';
import { Dialog, DialogDescription, Input } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import type { B2bInvoiceRow } from '../hooks/useB2bInvoices.js';
import { useUpdateB2bPickup } from '../hooks/useUpdateB2bPickup.js';

export function B2bPickupDialog({ order, delivered, onClose }: {
  order: B2bInvoiceRow; delivered: boolean; onClose: () => void;
}): JSX.Element {
  const [date, setDate] = useState(order.pickup_date ?? '');
  const mutation = useUpdateB2bPickup();
  const submitting = useRef(false);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
      <DialogContent>
        <DialogTitle>{delivered ? 'Confirm pickup' : 'Schedule pickup'} — {order.order_number}</DialogTitle>
        <DialogDescription>
          {delivered ? 'Confirm that the customer has collected this order. General stock is checked and deducted now. Payment is recorded separately.' : 'Set the date the customer will collect this order. Stock is not reserved or deducted until pickup is confirmed.'}
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          if (submitting.current || mutation.isPending) return;
          submitting.current = true;
          mutation.mutate({ orderId: order.invoice_id, delivered, ...(!delivered ? { pickupDate: date } : {}) }, {
            onSuccess: onClose,
            onSettled: () => { submitting.current = false; },
          });
        }}>
          {!delivered && <div>
            <label htmlFor="b2b-pickup-date">Pickup date</label>
            <Input id="b2b-pickup-date" type="date" required value={date} onChange={(e) => { setDate(e.target.value); }} />
          </div>}
          {mutation.error && <p role="alert" className="text-sm text-danger">{mutation.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || (!delivered && date === '')}>
              {mutation.isPending ? 'Saving…' : delivered ? 'Mark delivered' : 'Save pickup date'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
