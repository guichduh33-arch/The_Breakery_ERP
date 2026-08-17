// apps/backoffice/src/pages/__tests__/Products.error.test.tsx
//
// Lot E — l'échec de chargement du catalogue ne fait plus disparaître la page.
//
// Ce qu'on grave ici : `Products.tsx` faisait un RETOUR ANTICIPÉ sur
// `products.error`. Toute la page partait avec — fil d'Ariane, titre, onglets,
// bande de compteurs — remplacée par une phrase et le message brut du serveur,
// sans aucun moyen de réessayer. L'opérateur perdait jusqu'à l'endroit où il se
// trouvait, et sa seule issue était un rechargement qui lui coûtait ses filtres.
//
// Le patron retenu est celui d'`OrdersListPage` : bandeau AU-DESSUS de la table,
// « Try again » câblé sur `refetch`, message serveur relégué en petit.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { refetchSpy, productsRef } = vi.hoisted(() => ({
  refetchSpy: vi.fn(),
  productsRef: {
    current: {
      data: [] as unknown[],
      isLoading: false,
      error: null as Error | null,
    },
  },
}));

vi.mock('@/features/products/hooks/useProducts.js', () => ({
  useProducts: () => ({ ...productsRef.current, refetch: refetchSpy }),
}));
vi.mock('@/features/products/hooks/useCategories.js', () => ({
  useCategories: () => ({ data: [] }),
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (code: string) => boolean }) => unknown) =>
    selector({ hasPermission: () => true }),
}));
vi.mock('@/features/products/components/ProductsPageTabs.js', () => ({
  ProductsPageTabs: () => <div data-testid="products-tabs" />,
}));

async function renderPage() {
  const { default: ProductsPage } = await import('../Products.js');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductsPage — échec de chargement [lot E]', () => {
  beforeEach(() => {
    refetchSpy.mockClear();
    productsRef.current = { data: [], isLoading: false, error: null };
  });

  it('garde son titre, son fil d’Ariane, ses onglets et ses compteurs', async () => {
    productsRef.current = { data: [], isLoading: false, error: new Error('catalog RPC failed') };
    await renderPage();

    expect(screen.getByTestId('products-error')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('Products');
    expect(screen.getByTestId('products-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('products-counter-strip')).toBeInTheDocument();
  });

  it('relègue le message serveur et offre un « Try again » câblé sur refetch', async () => {
    productsRef.current = { data: [], isLoading: false, error: new Error('catalog RPC failed') };
    await renderPage();

    const banner = screen.getByTestId('products-error');
    expect(banner).toHaveTextContent('catalog RPC failed');
    // Le message SERVEUR n'est pas la phrase d'ouverture : il est du
    // diagnostic, rendu en petit après ce que l'échec change pour le lecteur.
    expect(banner.textContent?.indexOf('could not be loaded'))
      .toBeLessThan(banner.textContent?.indexOf('catalog RPC failed') ?? -1);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1));
  });

  it('ne rend PAS la table vide sous l’erreur — son état vide mentirait', async () => {
    // « No products match these filters » à côté d'un bandeau d'erreur ferait
    // croire à un filtre trop étroit là où c'est la requête qui a échoué.
    productsRef.current = { data: [], isLoading: false, error: new Error('boom') };
    await renderPage();
    expect(screen.queryByTestId('products-table')).not.toBeInTheDocument();
    expect(screen.queryByText(/no products match these filters/i)).not.toBeInTheDocument();
  });

  it('sans erreur, la table est là et aucun bandeau ne s’affiche', async () => {
    await renderPage();
    expect(screen.queryByTestId('products-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('products-table')).toBeInTheDocument();
  });
});
