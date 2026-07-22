// apps/backoffice/src/features/products/__tests__/products-header-pills.smoke.test.tsx
//
// Session 45 — Wave D — ProductsHeader pill wiring smoke.
//
// Component-level assertions (ProductsHeader):
//   1. Import pill is present and fires onImport when provided.
//   2. Import pill is NOT rendered when onImport is undefined.
//   3. Recipes pill is present and fires onRecipes when provided.
//   4. No Modifiers button rendered.
//   5. Products pill carries aria-current="page" and is not a button/link.
//
// Page-level assertions (Products.tsx via mocked deps):
//   6. Import pill navigates to /backoffice/products/import-export.
//   7. Recipes pill navigates to /backoffice/inventory/recipes.
//   8. Import pill is NOT rendered when catalog.import permission is absent.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import { ProductsHeader } from '../components/ProductsHeader.js';

// ---------------------------------------------------------------------------
// Component-level tests
// ---------------------------------------------------------------------------

function renderHeader(props: {
  onImport?: (() => void) | undefined;
  onRecipes?: (() => void) | undefined;
  onNew?: (() => void) | undefined;
}) {
  return render(
    <MemoryRouter>
      <ProductsHeader {...props} />
    </MemoryRouter>,
  );
}

describe('ProductsHeader pills [S45 W-D]', () => {
  it('Import pill is present and calls onImport when clicked', () => {
    const onImport = vi.fn();
    renderHeader({ onImport });
    const btn = screen.getByRole('button', { name: /import/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('Import pill is NOT rendered when onImport is not provided', () => {
    renderHeader({});
    // The component conditionally renders {onImport && <PillButton ...>} —
    // no onImport means no Import button in the DOM at all.
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument();
  });

  it('Recipes pill is present and calls onRecipes when clicked', () => {
    const onRecipes = vi.fn();
    renderHeader({ onRecipes });
    const btn = screen.getByRole('button', { name: /recipes/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRecipes).toHaveBeenCalledTimes(1);
  });

  it('No Modifiers button is rendered', () => {
    renderHeader({});
    expect(screen.queryByRole('button', { name: /modifiers/i })).not.toBeInTheDocument();
  });

  it('Products element carries aria-current="page" and is not a button or link', () => {
    renderHeader({});
    // Must NOT be an actionable button
    expect(screen.queryByRole('button', { name: /^products$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^products$/i })).not.toBeInTheDocument();
    // Must exist as a static element with aria-current=page
    const indicator = screen.getByText('Products', { selector: '[aria-current="page"]' });
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute('aria-current', 'page');
  });
});

// ---------------------------------------------------------------------------
// Page-level navigation tests (Products.tsx)
// ---------------------------------------------------------------------------

const { mockNavigate } = vi.hoisted(() => {
  const mockNavigate = vi.fn();
  return { mockNavigate };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// authStore mock — controlled per-test via a ref
const { permRef } = vi.hoisted(() => {
  const permRef = { current: new Set<string>(['products.create', 'catalog.import']) };
  return { permRef };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (code: string) => boolean }) => unknown) =>
    selector({ hasPermission: (code: string) => permRef.current.has(code) }),
}));

// Heavy mocks so Products.tsx renders without real data
vi.mock('@/features/products/hooks/useProducts.js', () => ({
  useProducts: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock('@/features/products/hooks/useCategories.js', () => ({
  useCategories: () => ({ data: [] }),
}));
vi.mock('@/features/products/components/ProductsPageTabs.js', () => ({
  ProductsPageTabs: () => null,
}));
vi.mock('@/features/products/components/ProductsKpiGrid.js', () => ({
  ProductsKpiGrid: () => null,
}));
vi.mock('@/features/products/components/ProductsFilters.js', () => ({
  ProductsFilters: () => null,
}));
vi.mock('@/features/products/components/ProductsTable.js', () => ({
  ProductsTable: () => null,
}));
vi.mock('@/features/products/components/ProductsGrid.js', () => ({
  ProductsGrid: () => null,
}));
vi.mock('@/features/products/components/NewProductDialog.js', () => ({
  NewProductDialog: () => null,
}));
vi.mock('@/features/products/components/DeleteProductDialog.js', () => ({
  DeleteProductDialog: () => null,
}));

async function renderPage() {
  const { default: ProductsPage } = await import('../../../pages/Products.js');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductsPage — header pill navigation [S45 W-D]', () => {
  it('Import pill navigates to /backoffice/products/import-export', async () => {
    permRef.current = new Set(['products.create', 'catalog.import']);
    mockNavigate.mockClear();
    await renderPage();
    const btn = screen.getByRole('button', { name: /import/i });
    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith('/backoffice/products/import-export');
  });

  it('Recipes pill navigates to /backoffice/inventory/recipes', async () => {
    permRef.current = new Set(['products.create', 'catalog.import']);
    mockNavigate.mockClear();
    await renderPage();
    const btn = screen.getByRole('button', { name: /recipes/i });
    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith('/backoffice/inventory/recipes');
  });

  it('Import pill is NOT rendered when catalog.import permission is absent', async () => {
    permRef.current = new Set(['products.create']); // no catalog.import
    mockNavigate.mockClear();
    await renderPage();
    // Products.tsx passes onImport only when canImport — so the pill is fully absent.
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument();
  });
});
