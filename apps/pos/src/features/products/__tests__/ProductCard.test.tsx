// apps/pos/src/features/products/__tests__/ProductCard.test.tsx
//
// Session 14 — Phase 2.A smoke for the new ProductCard.

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Product } from '@breakery/domain';

// P2 perf finding — ProductCard is wrapped in React.memo. To prove a bail-out
// actually happened we can't rely on React.Profiler: onRender fires once per
// COMMIT that includes the Profiler boundary regardless of whether a memoized
// child inside it actually re-executed, so it can't distinguish "bailed" from
// "rendered but visually identical". Instead we spy on `cn` (from
// @breakery/ui) — ProductCard calls it unconditionally on every render of its
// own body, so its call count is a reliable proxy for "did the component
// function re-execute".
const { cnSpy } = vi.hoisted(() => ({ cnSpy: vi.fn() }));
vi.mock('@breakery/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@breakery/ui')>();
  return {
    ...actual,
    cn: (...args: Parameters<typeof actual.cn>) => {
      cnSpy();
      return actual.cn(...args);
    },
  };
});

// `vi.mock` calls above are hoisted to the top of the module by Vitest, so
// this static import already resolves against the mocked `@breakery/ui`.
import { ProductCard } from '../ProductCard';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    sku: 'SKU-1',
    name: 'American Bagel',
    category_id: 'cat-bagel',
    retail_price: 70_000,
    wholesale_price: null,
    product_type: 'finished',
    image_url: 'https://example.com/bagel.jpg',
    current_stock: 5,
    is_active: true,
    is_favorite: false,
    ...overrides,
  };
}

describe('ProductCard', () => {
  it('renders name + price + image', () => {
    const { container } = render(
      <ProductCard product={makeProduct()} onSelect={() => { /* noop */ }} />,
    );
    expect(screen.getByText('American Bagel')).toBeInTheDocument();
    expect(screen.getByText(/70[,.]?000/)).toBeInTheDocument();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/bagel.jpg');
  });

  it('invokes onSelect when clicked and enabled', () => {
    const onSelect = vi.fn();
    const p = makeProduct();
    render(<ProductCard product={p} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId(`product-card-${p.id}`));
    expect(onSelect).toHaveBeenCalledWith(p);
  });

  it('does NOT invoke onSelect when disabled', () => {
    const onSelect = vi.fn();
    const p = makeProduct({ current_stock: 0 });
    render(
      <ProductCard
        product={p}
        disabled
        overlayLabel="Sold out"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId(`product-card-${p.id}`));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  it('renders promo badge when promoActive', () => {
    render(
      <ProductCard
        product={makeProduct()}
        promoActive
        onSelect={() => { /* noop */ }}
      />,
    );
    expect(screen.getByTestId('product-card-promo-badge')).toBeInTheDocument();
  });

  it('renders the low-stock ribbon when low-stock label provided', () => {
    render(
      <ProductCard
        product={makeProduct({ current_stock: 2 })}
        lowStockLabel="Low stock · 2 left"
        onSelect={() => { /* noop */ }}
      />,
    );
    expect(screen.getByText('Low stock · 2 left')).toBeInTheDocument();
  });

  it('is memoized: an unrelated parent re-render with referentially unchanged props does not re-render the card', () => {
    const onSelect = vi.fn();
    const product = makeProduct();

    function Harness({ cartQty }: { cartQty: number }) {
      const [, bump] = useState(0);
      return (
        <div>
          <button type="button" onClick={() => bump((n) => n + 1)}>
            bump unrelated state
          </button>
          <ProductCard product={product} onSelect={onSelect} cartQty={cartQty} />
        </div>
      );
    }

    const { rerender } = render(<Harness cartQty={0} />);
    const callsAfterMount = cnSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // Harness re-renders (its own state changes) but every ProductCard prop
    // is referentially/value-identical → React.memo bails, `cn` is not
    // called again.
    fireEvent.click(screen.getByText('bump unrelated state'));
    expect(cnSpy.mock.calls.length).toBe(callsAfterMount);

    // Control: when a prop the card actually reads DOES change, it must
    // re-render — proving the spy would have caught a broken memoization.
    rerender(<Harness cartQty={1} />);
    expect(cnSpy.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});
