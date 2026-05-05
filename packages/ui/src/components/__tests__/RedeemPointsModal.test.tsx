import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RedeemPointsModal } from '../RedeemPointsModal.js';

function pressKey(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('RedeemPointsModal', () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    customerBalance: 2500,
    itemsTotal: 35000,
  };

  it('shows customer balance in header', () => {
    render(<RedeemPointsModal {...baseProps} />);
    expect(screen.getByText(/2[,.]?500 pts/)).toBeInTheDocument();
  });

  it('numpad input updates displayed points', () => {
    render(<RedeemPointsModal {...baseProps} />);
    pressKey('5');
    pressKey('0');
    pressKey('0');
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('shows live IDR conversion', () => {
    render(<RedeemPointsModal {...baseProps} />);
    pressKey('5');
    pressKey('0');
    pressKey('0');
    expect(screen.getByText(/5[.,]?000 IDR/)).toBeInTheDocument();
  });

  it('shows validation error for non-multiple of 100', () => {
    render(<RedeemPointsModal {...baseProps} />);
    pressKey('9');
    pressKey('9');
    expect(screen.getByText(/multiple of 100/i)).toBeInTheDocument();
  });

  it('shows error when points exceed balance', () => {
    render(<RedeemPointsModal {...baseProps} customerBalance={100} />);
    pressKey('2');
    pressKey('0');
    pressKey('0');
    expect(screen.getByText(/insufficient/i)).toBeInTheDocument();
  });

  it('Confirm button is disabled when input is invalid', () => {
    render(<RedeemPointsModal {...baseProps} />);
    pressKey('9');
    pressKey('9');
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeDisabled();
  });

  it('Confirm button is disabled with no input', () => {
    render(<RedeemPointsModal {...baseProps} />);
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeDisabled();
  });

  it('Confirm button is enabled for valid input and calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(<RedeemPointsModal {...baseProps} onConfirm={onConfirm} />);
    pressKey('5');
    pressKey('0');
    pressKey('0');
    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith(500);
  });

  it('calls onClose when Cancel is pressed', () => {
    const onClose = vi.fn();
    render(<RedeemPointsModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error when redemption exceeds items total', () => {
    render(<RedeemPointsModal {...baseProps} customerBalance={5000} itemsTotal={1000} />);
    pressKey('2');
    pressKey('0');
    pressKey('0');
    expect(screen.getByText(/exceeds order total/i)).toBeInTheDocument();
  });
});
