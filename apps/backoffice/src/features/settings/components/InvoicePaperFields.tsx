import { Input, Select } from '@breakery/ui';
import { useState } from 'react';
import { Card } from '@/components/BackofficeUi.js';
import { PAPER_PRESETS, type InvoiceTemplateSettings } from '../invoiceTemplate.js';

type NumberField = 'paper_width_mm' | 'paper_height_mm' | 'margin_left_mm' | 'margin_right_mm'
  | 'margin_top_mm' | 'margin_bottom_mm' | 'offset_x_mm' | 'offset_y_mm';
const FIELDS: { key: NumberField; label: string; min: number; max: number }[] = [
  { key: 'paper_width_mm', label: 'Width (mm)', min: 100, max: 420 },
  { key: 'paper_height_mm', label: 'Height (mm)', min: 100, max: 594 },
  { key: 'margin_left_mm', label: 'Left margin (mm)', min: 0, max: 50 },
  { key: 'margin_right_mm', label: 'Right margin (mm)', min: 0, max: 50 },
  { key: 'margin_top_mm', label: 'Top margin (mm)', min: 0, max: 50 },
  { key: 'margin_bottom_mm', label: 'Bottom margin (mm)', min: 0, max: 50 },
  { key: 'offset_x_mm', label: 'Horizontal offset (mm)', min: -20, max: 20 },
  { key: 'offset_y_mm', label: 'Vertical offset (mm)', min: -20, max: 20 },
];

export function InvoicePaperFields({ value, disabled, onChange }: {
  value: InvoiceTemplateSettings; disabled: boolean; onChange: (patch: Partial<InvoiceTemplateSettings>) => void;
}) {
  const [custom, setCustom] = useState(false);
  const preset = PAPER_PRESETS.find((item) => item.width === value.paper_width_mm && item.height === value.paper_height_mm);
  return <Card padding="md" className="space-y-4">
    <div><p className="mb-1 text-xs uppercase tracking-widest text-gold">Paper and alignment</p>
      <h2 className="font-semibold">Paper size</h2></div>
    <label className="block text-sm">Paper preset
      <Select className="mt-2 w-full" value={custom ? 'custom' : preset?.value ?? 'custom'} disabled={disabled}
        onChange={(event) => {
          setCustom(event.target.value === 'custom');
          const selected = PAPER_PRESETS.find((item) => item.value === event.target.value);
          if (selected) onChange({ paper_width_mm: selected.width, paper_height_mm: selected.height });
        }}>
        {PAPER_PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        <option value="custom">Custom dimensions</option>
      </Select>
    </label>
    <div className="grid grid-cols-2 gap-3">
      {FIELDS.map(({ key, label, min, max }) => <label className="block text-xs text-text-secondary" key={key}>
        {label}<Input type="number" className="mt-1 w-full" min={min} max={max} step="0.01" disabled={disabled}
          value={Number.isFinite(value[key]) ? value[key] : ''}
          onChange={(event) => onChange({ [key]: event.target.value === '' ? Number.NaN : Number(event.target.value) })} />
      </label>)}
    </div>
    <p className="text-xs text-text-muted">Positive offsets move content right or down. Confirm the dimensions on your paper box before printing.</p>
    <p className="text-xs text-text-muted">For 2-ply carbon forms, use one print copy on a compatible impact printer. Select the matching paper size and print at 100% without “Fit to page”.</p>
  </Card>;
}
