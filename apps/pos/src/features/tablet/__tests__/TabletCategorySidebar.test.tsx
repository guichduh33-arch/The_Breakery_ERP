// apps/pos/src/features/tablet/__tests__/TabletCategorySidebar.test.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — the tablet category rail must
// be ≥104px wide with readable text-xs labels (the cashier rail is 80px /
// 10px).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabletCategorySidebar } from '../components/TabletCategorySidebar';
const query = vi.hoisted(() => ({ isLoading: false, isError: false, refetch: vi.fn() }));

vi.mock('@/features/products/hooks/useCategories', () => ({
  useCategories: () => ({
    ...query,
    data: [
      { id: 'c1', name: 'Beverage', slug: 'beverage' },
      { id: 'c2', name: 'Bread', slug: 'bread' },
    ],
  }),
}));

describe('TabletCategorySidebar (LOT 6)', () => {
  beforeEach(() => { query.isLoading = false; query.isError = false; query.refetch.mockClear(); });
  it('annonce le chargement et garde All accessible', () => {
    query.isLoading = true;
    render(<TabletCategorySidebar selectedSlug="bread" onSelect={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading categories');
    expect(screen.getByRole('button', { name: 'All' })).toBeEnabled();
  });
  it('garde la sélection et propose Retry après un échec de refetch', () => {
    query.isError = true;
    render(<TabletCategorySidebar selectedSlug="bread" onSelect={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Categories unavailable');
    expect(screen.getByRole('button', { name: 'Bread' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(query.refetch).toHaveBeenCalledOnce();
  });
  it('is ≥104px wide and labels are text-xs', () => {
    const { container } = render(
      <TabletCategorySidebar selectedSlug="beverage" onSelect={vi.fn()} />,
    );
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('w-[104px]');

    const beverageBtn = screen.getByRole('button', { name: /beverage/i });
    expect(beverageBtn.className).toContain('text-xs');
    // Cashier rail used the cramped text-[10px].
    expect(beverageBtn.className).not.toContain('text-[10px]');
  });

  it('calls onSelect with the tapped category slug', () => {
    const onSelect = vi.fn();
    render(<TabletCategorySidebar selectedSlug={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /bread/i }));
    expect(onSelect).toHaveBeenCalledWith('bread');
  });

  // Critique 2026-08-24 (P2) — l'état « tout le catalogue » (slug null) était
  // inatteignable une fois une catégorie touchée. La tuile « All » vit en tête
  // du rail, avant Favorites, et rappelle onSelect(null).
  it('renders an "All" tile ahead of Favorites, marked current when selectedSlug is null', () => {
    render(<TabletCategorySidebar selectedSlug={null} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent(/all/i);
    expect(buttons[1]).toHaveTextContent(/favorites/i);
    expect(screen.getByRole('button', { name: /all/i })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onSelect(null) when the "All" tile is tapped', () => {
    const onSelect = vi.fn();
    render(<TabletCategorySidebar selectedSlug="beverage" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /all/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
