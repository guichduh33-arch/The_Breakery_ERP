// apps/backoffice/src/features/sections/components/SectionFormModal.tsx
// Session 13 / Phase 2.D — create / edit modal for a section.

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { useUpsertSection, type SectionRow } from '../hooks/useSectionsList.js';

export interface SectionFormModalProps {
  initial?: SectionRow;
  onClose:  () => void;
}

const KINDS: Array<{ value: 'warehouse' | 'production' | 'sales'; label: string }> = [
  { value: 'warehouse',  label: 'Warehouse' },
  { value: 'production', label: 'Production' },
  { value: 'sales',      label: 'Sales' },
];

export function SectionFormModal({ initial, onClose }: SectionFormModalProps) {
  const [code, setCode] = useState<string>(initial?.code ?? '');
  const [name, setName] = useState<string>(initial?.name ?? '');
  const [kind, setKind] = useState<SectionFormModalProps['initial'] extends never ? never : 'warehouse' | 'production' | 'sales'>(
    (initial?.kind ?? 'warehouse'),
  );
  const [order, setOrder]  = useState<string>(String(initial?.display_order ?? 100));
  const [active, setActive] = useState<boolean>(initial?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-bg-elevated rounded-md border border-border-subtle w-full max-w-md p-5 shadow-lg">
        <h3 className="text-lg font-serif mb-3">{initial !== undefined ? 'Edit section' : 'New section'}</h3>

        <label htmlFor="sec-code" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Code</label>
        <input
          id="sec-code"
          value={code}
          onChange={(e) => { setCode(e.target.value); }}
          disabled={initial !== undefined}
          className="w-full px-2 py-2 mb-3 text-sm bg-bg-base border border-border-subtle rounded font-mono uppercase disabled:opacity-60"
          placeholder="MAIN_WAREHOUSE"
        />

        <label htmlFor="sec-name" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Name</label>
        <input
          id="sec-name"
          value={name}
          onChange={(e) => { setName(e.target.value); }}
          className="w-full px-2 py-2 mb-3 text-sm bg-bg-base border border-border-subtle rounded"
        />

        <label htmlFor="sec-kind" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Kind</label>
        <select
          id="sec-kind"
          value={kind}
          onChange={(e) => { setKind(e.target.value as 'warehouse' | 'production' | 'sales'); }}
          className="w-full px-2 py-2 mb-3 text-sm bg-bg-base border border-border-subtle rounded"
        >
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label htmlFor="sec-order" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Display order</label>
            <input
              id="sec-order"
              type="number"
              min={0}
              value={order}
              onChange={(e) => { setOrder(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
            />
          </div>
          <div className="flex items-end">
            <label className="text-sm inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => { setActive(e.target.checked); }}
              />
              Active
            </label>
          </div>
        </div>

        {error !== null && <div className="text-sm text-rose-600 mb-3">{error}</div>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving…' : (initial !== undefined ? 'Save' : 'Create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
