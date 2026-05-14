// apps/backoffice/src/pages/purchasing/NewPurchaseOrderPage.tsx
//
// Session 13 — Phase 3.A — Page wrapping POFormDraft + Create RPC call.

import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore.js';
import {
  POFormDraft,
  emptyPOFormDraftValue,
  validatePOFormDraft,
  toCreatePOItems,
  type POFormDraftValue,
} from '@/features/purchasing/components/POFormDraft.js';
import { useCreatePurchaseOrder } from '@/features/purchasing/hooks/useCreatePurchaseOrder.js';
import { useSuppliersList } from '@/features/suppliers/hooks/useSuppliersList.js';
import { useAllProductsForPO } from '@/features/purchasing/hooks/useAllProductsForPO.js';

export default function NewPurchaseOrderPage(): JSX.Element {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('purchasing.po.create' as never);

  const [value, setValue]     = useState<POFormDraftValue>(emptyPOFormDraftValue);
  const [error, setError]     = useState<string | undefined>(undefined);
  const create                = useCreatePurchaseOrder();
  const suppliers             = useSuppliersList({ active: 'active' });
  const products              = useAllProductsForPO();

  if (!canCreate) {
    return <div className="text-text-secondary">You do not have permission to create purchase orders.</div>;
  }

  async function handleSubmit(): Promise<void> {
    setError(undefined);
    const validation = validatePOFormDraft(value);
    if (validation !== undefined) { setError(validation); return; }
    try {
      const res = await create.mutateAsync({
        supplierId:    value.supplierId,
        items:         toCreatePOItems(value),
        ...(value.expectedDate !== '' ? { expectedDate: value.expectedDate } : {}),
        ...(value.orderDate !== '' ? { orderDate: value.orderDate } : {}),
        paymentTerms:  value.paymentTerms,
        vatRate:       value.vatRate,
        ...(value.notes.trim() !== '' ? { notes: value.notes.trim() } : {}),
      });
      navigate(`/backoffice/purchasing/purchase-orders/${res.po_id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-serif text-3xl">New Purchase Order</h1>
        <p className="text-text-secondary text-sm mt-1">
          Draft a PO. Receipt (goods + JE posting) happens later from the detail page.
        </p>
      </div>
      <POFormDraft
        value={value}
        onChange={setValue}
        suppliers={(suppliers.data ?? []).map((s) => ({ id: s.id, code: s.code, name: s.name }))}
        products={(products.data ?? [])}
        onSubmit={() => { void handleSubmit(); }}
        submitting={create.isPending}
        {...(error !== undefined ? { error } : {})}
      />
    </div>
  );
}
