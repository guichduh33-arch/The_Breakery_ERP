import { WASTE_REASON_LABELS, WASTE_REASON_OPTIONS, isWasteReason } from '@/features/inventory-production/wasteReasons.js';
import type { KitchenRow } from './drafts.js';
import { kitchenButton, kitchenControl, FOCUS_RING } from './controls.js';

export function KitchenEntryRow({ row, units, locked, onChange, onRemove }: {
  row: KitchenRow; units: { code: string; factor: number }[]; locked: boolean;
  onChange: (patch: Partial<KitchenRow>) => void; onRemove: () => void;
}) {
  return <fieldset disabled={locked} className="space-y-4 border border-border-subtle rounded-sm p-4">
    <legend className="px-2 text-lg font-semibold">{row.name}</legend>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <label className="block space-y-1"><span>Produced</span>
        <input className={`${kitchenControl} w-full ${FOCUS_RING}`} inputMode="decimal" value={row.quantity}
          onChange={e => onChange({ quantity: e.target.value })} aria-label={`Produced ${row.name}`} />
      </label>
      <label className="block space-y-1"><span>Wasted</span>
        <input className={`${kitchenControl} w-full ${FOCUS_RING}`} inputMode="decimal" value={row.waste}
          onChange={e => onChange({ waste: e.target.value })} aria-label={`Wasted ${row.name}`} />
      </label>
      <label className="block space-y-1"><span>Unit</span>
        <select className={`${kitchenControl} w-full ${FOCUS_RING}`} value={row.unit} onChange={e => onChange({ unit: e.target.value })}
          aria-label={`Unit ${row.name}`}>
          {units.map(u => <option key={u.code} value={u.code}>{u.code}</option>)}
        </select>
      </label>
    </div>
    {Number(row.waste) > 0 && <label className="block space-y-1"><span>Waste reason</span>
      <select className={`${kitchenControl} w-full ${FOCUS_RING}`} value={row.wasteReason} required
        onChange={e => onChange({ wasteReason: isWasteReason(e.target.value) ? e.target.value : '' })}>
        <option value="">Choose a reason</option>
        {WASTE_REASON_OPTIONS.map(reason => <option key={reason} value={reason}>{WASTE_REASON_LABELS[reason]}</option>)}
      </select>
    </label>}
    <label className="block space-y-1"><span>Note (optional)</span>
      <input className={`${kitchenControl} w-full ${FOCUS_RING}`} value={row.note} maxLength={1000} onChange={e => onChange({ note: e.target.value })} />
    </label>
    <button className={kitchenButton} type="button" onClick={onRemove}>Remove {row.name}</button>
  </fieldset>;
}
