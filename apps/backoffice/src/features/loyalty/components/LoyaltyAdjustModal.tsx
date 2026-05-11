// apps/backoffice/src/features/loyalty/components/LoyaltyAdjustModal.tsx
//
// Wraps LoyaltyAdjustForm and dispatches the adjust_loyalty_points RPC.
// Maps known RPC errors to inline form errors per spec §3.6.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  LoyaltyAdjustForm,
  type LoyaltyAdjustFormValues,
} from '@breakery/ui';
import { useAdjustLoyaltyPoints, AdjustError } from '../hooks/useAdjustLoyaltyPoints.js';
import { LOYALTY_CUSTOMERS_QUERY_KEY, type CustomerListRow } from '../hooks/useLoyaltyCustomersList.js';
import { loyaltyHistoryKey } from '../hooks/useCustomerLoyaltyHistory.js';

export interface LoyaltyAdjustModalProps {
  customer: CustomerListRow | undefined;
  onClose: () => void;
}

export function LoyaltyAdjustModal({ customer, onClose }: LoyaltyAdjustModalProps) {
  const adjustMut = useAdjustLoyaltyPoints();
  const qc = useQueryClient();
  const open = customer !== undefined;
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(values: LoyaltyAdjustFormValues): Promise<void> {
    if (customer === undefined) return;
    setFormError(null);
    try {
      await adjustMut.mutateAsync({ customerId: customer.id, delta: values.delta, reason: values.reason });
      onClose();
    } catch (err) {
      if (err instanceof AdjustError) {
        switch (err.code) {
          case 'forbidden':            setFormError('You no longer have permission to adjust points. Please refresh.'); break;
          case 'insufficient_balance': setFormError(`Customer only has ${customer.loyalty_points.toLocaleString()} points.`); break;
          case 'customer_deleted':
            setFormError('This customer was deleted in another session. The list is being refreshed.');
            // Invalidate so the stale row disappears from the table.
            void qc.invalidateQueries({ queryKey: LOYALTY_CUSTOMERS_QUERY_KEY });
            void qc.invalidateQueries({ queryKey: loyaltyHistoryKey(customer.id) });
            break;
          case 'invalid_input':        setFormError('Invalid input.'); break;
          default:                     setFormError('Something went wrong. Please retry.');
        }
      } else {
        setFormError('Something went wrong. Please retry.');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setFormError(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Adjust points — {customer?.name}</DialogTitle>
        <DialogDescription className="sr-only">Manually credit or debit a customer's loyalty balance.</DialogDescription>
        {customer && (
          <>
            {formError !== null && <div className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">{formError}</div>}
            <LoyaltyAdjustForm
              currentBalance={customer.loyalty_points}
              onSubmit={handleSubmit}
              onCancel={() => { setFormError(null); onClose(); }}
              submitting={adjustMut.isPending}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
