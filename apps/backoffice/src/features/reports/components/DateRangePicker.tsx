// apps/backoffice/src/features/reports/components/DateRangePicker.tsx
//
// Pair of native date inputs (start + end). Pure controlled component.
// Date strings are 'YYYY-MM-DD' in the business timezone (use
// `toLocalDateStr` from `@breakery/domain` to convert from Date).

import { Input } from '@breakery/ui';

export interface DateRangePickerProps {
  start:        string;
  end:          string;
  onStartChange: (v: string) => void;
  onEndChange:   (v: string) => void;
}

export function DateRangePicker({ start, end, onStartChange, onEndChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="flex items-center gap-1 text-text-secondary">
        <span>From</span>
        <Input
          type="date"
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
          className="h-9 w-36"
          aria-label="Date range start"
        />
      </label>
      <label className="flex items-center gap-1 text-text-secondary">
        <span>To</span>
        <Input
          type="date"
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
          className="h-9 w-36"
          aria-label="Date range end"
        />
      </label>
    </div>
  );
}
