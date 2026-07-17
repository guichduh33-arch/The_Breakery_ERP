// apps/pos/src/features/products/__tests__/ProductCard.test.tsx
//
// Session 14 — Phase 2.A smoke for the new ProductCard.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Product } from '@breakery/domain';
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
      <ProductCard product={makeProduct()} onSelect={() => {}} />,
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
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('product-card-promo-badge')).toBeInTheDocument();
  });

  it('renders the low-stock ribbon when low-stock label provided', () => {
    render(
      <ProductCard
        product={makeProduct({ current_stock: 2 })}
        lowStockLabel="Low stock · 2 left"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('Low stock · 2 left')).toBeInTheDocument();
  });

  it('renders resolved allergen badges when allergens prop is non-empty', () => {
    const p = makeProduct();
    render(
      <ProductCard
        product={p}
        allergens={['gluten', 'milk']}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId(`product-card-allergens-${p.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('allergen-badge-gluten')).toBeInTheDocument();
    expect(screen.getByTestId('allergen-badge-milk')).toBeInTheDocument();
  });

  it('omits the allergen overlay when the allergens array is empty or missing', () => {
    const p = makeProduct();
    const { rerender } = render(
      <ProductCard product={p} allergens={[]} onSelect={() => {}} />,
    );
    expect(screen.queryByTestId(`product-card-allergens-${p.id}`)).toBeNull();
    rerender(<ProductCard product={p} onSelect={() => {}} />);
    expect(screen.queryByTestId(`product-card-allergens-${p.id}`)).toBeNull();
  });
});
