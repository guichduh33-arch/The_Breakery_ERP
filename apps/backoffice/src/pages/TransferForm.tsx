// apps/backoffice/src/pages/TransferForm.tsx
//
// Session 12 — Phase 3 — page hosting the New Transfer form. Combines the
// TransferFormFields header + TransferItemsTable. Submits via the
// useCreateTransfer mutation; on success navigates to the detail page.
//
// Spec ref: docs/reference/04-modules/06-inventory-stock.md §III (Phase 3 UI)

import { useState, type FormEvent, type JSX } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@breakery/ui';
import { validateTransferInput } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import {
  useCreateTransfer,
  CreateTransferError,
} from '@/features/inventory-transfers/hooks/useCreateTransfer.js';
import {
  TransferFormFields,
  type TransferFormFieldsValue,
} from '@/features/inventory-transfers/components/TransferFormFields.js';
import {
  TransferItemsTable,
  type TransferItemDraft,
} from '@/features/inventory-transfers/components/TransferItemsTable.js';

const EMPTY_HEADER: TransferFormFieldsValue = {
  fromSectionId: '',
  toSectionId:   '',
  notes:         '',
  sendDirectly:  false,
};

export default function TransferFormPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate     = hasPermission('inventory.transfer.create');
  const navigate      = useNavigate();
  const sections      = useSections();
  const createMut     = useCreateTransfer();

  const [header,    setHeader   ] = useState<TransferFormFieldsValue>(EMPTY_HEADER);
  const [items,     setItems    ] = useState<TransferItemDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  if (!canCreate) {
    return (
      <div className="text-text-secondary">
        You do not have permission to create transfers.
      </div>
    );
  }

  const canSubmit =
    header.fromSectionId !== '' &&
    header.toSectionId   !== '' &&
    header.fromSectionId !== header.toSectionId &&
    items.length > 0 &&
    items.every((it) => Number.isFinite(it.quantity) && it.quantity > 0) &&
    !createMut.isPending;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;

    const v = validateTransferInput({
      from_section_id: header.fromSectionId,
      to_section_id:   header.toSectionId,
      items: items.map((it) => ({
        product_id: it.productId,
        quantity:   it.quantity,
      })),
    });
    if (!v.valid) {
      switch (v.code) {
        case 'from_to_same_section':
          setFormError('From and To sections must differ.');
          break;
        case 'items_required':
          setFormError('Add at least one product line.');
          break;
        case 'duplicate_product_in_items':
          setFormError('The same product appears more than once. Combine the rows.');
          break;
        case 'quantity_must_be_positive':
          setFormError('Each line must have a positive quantity.');
          break;
        case 'product_id_required':
          setFormError('Internal error: a line is missing a product.');
          break;
        default:
          setFormError('Invalid input.');
      }
      return;
    }

    setFormError(null);
    try {
      const result = await createMut.mutateAsync({
        fromSectionId: header.fromSectionId,
        toSectionId:   header.toSectionId,
        items: items.map((it) => ({
          productId: it.productId,
          quantity:  it.quantity,
        })),
        ...(header.notes.trim() !== '' ? { notes: header.notes.trim() } : {}),
        sendDirectly: header.sendDirectly,
      });
      navigate(`/backoffice/inventory/transfers/${result.transfer_id}`);
    } catch (err) {
      if (err instanceof CreateTransferError) {
        switch (err.code) {
          case 'forbidden':
            setFormError('You no longer have permission to create transfers. Please refresh.');
            break;
          case 'from_to_same_section':
            setFormError('From and To sections must differ.');
            break;
          case 'section_not_found':
            setFormError('One of the selected sections is inactive or was deleted. Reload the page.');
            break;
          case 'items_required':
            setFormError('Add at least one product line.');
            break;
          case 'duplicate_product_in_items':
            setFormError('The same product appears more than once.');
            break;
          case 'product_not_found':
            setFormError('A product is inactive or was deleted.');
            break;
          case 'quantity_must_be_positive':
            setFormError('Each line must have a positive quantity.');
            break;
          default:
            setFormError('Something went wrong. Please retry.');
        }
      } else {
        setFormError('Something went wrong. Please retry.');
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/backoffice/inventory/transfers"
          className="inline-flex items-center gap-1 text-text-secondary text-xs hover:text-text-primary"
        >
          <ChevronLeft className="h-3 w-3" aria-hidden /> Back to transfers
        </Link>
        <h1 className="font-serif text-3xl mt-2">New Transfer</h1>
        <p className="text-text-secondary text-sm mt-1">
          Move stock between two sections. Items below zero on the source after this transfer are rejected by the server.
        </p>
      </div>

      <form
        onSubmit={(e) => { void handleSubmit(e); }}
        noValidate
        className="space-y-6 max-w-3xl bg-bg-elevated border border-border-subtle rounded-lg p-6"
      >
        {formError !== null && (
          <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
            {formError}
          </div>
        )}

        <TransferFormFields
          value={header}
          onChange={setHeader}
          sections={sections.data ?? []}
          disabled={createMut.isPending}
        />

        <TransferItemsTable
          items={items}
          onChange={setItems}
          disabled={createMut.isPending}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/backoffice/inventory/transfers')}
            disabled={createMut.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {createMut.isPending ? 'Creating…' : 'Create transfer'}
          </Button>
        </div>
      </form>
    </div>
  );
}
