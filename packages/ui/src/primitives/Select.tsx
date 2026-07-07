// packages/ui/src/primitives/Select.tsx
//
// Design audit 2026-07-07 (DS I-4) — thin STYLED NATIVE <select>, the
// project's assumed fallback (no Radix Select in the kit). Before this,
// ~75 call-sites hand-styled their own <select> with divergent heights,
// backgrounds, and (often missing) focus rings. This primitive mirrors
// `Input` exactly: same surface, border, height, text and gold
// focus-visible outline, so form rows read as one family.
//
// Usage:
//   <Select value={v} onChange={...}>
//     <option value="a">A</option>
//   </Select>
//
// For bespoke layouts, `selectClassName` is exported so a call-site can
// keep its own <select> element but inherit the canonical look.

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export const selectClassName =
  'flex h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select className={cn(selectClassName, className)} ref={ref} {...props}>
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';
