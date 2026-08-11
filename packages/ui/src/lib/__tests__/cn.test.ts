// packages/ui/src/lib/__tests__/cn.test.ts
//
// Guards the Tailwind-3 / tailwind-merge-4 mismatch documented in cn.ts:
// a bare `outline` is a *style* here, not a width, and must survive next to
// `outline-2`. Without the override the design system's focus ring reached the
// DOM with a width and a colour but no style, on every primitive.

import { describe, it, expect } from 'vitest';
import { cn } from '../cn.js';

const classes = (value: string) => value.split(/\s+/).filter(Boolean);

describe('cn — outline style vs width', () => {
  it('keeps the bare outline alongside a width', () => {
    expect(classes(cn('outline outline-2'))).toEqual(['outline', 'outline-2']);
  });

  it('keeps the whole canonical focus ring of the design system', () => {
    const ring =
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';
    expect(classes(cn(ring))).toEqual(classes(ring));
  });

  it('keeps the ring when a caller appends its own classes', () => {
    const result = classes(cn('focus-visible:outline focus-visible:outline-2', 'rounded-md'));
    expect(result).toContain('focus-visible:outline');
    expect(result).toContain('focus-visible:outline-2');
  });

  it('still merges two widths, last one winning', () => {
    expect(classes(cn('outline-2 outline-4'))).toEqual(['outline-4']);
  });

  it('still merges two styles, last one winning', () => {
    expect(classes(cn('outline outline-dashed'))).toEqual(['outline-dashed']);
    expect(classes(cn('outline-dashed outline'))).toEqual(['outline']);
  });

  it('leaves unrelated merging untouched', () => {
    expect(classes(cn('px-2 px-4'))).toEqual(['px-4']);
    expect(classes(cn('text-sm', 'text-lg'))).toEqual(['text-lg']);
  });
});
