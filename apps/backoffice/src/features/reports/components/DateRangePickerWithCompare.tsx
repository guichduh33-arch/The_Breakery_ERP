// apps/backoffice/src/features/reports/components/DateRangePickerWithCompare.tsx
//
// S29 Wave 5.1 — wrapper combining DateRangePicker + "Compare to previous period" checkbox.

import { DateRangePicker } from './DateRangePicker.js';

export interface DateRangePickerWithCompareProps {
  start: string;
  end:   string;
  onStartChange: (s: string) => void;
  onEndChange:   (s: string) => void;
  compare: boolean;
  onCompareChange: (c: boolean) => void;
  /** Optional id for the checkbox (a11y). */
  compareInputId?: string;
}

export function DateRangePickerWithCompare(p: DateRangePickerWithCompareProps): JSX.Element {
  const id = p.compareInputId ?? 'cmp-prev-period';
  return (
    <div className="flex items-center gap-3">
      <DateRangePicker
        start={p.start}
        end={p.end}
        onStartChange={p.onStartChange}
        onEndChange={p.onEndChange}
      />
      <label htmlFor={id} className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
        <input
          id={id}
          type="checkbox"
          checked={p.compare}
          onChange={(e) => p.onCompareChange(e.target.checked)}
          data-testid="compare-toggle"
          className="h-3.5 w-3.5"
        />
        <span>Compare to previous period</span>
      </label>
    </div>
  );
}
