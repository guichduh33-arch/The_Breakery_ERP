// packages/ui/src/components/__tests__/IdleWarningToast.test.tsx
// Session 21 / Phase 1.C.2 — RTL tests for IdleWarningToast.
//
// Assertions :
//   1. Mount + dispatch `idle:warning` → toast appears with countdown.
//   2. Advance fake timers 2s → countdown decrements from 30 to 28.
//   3. Click "Stay signed in" → `idle:reset` event fired, toast hidden.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { IdleWarningToast } from '../IdleWarningToast.js';

describe('IdleWarningToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing by default (before idle:warning)', () => {
    render(<IdleWarningToast />);
    expect(screen.queryByTestId('idle-warning-toast')).toBeNull();
  });

  it('appears with countdown text after idle:warning event', () => {
    render(<IdleWarningToast />);
    act(() => {
      window.dispatchEvent(new CustomEvent('idle:warning', { detail: { remainingMs: 30_000 } }));
    });
    expect(screen.getByTestId('idle-warning-toast')).toBeInTheDocument();
    expect(screen.getByTestId('idle-countdown').textContent).toContain('30s');
  });

  it('decrements countdown by 2 after 2 seconds', () => {
    render(<IdleWarningToast />);
    act(() => {
      window.dispatchEvent(new CustomEvent('idle:warning', { detail: { remainingMs: 30_000 } }));
    });
    // Advance 2 seconds — two setInterval ticks.
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByTestId('idle-countdown').textContent).toContain('28s');
  });

  it('dispatches idle:reset and hides itself when "Stay signed in" is clicked', () => {
    const resetSpy = vi.fn();
    window.addEventListener('idle:reset', resetSpy);

    render(<IdleWarningToast />);
    act(() => {
      window.dispatchEvent(new CustomEvent('idle:warning', { detail: { remainingMs: 30_000 } }));
    });
    expect(screen.getByTestId('idle-warning-toast')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('idle-stay-button'));

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('idle-warning-toast')).toBeNull();

    window.removeEventListener('idle:reset', resetSpy);
  });

  it('hides toast on idle:fired (main timeout fired, sign-out in progress)', () => {
    render(<IdleWarningToast />);
    act(() => {
      window.dispatchEvent(new CustomEvent('idle:warning', { detail: { remainingMs: 30_000 } }));
    });
    expect(screen.getByTestId('idle-warning-toast')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('idle:fired'));
    });
    expect(screen.queryByTestId('idle-warning-toast')).toBeNull();
  });
});
