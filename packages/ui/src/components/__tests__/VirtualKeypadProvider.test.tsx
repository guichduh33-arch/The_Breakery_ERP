import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VirtualKeypadProvider } from '../VirtualKeypadProvider.js';

function Harness() {
  return (
    <VirtualKeypadProvider>
      <input aria-label="name" data-vkp="qwerty" />
      <input aria-label="amount" data-vkp="numeric" />
      <textarea aria-label="reason" data-vkp="qwerty" />
      <input aria-label="native" />
    </VirtualKeypadProvider>
  );
}

describe('VirtualKeypadProvider', () => {
  it('opens the QWERTY overlay when a data-vkp="qwerty" input is focused', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('name'));
    expect(screen.getByRole('button', { name: 'q' })).toBeInTheDocument();
  });

  it('opens the numeric overlay for data-vkp="numeric"', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('amount'));
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'q' })).toBeNull();
  });

  it('opens the QWERTY overlay for a data-vkp="qwerty" textarea', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('reason'));
    expect(screen.getByRole('button', { name: 'q' })).toBeInTheDocument();
  });

  it('does NOT open for inputs without data-vkp', () => {
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText('native'));
    expect(screen.queryByRole('button', { name: 'q' })).toBeNull();
    expect(screen.queryByRole('button', { name: '5' })).toBeNull();
  });

  it('typing a key writes into the focused input', () => {
    render(<Harness />);
    const input = screen.getByLabelText('name') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('button', { name: 'q' }));
    expect(input.value).toBe('q');
  });
});
