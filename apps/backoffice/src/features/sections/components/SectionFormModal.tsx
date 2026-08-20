// apps/backoffice/src/features/sections/components/SectionFormModal.tsx
// Session 13 / Phase 2.D — create / edit modal for a production station.
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.
//
// ADR-027 — le `kind` est VERROUILLÉ à 'production' : les sections ne portent
// plus de stock, on ne crée plus de zone warehouse ni sales. Le champ reste
// envoyé à la RPC (sa signature ne bouge pas), il n'est simplement plus offert
// au choix — y compris à l'édition d'une section warehouse/sales d'époque, dont
// le kind est laissé tel quel.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useUpsertSection, type SectionRow } from '../hooks/useSectionsList.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface SectionFormModalProps {
  initial?: SectionRow;
  onClose:  () => void;
}

export function SectionFormModal({ initial, onClose }: SectionFormModalProps): JSX.Element {
  const [code, setCode]   = useState<string>(initial?.code ?? '');
  const [name, setName]   = useState<string>(initial?.name ?? '');
  const kind = initial?.kind ?? 'production';
  const [order, setOrder] = useState<string>(String(initial?.display_order ?? 100));
  const [active, setActive] = useState<boolean>(initial?.is_active ?? true);
  const [error, setError]   = useState<string | null>(null);

  const upsert = useUpsertSection();

  function handleSubmit() {
    if (code.trim() === '' || name.trim() === '') {
      setError('Code and name required.');
      return;
    }
    const orderNum = Number(order);
    if (!Number.isInteger(orderNum) || orderNum < 0) {
      setError('Display order must be a non-negative integer.');
      return;
    }
    setError(null);
    upsert.mutate(
      {
        ...(initial?.id !== undefined ? { id: initial.id } : {}),
        code: code.trim().toUpperCase(),
        name: name.trim(),
        kind,
        is_active: active,
        display_order: orderNum,
      },
      {
        onSuccess: onClose,
        onError:   (e) => { setError(e.message); },
      },
    );
  }

  const isEdit = initial !== undefined;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit station' : 'New station'}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? 'Update the details of an existing production station.' : 'Create a new production station.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="sec-code" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Code</label>
            <input
              id="sec-code"
              value={code}
              onChange={(e) => { setCode(e.target.value); }}
              disabled={isEdit}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded font-mono uppercase disabled:opacity-60 placeholder:text-text-muted ${FOCUS_RING}`}
              placeholder="PASTRY_KITCHEN"
            />
          </div>

          <div>
            <label htmlFor="sec-name" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Name</label>
            <input
              id="sec-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sec-order" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Display order</label>
              <input
                id="sec-order"
                type="number"
                min={0}
                value={order}
                onChange={(e) => { setOrder(e.target.value); }}
                className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
              />
            </div>
            <div className="flex items-end">
              <label className="text-sm inline-flex items-center gap-2 cursor-pointer">
                <input className={FOCUS_RING}
                  type="checkbox"
                  checked={active}
                  onChange={(e) => { setActive(e.target.checked); }}
                />
                Active
              </label>
            </div>
          </div>

          {error !== null && <div role="alert" className="text-sm text-red">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="ink" onClick={handleSubmit} disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving…' : (isEdit ? 'Save' : 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
