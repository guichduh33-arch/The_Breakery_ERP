// apps/backoffice/src/pages/purchasing/NewPurchaseOrderPage.tsx
//
// Session 14 / Phase 5.A — header chrome aligned with the rest of the
// purchasing surfaces (breadcrumb + Fraunces heading). Form behaviour
// unchanged — POFormDraft still owns line items + validation.

import { useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
  const canCreate = hasPermission('purchasing.po.create');

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
      <nav className="flex items-center gap-2 text-xs text-text-secondary" aria-label="Breadcrumb">
        <Link to="/backoffice/purchasing" className="hover:text-text-primary">Purchasing</Link>
        <span aria-hidden>›</span>
        <Link to="/backoffice/purchasing/purchase-orders" className="hover:text-text-primary">Purchase Orders</Link>
        <span aria-hidden>›</span>
        <span className="text-text-primary">New</span>
      </nav>

      <Link
        to="/backoffice/purchasing/purchase-orders"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to purchase orders
      </Link>

      <header>
        <h1 className="font-display text-3xl text-text-primary">New Purchase Order</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Draft a PO. Receipt (goods + JE posting) happens later from the detail page.
        </p>
      </header>
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
