// apps/pos/src/features/tablet/__tests__/TabletCategorySidebar.test.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — the tablet category rail must
// be ≥104px wide with readable text-xs labels (the cashier rail is 80px /
// 10px).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabletCategorySidebar } from '../components/TabletCategorySidebar';

vi.mock('@/features/products/hooks/useCategories', () => ({
  useCategories: () => ({
    data: [
      { id: 'c1', name: 'Beverage', slug: 'beverage' },
      { id: 'c2', name: 'Bread', slug: 'bread' },
    ],
  }),
}));

describe('TabletCategorySidebar (LOT 6)', () => {
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
});
