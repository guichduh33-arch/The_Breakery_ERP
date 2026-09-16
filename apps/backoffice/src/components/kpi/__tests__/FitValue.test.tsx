import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { FitValue } from '../FitValue.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('shows the exact amount when it fits and keeps it accessible after narrowing', () => {
  let width = 320;
  let resize: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 250 } as DOMRect);
  const { unmount } = render(<FitValue value="-Rp 123,46 jt" exact="-Rp 123.456.789" />);
  expect(screen.getByTitle('-Rp 123.456.789')).not.toHaveTextContent('-Rp 123,46 jt');
  width = 180;
  act(() => { resize?.(); });
  expect(screen.getByTitle('-Rp 123.456.789')).toHaveTextContent('-Rp 123,46 jt');
  expect(screen.getAllByText('-Rp 123.456.789').some(node => node.classList.contains('sr-only'))).toBe(true);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('keeps zero distinct from an unavailable value', () => {
  const { rerender } = render(<FitValue value="0" />);
  expect(screen.getByText('0')).toBeInTheDocument();
  rerender(<FitValue value="—" aria-hidden />);
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  expect(screen.getByText('—').parentElement).toHaveAttribute('aria-hidden', 'true');
});
