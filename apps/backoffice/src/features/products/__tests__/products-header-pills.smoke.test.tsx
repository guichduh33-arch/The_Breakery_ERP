// apps/backoffice/src/features/products/__tests__/products-header-pills.smoke.test.tsx
//
// Session 45 — Wave D — ProductsHeader pill wiring smoke.
//
// Component-level assertions (ProductsHeader):
//   1. Import pill is present and fires onImport when provided.
//   2. Import pill is DISABLED and says why when catalog.import is missing.
//   3. Recipes pill is present and fires onRecipes when provided.
//   4. No Modifiers button rendered.
//   5. Products pill carries aria-current="page" and is not a button/link.
//
// Page-level assertions (Products.tsx via mocked deps):
//   6. Import pill navigates to /backoffice/products/import-export.
//   7. Recipes pill navigates to /backoffice/inventory/recipes.
//   8. Import pill is DISABLED, not absent, when catalog.import is absent.
//
// ── CHANGEMENT DE RÈGLE (campagne design 2026-08-18, lot E) ─────────────────
//
// Deux assertions de ce fichier gravaient l'ABSENCE d'un bouton non autorisé.
// La règle est inversée pour tout le back-office : une action gatée se
// DÉSACTIVE et dit pourquoi, elle ne disparaît pas. Masquer un contrôle laisse
// l'utilisateur croire que la fonction n'existe pas — il ne sait pas qu'il lui
// manque un droit, donc il ne peut pas le demander ; le désactiver nomme la
// règle. DESIGN.md l'exige déjà de l'archétype Bulk entry (« reste verrouillée…
// et dit pourquoi ») et `ExportMenu` l'applique depuis la campagne Reports. Ces
// deux tests tiennent donc désormais la NOUVELLE règle : bouton présent,
// `disabled`, `title` + `aria-describedby` pointant sur la raison.

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
  canCreate?: boolean;
  canImport?: boolean;
}) {
  return render(
    <MemoryRouter>
      <ProductsHeader count={3} {...props} />
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

  it('Import pill is DISABLED and names the missing permission', () => {
    const onImport = vi.fn();
    renderHeader({ onImport, canImport: false });
    const btn = screen.getByRole('button', { name: /^import$/i });
    // Présent, pas absent : l'utilisateur voit que la fonction existe.
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
    // La raison est portée DEUX fois — `title` pour la souris,
    // `aria-describedby` pour le clavier et les lecteurs d'écran, qui ne
    // reçoivent pas de `title` sur un contrôle non focalisable.
    expect(btn).toHaveAttribute('title', 'Requires the catalog.import permission.');
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent)
      .toBe('Requires the catalog.import permission.');
    fireEvent.click(btn);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('New product is DISABLED and names the missing permission', () => {
    const onNew = vi.fn();
    renderHeader({ onNew, canCreate: false });
    const btn = screen.getByRole('button', { name: /new product/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires the products.create permission.');
    const describedBy = btn.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy!)?.textContent)
      .toBe('Requires the products.create permission.');
    fireEvent.click(btn);
    expect(onNew).not.toHaveBeenCalled();
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

  it('no longer carries its own "Products" page indicator', () => {
    // Écran 2a — la pilule or « Products » du bandeau disparaît : dire deux fois
    // sur quelle page on est (une pilule ICI, un onglet actif juste en dessous)
    // n'informait personne. L'indicateur de page unique est désormais l'onglet
    // actif de ProductsPageTabs, qui le tient de NavLink.
    renderHeader({});
    expect(screen.queryByRole('button', { name: /^products$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^products$/i })).not.toBeInTheDocument();
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('renders the page title as the single h1', () => {
    renderHeader({});
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
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

  it('Import pill is DISABLED — not absent — when catalog.import is missing', async () => {
    permRef.current = new Set(['products.create']); // no catalog.import
    mockNavigate.mockClear();
    await renderPage();
    // La page passe désormais `canImport` au bandeau au lieu d'omettre
    // `onImport` : le bouton reste dans le DOM, verrouillé, et nomme la règle.
    const btn = screen.getByRole('button', { name: /^import$/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires the catalog.import permission.');
    fireEvent.click(btn);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
