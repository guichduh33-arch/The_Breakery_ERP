import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Discount } from '@breakery/domain';
import { DiscountModal } from '../DiscountModal.js';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

function pressKey(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  base: 35000,
  onRequireAuthorization: vi.fn(),
};

describe('DiscountModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header and type toggle when open', () => {
    render(<DiscountModal {...baseProps} />);
    expect(screen.getByRole('heading', { name: 'Apply discount' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '%' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'IDR' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<DiscountModal {...baseProps} open={false} />);
    expect(screen.queryByText('Apply discount')).not.toBeInTheDocument();
  });

  it('tab toggle switches from % to IDR', () => {
    render(<DiscountModal {...baseProps} />);
    const pctTab = screen.getByRole('tab', { name: '%' });
    const idrTab = screen.getByRole('tab', { name: 'IDR' });
    // Initially % is active
    expect(pctTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(idrTab);
    // After click IDR should be active
    expect(idrTab).toHaveAttribute('aria-selected', 'true');
    expect(pctTab).toHaveAttribute('aria-selected', 'false');
  });

  it('numpad input updates value display', () => {
    render(<DiscountModal {...baseProps} />);
    pressKey('1');
    pressKey('5');
    expect(screen.getByTestId('discount-value-display')).toHaveTextContent('15%');
  });

  it('numpad input in IDR mode shows IDR suffix', () => {
    render(<DiscountModal {...baseProps} />);
    fireEvent.click(screen.getByRole('tab', { name: 'IDR' }));
    pressKey('5');
    pressKey('0');
    pressKey('0');
    pressKey('0');
    const display = screen.getByTestId('discount-value-display');
    // toLocaleString('id-ID') uses . as thousands sep → "5.000 IDR"
    // fallback: just check "5000" appears and "IDR" appears
    expect(display.textContent).toMatch(/5[,.]?000\s*IDR/);
  });

  it('Confirm disabled when reason is less than 5 chars', () => {
    render(<DiscountModal {...baseProps} />);
    pressKey('5');
    fireEvent.change(screen.getByPlaceholderText('Why discount?'), {
      target: { value: 'ab' },
    });
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeDisabled();
  });

  it('Confirm enabled when reason >= 5 chars and value valid', () => {
    render(<DiscountModal {...baseProps} />);
    pressKey('5');
    fireEvent.change(screen.getByPlaceholderText('Why discount?'), {
      target: { value: 'Promotion staff' },
    });
    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('below-threshold confirm STILL requires authorization (server v11 gates ALL discounts)', async () => {
    const onConfirm = vi.fn();
    const onRequireAuthorization = vi.fn().mockResolvedValue('manager-uuid-9');
    render(
      <DiscountModal
        {...baseProps}
        onConfirm={onConfirm}
        onRequireAuthorization={onRequireAuthorization}
        base={35000}
      />,
    );
    // 5% of 35000 = 1750 — below the OLD 10% client threshold; v11 gates ALL discounts
    pressKey('5');
    fireEvent.change(screen.getByPlaceholderText('Why discount?'), {
      target: { value: 'loyal customer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));
    await waitFor(() => {
      expect(onRequireAuthorization).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    const arg = onConfirm.mock.calls[0]?.[0] as Discount;
    expect(arg.type).toBe('percentage');
    expect(arg.value).toBe(5);
    expect(arg.authorized_by).toBe('manager-uuid-9');
  });

  it('above-threshold confirm calls onRequireAuthorization first; userId returned → onConfirm with authorized_by', async () => {
    const onConfirm = vi.fn();
    const onRequireAuthorization = vi.fn().mockResolvedValue('manager-uuid-1');
    render(
      <DiscountModal
        {...baseProps}
        onConfirm={onConfirm}
        onRequireAuthorization={onRequireAuthorization}
        base={35000}
      />,
    );
    // 15% of 35000 = 5250 — above 10% threshold
    pressKey('1');
    pressKey('5');
    fireEvent.change(screen.getByPlaceholderText('Why discount?'), {
      target: { value: 'Manager approved' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onRequireAuthorization).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0]?.[0] as Discount;
    expect(arg.authorized_by).toBe('manager-uuid-1');
  });

  it('above-threshold with null return from onRequireAuthorization → onConfirm NOT fired', async () => {
    const onConfirm = vi.fn();
    const onRequireAuthorization = vi.fn().mockResolvedValue(null);
    const onClose = vi.fn();
    render(
      <DiscountModal
        {...baseProps}
        onConfirm={onConfirm}
        onRequireAuthorization={onRequireAuthorization}
        onClose={onClose}
        base={35000}
      />,
    );
    pressKey('1');
    pressKey('5');
    fireEvent.change(screen.getByPlaceholderText('Why discount?'), {
      target: { value: 'Manager approved' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));
    await waitFor(() => {
      expect(onRequireAuthorization).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows live preview when value and reason are set', async () => {
    render(<DiscountModal {...baseProps} base={35000} />);
    pressKey('5');
    fireEvent.change(screen.getByPlaceholderText('Why discount?'), {
      target: { value: 'Promotion staff' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('discount-preview')).toBeInTheDocument();
    });
  });

  it('calls onClose when footer Cancel is pressed', () => {
    const onClose = vi.fn();
    render(<DiscountModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
