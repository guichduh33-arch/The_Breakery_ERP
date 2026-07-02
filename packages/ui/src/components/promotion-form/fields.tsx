// packages/ui/src/components/promotion-form/fields.tsx
//
// Small reusable field primitives for the promotion form (labelled field,
// native multi/single selects, nullable number input). Kept native to keep the
// bundle small and avoid new deps.

import { useCallback, type JSX } from 'react';
import { Input } from '../../primitives/Input.js';
import { cn } from '../../lib/cn.js';
import type { PromotionFormOption } from './types.js';

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string | undefined;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, error, hint, children, className }: FieldProps): JSX.Element {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={htmlFor} className="text-xs uppercase tracking-widest text-text-secondary">
        {label}
      </label>
      {children}
      {hint !== undefined && !error ? (
        <p className="text-xs text-text-secondary">{hint}</p>
      ) : null}
      {error !== undefined ? <p className="text-xs text-red">{error}</p> : null}
    </div>
  );
}

interface MultiSelectProps {
  id: string;
  options: PromotionFormOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function MultiSelect({
  id,
  options,
  value,
  onChange,
  placeholder,
}: MultiSelectProps): JSX.Element {
  // Native multi-select keeps the bundle small and avoids new deps.
  // Cmd/Ctrl-click (or Shift-click) toggles entries.
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = Array.from(e.target.selectedOptions, (o) => o.value);
      onChange(next);
    },
    [onChange],
  );
  return (
    <select
      id={id}
      multiple
      value={value}
      onChange={handleChange}
      className="w-full min-h-[7rem] rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      aria-label={placeholder ?? 'Multi-select'}
    >
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface SingleSelectProps {
  id: string;
  options: PromotionFormOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
}

export function SingleSelect({
  id,
  options,
  value,
  onChange,
  placeholder,
}: SingleSelectProps): JSX.Element {
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <option value="">{placeholder ?? '— Select —'}</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  id: string;
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}): JSX.Element {
  const props: React.InputHTMLAttributes<HTMLInputElement> = {
    id,
    type: 'number',
    value: value ?? '',
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      onChange(raw === '' ? null : Number(raw));
    },
  };
  if (min !== undefined) props.min = min;
  if (max !== undefined) props.max = max;
  if (step !== undefined) props.step = step;
  return <Input {...props} />;
}
