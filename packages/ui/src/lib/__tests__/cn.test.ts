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

// Deuxième instance de la même panne : les crans TACTILES du preset sont des
// clés custom que tailwind-merge ne classe dans aucun groupe de taille. Sans
// l'override, `h-9` et `h-touch-min` partaient ENSEMBLE et l'ordre du CSS
// généré tranchait — `.h-touch-min` est émis après `.h-9`, donc une barre de
// filtres « corrigée » en 36 px restait à 44 px, sans erreur nulle part.
describe('cn — crans tactiles du preset', () => {
  it('lets an inline height replace the touch height of a primitive', () => {
    expect(classes(cn('flex h-touch-min w-full px-3', 'h-9'))).not.toContain('h-touch-min');
    expect(classes(cn('flex h-touch-min w-full px-3', 'h-9'))).toContain('h-9');
  });

  it('merges two touch heights, last one winning', () => {
    expect(classes(cn('h-touch-comfy', 'h-touch-large'))).toEqual(['h-touch-large']);
  });

  it('applies to width, min-height and min-width too', () => {
    expect(classes(cn('w-touch-comfy', 'w-40'))).toEqual(['w-40']);
    expect(classes(cn('min-h-touch-min', 'min-h-0'))).toEqual(['min-h-0']);
    expect(classes(cn('min-w-touch-min', 'min-w-0'))).toEqual(['min-w-0']);
  });

  it('does not confuse a touch height with a touch width', () => {
    // Deux AXES distincts : l'un ne doit jamais chasser l'autre.
    expect(classes(cn('h-touch-comfy', 'w-touch-comfy')))
      .toEqual(['h-touch-comfy', 'w-touch-comfy']);
  });
});
