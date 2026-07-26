// ADR-013 Lot 4 — validation client du modal d'accord d'avoir (sans réseau).
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GrantStoreCreditModal } from '../components/GrantStoreCreditModal.js';

const mutateAsync = vi.fn();

vi.mock('../hooks/useGrantStoreCredit.js', () => ({
  GrantStoreCreditError: class extends Error {
    constructor(public code: string, message?: string) { super(message ?? code); }
  },
  useGrantStoreCredit: () => ({ mutateAsync, isPending: false }),
}));

function renderModal() {
  return render(
    <GrantStoreCreditModal
      open
      onClose={vi.fn()}
      customerId="c-1"
      customerName="Café Bali"
    />,
  );
}

function fill(amount: string, reason: string, pin: string) {
  fireEvent.change(screen.getByTestId('grant-amount'), { target: { value: amount } });
  fireEvent.change(screen.getByTestId('grant-reason'), { target: { value: reason } });
  fireEvent.change(screen.getByTestId('grant-pin'), { target: { value: pin } });
}

describe('GrantStoreCreditModal', () => {
  it('disables submit when the reason is under 3 characters', () => {
    renderModal();
    fill('50000', 'ok', '123456');
    expect(screen.getByTestId('grant-submit')).toBeDisabled();
  });

  it('disables submit when the amount is not positive', () => {
    renderModal();
    fill('0', 'Geste commercial', '123456');
    expect(screen.getByTestId('grant-submit')).toBeDisabled();
  });

  it('disables submit until the PIN has 6 digits', () => {
    renderModal();
    fill('50000', 'Geste commercial', '123');
    expect(screen.getByTestId('grant-submit')).toBeDisabled();
  });

  it('enables submit when amount, reason and PIN validate', () => {
    renderModal();
    fill('50000', 'Geste commercial', '123456');
    expect(screen.getByTestId('grant-submit')).not.toBeDisabled();
  });
});
