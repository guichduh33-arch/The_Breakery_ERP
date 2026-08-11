// apps/backoffice/src/features/categories/__tests__/categories-dialog-focus.smoke.test.tsx
//
// Locks the focus-return fix on the Categories page (audit 2026-08-11).
// The three dialogs are mounted conditionally, so closing one tears down the
// Radix focus scope in the same commit and its own focus return never runs —
// Escape left `document.activeElement` on <body>, dropping a keyboard user at
// the top of a 137-stop document (WCAG 2.4.3).
//
// The dialogs themselves are stubbed: what is under test is the page's
// remember-the-trigger logic, not Radix.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CategoriesPage from '@/pages/categories/CategoriesPage.js';

// Hoisted and frozen: the page copies `cats.data` into local state through an
// effect keyed on its identity, so a fresh array per render would loop for
// ever. React Query hands back a stable reference in production; the fixture
// has to do the same.
const { CATEGORIES } = vi.hoisted(() => ({
  CATEGORIES: [
    {
      id: 'cat-1',
      name: 'Bagel',
      slug: 'bagel',
      sort_order: 1,
      is_active: true,
      dispatch_station: 'none',
      kds_station: 'expo',
      show_in_pos: true,
      category_type: 'finished',
    },
  ],
}));

vi.mock('@/features/categories/hooks/useAllCategories.js', () => ({
  useAllCategories: () => ({ data: CATEGORIES, isLoading: false, isError: false }),
}));

vi.mock('@/features/categories/hooks/useCategoryMutations.js', () => ({
  useReorderCategories: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCategory: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

vi.mock('@/features/categories/components/CategoryFormDialog.js', () => ({
  CategoryFormDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="category-form-dialog">
      <button type="button" onClick={onClose}>Close form</button>
    </div>
  ),
}));

vi.mock('@/features/categories/components/DeleteCategoryDialog.js', () => ({
  DeleteCategoryDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="delete-category-dialog">
      <button type="button" onClick={onClose}>Close delete</button>
    </div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <CategoriesPage />
    </MemoryRouter>,
  );
}

describe('CategoriesPage — focus return after a dialog closes', () => {
  it('returns focus to the New category button', () => {
    renderPage();
    const trigger = screen.getByTestId('categories-new-btn');

    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTestId('category-form-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Close form'));

    expect(screen.queryByTestId('category-form-dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId('categories-new-btn'));
  });

  it('returns focus to the row action that opened the delete dialog', () => {
    renderPage();
    const trigger = screen.getByTestId('category-delete-cat-1');

    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTestId('delete-category-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Close delete'));

    expect(screen.queryByTestId('delete-category-dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId('category-delete-cat-1'));
  });
});
