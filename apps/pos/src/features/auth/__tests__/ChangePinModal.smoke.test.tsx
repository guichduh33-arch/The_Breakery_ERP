// apps/pos/src/features/auth/__tests__/ChangePinModal.smoke.test.tsx
//
// Session 19 / Phase 3.C — smoke for the self-change PIN modal.
//
// Mocks @breakery/ui's NumpadPin with a fire-button so the 3-step state
// machine can be driven synthetically without touching the real numpad
// internals. The shared util `evaluatePinStrength` is exercised live —
// '123456' is detected as a 'sequence' weak PIN, which lets us assert the
// hint surfaces at the right step.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { ChangePinModal } from '../ChangePinModal';

// --- Mocks -----------------------------------------------------------------

// vi.hoisted lets us share mock identity between the (top-hoisted) vi.mock
// factories and the test body without tripping the "Cannot access X before
// initialization" hoisting error.
const { invokeMock, toastMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

// Mock the NumpadPin primitive — render a button that fires the configured
// pin on click. Each test that calls fireEvent.click on it drives one step
// of the modal's state machine. The `key` prop makes it remount between
// steps, exactly as the production component does.
vi.mock('@breakery/ui', async () => {
  const actual = await vi.importActual<typeof import('@breakery/ui')>('@breakery/ui');
  return {
    ...actual,
    NumpadPin: ({
      onSubmit,
      isLoading,
    }: {
      onSubmit: (pin: string) => void;
      isLoading?: boolean;
    }) => (
      <button
        type="button"
        data-testid="fire-pin"
        disabled={isLoading}
        // The pin to fire is controlled via a global pinned by each test.
        onClick={() => onSubmit((globalThis as { __NEXT_PIN__?: string }).__NEXT_PIN__ ?? '123456')}
      >
        fire-pin
      </button>
    ),
  };
});

// --- Helpers ---------------------------------------------------------------

function setNextPin(pin: string): void {
  (globalThis as { __NEXT_PIN__?: string }).__NEXT_PIN__ = pin;
}

function wrap(node: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

// --- Tests -----------------------------------------------------------------

describe('ChangePinModal', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    setNextPin('123456');
  });

  it('renders step 1 with the "Enter current PIN" title', () => {
    render(wrap(<ChangePinModal open={true} onClose={vi.fn()} userId="u1" />));
    expect(screen.getByText(/enter current pin/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
  });

  it('cancel button closes the modal', () => {
    const onClose = vi.fn();
    render(wrap(<ChangePinModal open={true} onClose={onClose} userId="u1" />));
    fireEvent.click(screen.getByTestId('change-pin-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  // S21 / 1.C.4-b : hint surface moved to step 2 (entry) from step 3 (confirm).
  it('advances current → new → confirm, hint NOT at step 3 (moved to step 2)', () => {
    render(wrap(<ChangePinModal open={true} onClose={vi.fn()} userId="u1" />));

    // Step 1 : fire the current PIN.
    setNextPin('999111');
    fireEvent.click(screen.getByTestId('fire-pin'));
    expect(screen.getByText(/enter new pin/i)).toBeInTheDocument();
    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();

    // Step 2 : fire a weak new PIN ('123456' is a 'sequence').
    setNextPin('123456');
    fireEvent.click(screen.getByTestId('fire-pin'));

    // S21: We are now at step 3 (confirm). Hint is NOT shown here.
    expect(screen.getByText(/confirm new pin/i)).toBeInTheDocument();
    expect(screen.getByText(/step 3 of 3/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pin-weak-hint')).toBeNull();
  });

  // S21 / 1.C.4-b : hint shows at step 2 when returning after mismatch.
  it('shows weak hint at step 2 when returning after mismatch with a weak pin', () => {
    render(wrap(<ChangePinModal open={true} onClose={vi.fn()} userId="u1" />));

    setNextPin('999111');
    fireEvent.click(screen.getByTestId('fire-pin')); // step 1 → 2

    // Enter a weak new PIN.
    setNextPin('123456');
    fireEvent.click(screen.getByTestId('fire-pin')); // step 2 → 3 (newPin='123456')

    // Mismatch at confirm → S21 resets to step 2 (not step 1).
    setNextPin('111111');
    fireEvent.click(screen.getByTestId('fire-pin')); // step 3 : mismatch → step 2

    expect(screen.getByText(/enter new pin/i)).toBeInTheDocument();
    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();
    // At step 2 with newPin='123456' still set — hint should now be visible.
    expect(screen.getByTestId('pin-weak-hint')).toBeInTheDocument();
    expect(screen.getByTestId('pin-weak-hint').textContent).toMatch(/sequence/);
  });

  // S21 / 1.C.4-c : mismatch resets to step 2 (not step 1).
  it('mismatching confirm toasts error and resets to step 2 (not step 1)', () => {
    render(wrap(<ChangePinModal open={true} onClose={vi.fn()} userId="u1" />));

    setNextPin('999111');
    fireEvent.click(screen.getByTestId('fire-pin')); // step 1 → 2
    setNextPin('246810');
    fireEvent.click(screen.getByTestId('fire-pin')); // step 2 → 3
    setNextPin('111111');
    fireEvent.click(screen.getByTestId('fire-pin')); // step 3 : mismatch

    expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/do not match/i));
    // S21: resets to step 2 (enter new PIN), not step 1 (enter current PIN).
    expect(screen.getByText(/enter new pin/i)).toBeInTheDocument();
    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();
  });

  it('submits on matching confirm and shows weak warning in success toast', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { ok: true, weak: true, weak_reason: 'sequence' },
      error: null,
    });
    const onClose = vi.fn();
    render(wrap(<ChangePinModal open={true} onClose={onClose} userId="u1" />));

    setNextPin('999111');
    fireEvent.click(screen.getByTestId('fire-pin')); // 1 → 2
    setNextPin('123456');
    fireEvent.click(screen.getByTestId('fire-pin')); // 2 → 3
    fireEvent.click(screen.getByTestId('fire-pin')); // 3 : match (same pin)

    // Flush microtasks for the react-query mutation.
    // S25 hard cutover (session 59) — PINs travel via x-current-pin/x-new-pin
    // headers, never the JSON body.
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('auth-change-pin', {
        body: { user_id: 'u1' },
        headers: { 'x-current-pin': '999111', 'x-new-pin': '123456' },
      });
    });

    await vi.waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/pin updated\..*weak.*sequence/i),
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('toasts "Current PIN is wrong" and resets to step 1 on invalid_current_pin EF error', async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid_current_pin' },
    });
    const onClose = vi.fn();
    render(wrap(<ChangePinModal open={true} onClose={onClose} userId="u1" />));

    setNextPin('000000');
    fireEvent.click(screen.getByTestId('fire-pin')); // 1 → 2
    setNextPin('246810');
    fireEvent.click(screen.getByTestId('fire-pin')); // 2 → 3
    fireEvent.click(screen.getByTestId('fire-pin')); // 3 : match → submit

    await vi.waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        expect.stringMatching(/current pin is wrong/i),
      );
    });
    expect(screen.getByText(/enter current pin/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
