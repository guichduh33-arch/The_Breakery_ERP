import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AdaptiveCartPanel } from '../AdaptiveCartPanel';

const initialWidth = window.innerWidth;
function resize(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  fireEvent(window, new Event('resize'));
}
afterEach(() => resize(initialWidth));

describe('Panier adapté au terminal', () => {
  it('reste visible sur la caisse 1024px et accessible après passage en portrait', () => {
    resize(1024);
    render(<AdaptiveCartPanel count={2} total={80000} desktopMinWidth={900}>
      <p>Croissant × 2</p>
    </AdaptiveCartPanel>);
    expect(screen.getByText('Croissant × 2')).toBeVisible();
    expect(screen.queryByRole('button', { name: /View order/ })).not.toBeInTheDocument();
    resize(360);
    fireEvent.click(screen.getByRole('button', { name: /View order · 2/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Croissant × 2');
    resize(1024);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Croissant × 2')).toBeVisible();
  });

  it('préserve le panier compact de la tablette à 1024px', () => {
    resize(1024);
    render(<AdaptiveCartPanel count={0} total={0}><p>Empty order</p></AdaptiveCartPanel>);
    expect(screen.getByRole('button', { name: /View order · 0/ })).toBeVisible();
  });
});
