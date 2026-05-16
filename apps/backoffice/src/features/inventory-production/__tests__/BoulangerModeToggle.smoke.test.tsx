// apps/backoffice/src/features/inventory-production/__tests__/BoulangerModeToggle.smoke.test.tsx
// Session 15 / Phase 5.B — BoulangerModeToggle render + toggle smoke test.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoulangerModeToggle } from '../components/BoulangerModeToggle.js';

describe('BoulangerModeToggle smoke', () => {
  it('renders OFF state by default with the OFF warning', () => {
    render(<BoulangerModeToggle value={false} onChange={() => {}} />);
    expect(screen.getByTestId('baker-mode-state')).toHaveTextContent('OFF');
    expect(screen.getByTestId('baker-mode-switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('baker-mode-warning').textContent ?? '').toMatch(
      /percentages of flour|re-entered as percentages/i,
    );
  });

  it('renders ON state with the ON warning', () => {
    render(<BoulangerModeToggle value={true} onChange={() => {}} />);
    expect(screen.getByTestId('baker-mode-state')).toHaveTextContent('ON');
    expect(screen.getByTestId('baker-mode-switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('baker-mode-warning').textContent ?? '').toMatch(
      /absolute mode|preserves the absolute/i,
    );
  });

  it('fires onChange(true) when toggled from OFF', () => {
    const onChange = vi.fn();
    render(<BoulangerModeToggle value={false} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('baker-mode-switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('fires onChange(false) when toggled from ON', () => {
    const onChange = vi.fn();
    render(<BoulangerModeToggle value={true} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('baker-mode-switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn();
    render(<BoulangerModeToggle value={false} onChange={onChange} disabled />);
    const sw = screen.getByTestId('baker-mode-switch') as HTMLButtonElement;
    expect(sw).toBeDisabled();
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});
