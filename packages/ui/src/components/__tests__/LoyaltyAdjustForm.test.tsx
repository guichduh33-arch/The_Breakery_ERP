import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoyaltyAdjustForm } from '../LoyaltyAdjustForm.js';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {};

describe('LoyaltyAdjustForm', () => {
  it('blocks submit when reason is shorter than 5 chars', () => {
    const onSubmit = vi.fn();
    render(<LoyaltyAdjustForm currentBalance={500} onSubmit={onSubmit} onCancel={noop} />);
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'no' } });
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
  });

  it('blocks submit when negative delta would exceed balance', () => {
    const onSubmit = vi.fn();
    render(<LoyaltyAdjustForm currentBalance={100} onSubmit={onSubmit} onCancel={noop} />);
    fireEvent.click(screen.getByRole('radio', { name: /-/i })); // toggle to subtract
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'too much' } });
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
    expect(screen.getByText(/only has 100/i)).toBeInTheDocument();
  });

  it('submits signed positive delta when valid', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoyaltyAdjustForm currentBalance={500} onSubmit={onSubmit} onCancel={noop} />);
    fireEvent.click(screen.getByRole('radio', { name: /\+/i })); // add (default)
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'goodwill bonus' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onSubmit).toHaveBeenCalledWith({ delta: 120, reason: 'goodwill bonus' });
  });

  it('submits negative delta when subtract toggle selected', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoyaltyAdjustForm currentBalance={500} onSubmit={onSubmit} onCancel={noop} />);
    fireEvent.click(screen.getByRole('radio', { name: /-/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'returned item' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onSubmit).toHaveBeenCalledWith({ delta: -50, reason: 'returned item' });
  });
});
