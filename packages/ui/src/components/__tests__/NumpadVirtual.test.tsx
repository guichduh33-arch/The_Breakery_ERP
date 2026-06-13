import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumpadVirtual } from '../NumpadVirtual.js';

describe('NumpadVirtual', () => {
  it('renders 0-9, Clear, Backspace by default (numeric mode)', () => {
    render(<NumpadVirtual onSubmit={vi.fn()} />);
    for (let i = 0; i <= 9; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Backspace' })).toBeInTheDocument();
  });

  it('cash mode shows decimal key instead of backspace', () => {
    render(<NumpadVirtual mode="cash" onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: '.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Backspace' })).not.toBeInTheDocument();
  });

  it('pin mode shows dots above keypad', () => {
    render(<NumpadVirtual mode="pin" onSubmit={vi.fn()} />);
    const dots = screen.getByLabelText('PIN dots');
    expect(dots.children.length).toBe(6); // default maxLength=6 for pin
  });

  it('appends digit on click', () => {
    const handler = vi.fn();
    render(<NumpadVirtual onSubmit={handler} />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(handler).toHaveBeenCalledWith('123');
  });

  it('Clear empties value', () => {
    const handler = vi.fn();
    render(<NumpadVirtual onSubmit={handler} initialValue="42" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    // Submit button disabled when value empty in numeric.
    expect(screen.getByRole('button', { name: /OK/ })).toBeDisabled();
  });

  it('Backspace removes last char', () => {
    const handler = vi.fn();
    render(<NumpadVirtual onSubmit={handler} initialValue="12" />);
    fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(handler).toHaveBeenCalledWith('1');
  });

  it('decimal key adds . in cash mode and prevents double decimals', () => {
    const handler = vi.fn();
    render(<NumpadVirtual mode="cash" onSubmit={handler} initialValue="" />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '.' }));
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: '.' })); // ignored
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(handler).toHaveBeenCalledWith('1.5');
  });

  it('respects maxLength', () => {
    const handler = vi.fn();
    render(<NumpadVirtual onSubmit={handler} maxLength={3} initialValue="" />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: '4' })); // should not append
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(handler).toHaveBeenCalledWith('123');
  });

  it('pin mode submit disabled until value.length === maxLength', () => {
    render(<NumpadVirtual mode="pin" onSubmit={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Verify' });
    expect(submit).toBeDisabled();
    for (const d of ['1', '2', '3', '4', '5']) {
      fireEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(submit).not.toBeDisabled();
  });

  it('auto-submits on the last digit when autoSubmitAtMaxLength is set (pin mode)', () => {
    const handler = vi.fn();
    render(<NumpadVirtual mode="pin" autoSubmitAtMaxLength onSubmit={handler} />);
    for (const d of ['1', '2', '3', '4', '5']) {
      fireEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(handler).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    // Submitted WITHOUT clicking Verify.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('123456');
  });

  it('does NOT auto-submit when autoSubmitAtMaxLength is not set', () => {
    const handler = vi.fn();
    render(<NumpadVirtual mode="pin" onSubmit={handler} />);
    for (const d of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('renders error message in danger color', () => {
    render(<NumpadVirtual onSubmit={vi.fn()} error="Bad PIN" />);
    const err = screen.getByRole('alert');
    expect(err).toHaveTextContent('Bad PIN');
    expect(err.className).toMatch(/text-danger/);
  });

  it('renders Cancel button when onCancel provided', () => {
    const onCancel = vi.fn();
    render(<NumpadVirtual onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('loading state shows Verifying... in pin mode and disables submit', () => {
    render(<NumpadVirtual mode="pin" onSubmit={vi.fn()} isLoading initialValue="123456" />);
    const btn = screen.getByRole('button', { name: /Verifying/ });
    expect(btn).toBeDisabled();
  });
});
