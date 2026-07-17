// apps/pos/src/features/heldOrders/components/AttachTabCustomerButton.tsx
//
// Session 62 — Task 5 — "Ardoise" action on a fired counter order row in
// HeldOrdersModal. Opens the same customer picker the cart uses
// (`CustomerAttachModal`, search-only here — this flow expects an existing
// customer to gate credit against, no quick-create) and attaches it via
// `attach_tab_customer_v2` (Task 4). Extracted out of HeldOrdersModal.tsx to
// keep that file under the 500-line budget.

import { CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { useState, type JSX } from 'react';
import { cn } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { supabase } from '@/lib/supabase';
import { CustomerAttachModal } from '@/features/cart/CustomerAttachModal';
import type { Customer } from '@breakery/domain';
import type { CustomerWithCategory } from '@/stores/cartStore';
import {
  useAttachTabCustomer,
  type AttachTabCustomerErrorDetails,
} from '../hooks/useAttachTabCustomer';

// Same RPC + shape as the walk-in search wired in Pos.tsx's own
// CustomerAttachModal instance (search_customers_v3, S50 W1.4 dual gate).
async function searchCustomers(query: string): Promise<CustomerWithCategory[]> {
  if (query.trim().length < 2) return [];
  const { data } = await supabase.rpc('search_customers_v3', {
    p_query: query,
    p_limit: 10,
  });
  return (data ?? []).map((row) => ({
    ...row,
    category: (row as { category?: unknown }).category ?? null,
  })) as unknown as CustomerWithCategory[];
}

function creditLimitMessage(details: AttachTabCustomerErrorDetails): string {
  const c = details.creditLimit;
  if (!c) return 'Plafond ardoise dépassé pour ce client.';
  return (
    `Plafond ardoise dépassé — encours ${formatIdr(c.current_outstanding)} ` +
    `+ commande ${formatIdr(c.order_amount)} > plafond ${formatIdr(c.credit_limit)}`
  );
}

function errorMessage(err: Error): string {
  const details = (err as Error & { details?: AttachTabCustomerErrorDetails }).details;
  if (details?.error === 'credit_limit_exceeded') return creditLimitMessage(details);
  if (details?.error === 'customer_not_found_or_inactive') {
    return 'Ce client est introuvable ou inactif.';
  }
  if (details?.error === 'order_not_attachable') {
    return "Cette commande n'est plus attachable (déjà payée ou annulée).";
  }
  return err.message || "Impossible d'attacher ce client à l'ardoise.";
}

export function AttachTabCustomerButton({ orderId }: { orderId: string }): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const attach = useAttachTabCustomer();

  function handleSelect(customer: Customer): void {
    setPickerOpen(false);
    attach.mutate(
      { orderId, customerId: customer.id },
      {
        onSuccess: (result) => {
          toast.success(`Ardoise de ${result.customer_name} : ${formatIdr(result.total)}`);
        },
        onError: (err) => {
          toast.error(errorMessage(err));
        },
      },
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={attach.isPending}
        aria-label="Attach a named customer to this tab"
        className={cn(
          'h-11 px-3 inline-flex items-center justify-center gap-2 rounded-md',
          'text-blue-info border border-blue-info/30 bg-blue-info/10 hover:bg-blue-info/20',
          'transition-colors duration-fast motion-reduce:transition-none',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
      >
        <CreditCard className="h-4 w-4" aria-hidden />
        Ardoise
      </button>

      <CustomerAttachModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelect}
        searchFn={searchCustomers}
      />
    </>
  );
}
