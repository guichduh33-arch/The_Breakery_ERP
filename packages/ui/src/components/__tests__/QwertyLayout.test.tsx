import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QwertyLayout } from '../QwertyLayout.js';

describe('QwertyLayout', () => {
  it('renders letter keys and emits on press', () => {
    const onKey = vi.fn();
    render(<QwertyLayout onKey={onKey} onBackspace={vi.fn()} onSpace={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(onKey).toHaveBeenCalledWith('a');
  });

  it('shift toggles to uppercase output', () => {
    const onKey = vi.fn();
    render(<QwertyLayout onKey={onKey} onBackspace={vi.fn()} onSpace={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /shift/i }));
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(onKey).toHaveBeenCalledWith('A');
  });

  it('backspace / space / done fire their callbacks', () => {
    const onBackspace = vi.fn(); const onSpace = vi.fn(); const onDone = vi.fn();
    render(<QwertyLayout onKey={vi.fn()} onBackspace={onBackspace} onSpace={onSpace} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /backspace/i })); expect(onBackspace).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^space$/i })); expect(onSpace).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /done/i })); expect(onDone).toHaveBeenCalled();
  });
});
