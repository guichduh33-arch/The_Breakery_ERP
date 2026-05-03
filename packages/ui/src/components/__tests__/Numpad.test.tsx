import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Numpad } from '../Numpad.js';

describe('Numpad', () => {
  it('renders 0-9, C, backspace keys', () => {
    render(<Numpad onChange={vi.fn()} value="" />);
    for (let i = 0; i <= 9; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Backspace' })).toBeInTheDocument();
  });

  it('digit click appends to value', () => {
    const onChange = vi.fn();
    render(<Numpad onChange={onChange} value="12" />);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onChange).toHaveBeenCalledWith('123');
  });

  it('backspace removes last char', () => {
    const onChange = vi.fn();
    render(<Numpad onChange={onChange} value="123" />);
    fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));
    expect(onChange).toHaveBeenCalledWith('12');
  });

  it('clear empties value', () => {
    const onChange = vi.fn();
    render(<Numpad onChange={onChange} value="123" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('respects maxLength prop', () => {
    const onChange = vi.fn();
    render(<Numpad onChange={onChange} value="123456" maxLength={6} />);
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
