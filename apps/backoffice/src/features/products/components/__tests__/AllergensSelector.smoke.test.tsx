// apps/backoffice/src/features/products/components/__tests__/AllergensSelector.smoke.test.tsx
//
// Session 15 / Phase 5.C — smoke test for the AllergensSelector widget.
//
// Coverage :
//   - Renders 14 toggles (one per EU allergen).
//   - Click toggles selected state via onChange.
//   - Re-toggling the same allergen removes it (no duplicates).
//   - onChange always emits a sorted, de-duplicated array.
//   - Disabled state blocks onChange + flags pills as inert.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AllergenType } from '@breakery/ui';
import { AllergensSelector } from '../AllergensSelector.js';

const EU_ENUM_ORDER: AllergenType[] = [
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
];

describe('AllergensSelector', () => {
  it('renders 14 toggle buttons', () => {
    render(<AllergensSelector value={[]} onChange={() => {}} />);
    for (const a of EU_ENUM_ORDER) {
      expect(screen.getByTestId(`allergens-selector-toggle-${a}`)).toBeInTheDocument();
    }
  });

  it('emits onChange with the toggled value when a pill is clicked', () => {
    const onChange = vi.fn();
    render(<AllergensSelector value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('allergens-selector-toggle-milk'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['milk']);
  });

  it('does not produce duplicates : selecting an already-on allergen removes it', () => {
    const onChange = vi.fn();
    render(<AllergensSelector value={['milk']} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('allergens-selector-toggle-milk'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('emits sorted output in EU enum order when multiple allergens are present', () => {
    const onChange = vi.fn();
    // Start with sulphites + gluten ; user selects eggs -> output must be
    // ordered per EU_ENUM_ORDER : [gluten, eggs, sulphites].
    render(<AllergensSelector value={['sulphites', 'gluten']} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('allergens-selector-toggle-eggs'));
    expect(onChange).toHaveBeenCalledWith(['gluten', 'eggs', 'sulphites']);
  });

  it('blocks toggles when disabled and renders pressed state for current selection', () => {
    const onChange = vi.fn();
    render(<AllergensSelector value={['milk']} onChange={onChange} disabled />);
    const milkBtn = screen.getByTestId('allergens-selector-toggle-milk');
    expect(milkBtn.getAttribute('aria-pressed')).toBe('true');
    expect(milkBtn).toBeDisabled();
    fireEvent.click(milkBtn);
    expect(onChange).not.toHaveBeenCalled();
  });
});
