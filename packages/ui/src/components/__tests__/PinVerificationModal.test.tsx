import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PinVerificationModal, type VerifyResult } from '../PinVerificationModal.js';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { toast } from 'sonner';

function pressKey(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function enterPin(pin: string): void {
  for (const digit of pin) {
    pressKey(digit);
  }
}

function makeVerifyFn(result: VerifyResult) {
  return vi.fn((_pin: string, _perm?: string): Promise<VerifyResult> => Promise.resolve(result));
}

function makeVerifyFnFail() {
  return vi.fn((_pin: string, _perm?: string): Promise<VerifyResult> => Promise.reject(new Error('network')));
}

describe('PinVerificationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the authorization header when open', () => {
    render(
      <PinVerificationModal
        open
        onClose={vi.fn()}
        onVerified={vi.fn()}
        requiredPermission="sales.discount"
        verifyFn={makeVerifyFn({ ok: true, userId: 'u1' })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Authorize' })).toBeInTheDocument();
    expect(screen.getAllByText(/Enter manager PIN/i).length).toBeGreaterThan(0);
  });

  it('renders nothing when closed', () => {
    render(
      <PinVerificationModal
        open={false}
        onClose={vi.fn()}
        onVerified={vi.fn()}
        verifyFn={makeVerifyFn({ ok: true, userId: 'u1' })}
      />,
    );
    expect(screen.queryByText('Authorize')).not.toBeInTheDocument();
  });

  it('PIN entry shows dots filling up', () => {
    render(
      <PinVerificationModal
        open
        onClose={vi.fn()}
        onVerified={vi.fn()}
        verifyFn={makeVerifyFn({ ok: true, userId: 'u1' })}
      />,
    );
    const dots = screen.getByLabelText('PIN dots');
    expect(dots).toBeInTheDocument();
    pressKey('1');
    pressKey('2');
    pressKey('3');
  });

  it('Verify success → onVerified called with correct userId and modal closes', async () => {
    const onVerified = vi.fn();
    const onClose = vi.fn();
    render(
      <PinVerificationModal
        open
        onClose={onClose}
        onVerified={onVerified}
        requiredPermission="sales.discount"
        verifyFn={makeVerifyFn({ ok: true, userId: 'manager-uuid' })}
      />,
    );
    enterPin('123456');
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
    await waitFor(() => {
      expect(onVerified).toHaveBeenCalledWith('manager-uuid');
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('wrong PIN → toast error, modal stays open (onVerified not called)', async () => {
    const onVerified = vi.fn();
    render(
      <PinVerificationModal
        open
        onClose={vi.fn()}
        onVerified={onVerified}
        verifyFn={makeVerifyFn({ ok: false, error: 'wrong_pin' })}
      />,
    );
    enterPin('111111');
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Wrong PIN');
    });
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('permission_missing → correct toast', async () => {
    render(
      <PinVerificationModal
        open
        onClose={vi.fn()}
        onVerified={vi.fn()}
        verifyFn={makeVerifyFn({ ok: false, error: 'permission_missing' })}
      />,
    );
    enterPin('123456');
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('User lacks permission');
    });
  });

  it('unknown error → generic toast', async () => {
    render(
      <PinVerificationModal
        open
        onClose={vi.fn()}
        onVerified={vi.fn()}
        verifyFn={makeVerifyFn({ ok: false, error: 'unknown' })}
      />,
    );
    enterPin('123456');
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Verification failed');
    });
  });

  it('verifyFn rejection → generic toast', async () => {
    render(
      <PinVerificationModal
        open
        onClose={vi.fn()}
        onVerified={vi.fn()}
        verifyFn={makeVerifyFnFail()}
      />,
    );
    enterPin('123456');
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Verification failed');
    });
  });

  it('Close (X) button → onClose called, onVerified not called', () => {
    const onClose = vi.fn();
    const onVerified = vi.fn();
    render(
      <PinVerificationModal
        open
        onClose={onClose}
        onVerified={onVerified}
        verifyFn={makeVerifyFn({ ok: true, userId: 'u1' })}
      />,
    );
    // The header X button directly calls onClose
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('passes requiredPermission to verifyFn', async () => {
    const verifyFn = vi.fn((_pin: string, _perm?: string): Promise<VerifyResult> =>
      Promise.resolve({ ok: true as const, userId: 'u1' }),
    );
    render(
      <PinVerificationModal
        open
        onClose={vi.fn()}
        onVerified={vi.fn()}
        requiredPermission="sales.discount"
        verifyFn={verifyFn}
      />,
    );
    enterPin('123456');
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
    await waitFor(() => {
      expect(verifyFn).toHaveBeenCalledWith('123456', 'sales.discount');
    });
  });
});
