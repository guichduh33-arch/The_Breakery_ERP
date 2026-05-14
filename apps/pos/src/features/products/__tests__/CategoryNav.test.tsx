// apps/pos/src/features/products/__tests__/CategoryNav.test.tsx
//
// Session 14 — Phase 2.A smoke for the new vertical CategoryNav.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryNav } from '../CategoryNav';

const { useCategoriesMock } = vi.hoisted(() => ({
  useCategoriesMock: vi.fn(),
}));

vi.mock('../hooks/useCategories', () => ({
  useCategories: () => useCategoriesMock(),
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('CategoryNav', () => {
  beforeEach(() => {
    useCategoriesMock.mockReset();
    useCategoriesMock.mockReturnValue({
      data: [
        { id: 'c-1', name: 'Beverage', slug: 'beverage', sort_order: 1, is_active: true },
        { id: 'c-2', name: 'Bread',    slug: 'bread',    sort_order: 2, is_active: true },
      ],
    });
  });

  it('renders pinned Favorites + Combos + dynamic categories', () => {
    render(withQuery(<CategoryNav selectedSlug="favorites" onSelect={() => {}} />));
    expect(screen.getByTestId('category-nav-item-favorites')).toBeInTheDocument();
    expect(screen.getByTestId('category-nav-item-combos')).toBeInTheDocument();
    expect(screen.getByTestId('category-nav-item-beverage')).toBeInTheDocument();
    expect(screen.getByTestId('category-nav-item-bread')).toBeInTheDocument();
  });

  it('marks the active category via aria-current', () => {
    render(withQuery(<CategoryNav selectedSlug="bread" onSelect={() => {}} />));
    const active = screen.getByTestId('category-nav-item-bread');
    expect(active.getAttribute('aria-current')).toBe('page');
    const inactive = screen.getByTestId('category-nav-item-beverage');
    expect(inactive.getAttribute('aria-current')).toBeNull();
  });

  it('fires onSelect with the slug when a category is tapped', () => {
    const onSelect = vi.fn();
    render(withQuery(<CategoryNav selectedSlug="favorites" onSelect={onSelect} />));
    fireEvent.click(screen.getByTestId('category-nav-item-beverage'));
    expect(onSelect).toHaveBeenCalledWith('beverage');
  });

  it('renders the cog at the bottom when onOpenSettings is provided', () => {
    const onOpenSettings = vi.fn();
    render(
      withQuery(
        <CategoryNav
          selectedSlug="favorites"
          onSelect={() => {}}
          onOpenSettings={onOpenSettings}
        />,
      ),
    );
    const cog = screen.getByLabelText('POS settings');
    fireEvent.click(cog);
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('hides the cog when onOpenSettings is omitted', () => {
    render(withQuery(<CategoryNav selectedSlug="favorites" onSelect={() => {}} />));
    expect(screen.queryByLabelText('POS settings')).toBeNull();
  });
});
