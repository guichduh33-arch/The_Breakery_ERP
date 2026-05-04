import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumpadPin } from '../NumpadPin.js';

describe('NumpadPin', () => {
  it('renders PIN dots and numpad', () => {
    render(<NumpadPin onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('PIN dots')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
  });

  it('calls onSubmit when Verify clicked with pin >= 4 digits', () => {
    const onSubmit = vi.fn();
    render(<NumpadPin onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(onSubmit).toHaveBeenCalledWith('1234');
  });

  it('shows error message when error prop passed', () => {
    render(<NumpadPin onSubmit={vi.fn()} error="Invalid PIN" />);
    expect(screen.getByText('Invalid PIN')).toBeInTheDocument();
  });
});
