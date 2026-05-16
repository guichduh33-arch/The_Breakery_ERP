// packages/ui/src/components/__tests__/AllergenBadge.test.tsx
//
// Session 15 / Phase 5.C — smoke test for the AllergenBadge component.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  AllergenBadge,
  ALLERGEN_TYPES,
  ALLERGEN_LABELS,
  type AllergenType,
} from '../AllergenBadge.js';

describe('AllergenBadge', () => {
  it('renders every one of the 14 EU allergens with a 2-letter abbreviation', () => {
    for (const a of ALLERGEN_TYPES) {
      const { unmount } = render(<AllergenBadge allergen={a} />);
      const node = screen.getByTestId(`allergen-badge-${a}`);
      expect(node).toBeInTheDocument();
      // 2-letter abbreviation visible.
      expect(node.textContent?.trim().length).toBe(2);
      // Full label exposed for screen readers / tooltips.
      expect(node.getAttribute('aria-label')).toBe(ALLERGEN_LABELS[a]);
      expect(node.getAttribute('title')).toBe(ALLERGEN_LABELS[a]);
      unmount();
    }
  });

  it('honours the data-allergen attribute for downstream selectors', () => {
    render(<AllergenBadge allergen="milk" />);
    const node = screen.getByTestId('allergen-badge-milk');
    expect(node.getAttribute('data-allergen')).toBe('milk');
  });

  it('switches to outline style when filled=false', () => {
    render(<AllergenBadge allergen="gluten" filled={false} />);
    const node = screen.getByTestId('allergen-badge-gluten');
    expect(node.className).toContain('bg-transparent');
  });

  it('renders sm and md sizes with different classes', () => {
    const { rerender } = render(<AllergenBadge allergen="eggs" size="sm" />);
    const sm = screen.getByTestId('allergen-badge-eggs').className;
    rerender(<AllergenBadge allergen="eggs" size="md" />);
    const md = screen.getByTestId('allergen-badge-eggs').className;
    expect(sm).not.toBe(md);
  });

  it('exposes a stable ALLERGEN_TYPES list of length 14', () => {
    expect(ALLERGEN_TYPES.length).toBe(14);
    const unique = new Set<AllergenType>(ALLERGEN_TYPES);
    expect(unique.size).toBe(14);
  });
});
