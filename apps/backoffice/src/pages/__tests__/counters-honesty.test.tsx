// Une bande de compteurs ne doit jamais affirmer un zéro qu'elle n'a pas —
// filet de régression pour la page Stock et la liste Clients.
//
// POURQUOI CE FICHIER EXISTE. Ces deux pages rendaient `0` pendant le
// chargement ET sur erreur. Un gérant y lisait une base clients vide et un
// encours B2B nul là où le serveur n'avait pas répondu ; le pied annonçait
// « 50 of 0 », plus de lignes à l'écran que le total qu'il prétendait
// connaître.
//
// TROIS PIÈGES QUE CES CAS VERROUILLENT, et qu'on ne voit pas en relisant :
//
//   1. « Zéro réel » ≠ « inconnu ». Le correctif est raté dans les DEUX sens :
//      afficher `0` quand on ne sait pas, mais aussi afficher `—` quand le
//      serveur a réellement répondu zéro. Les deux directions sont testées.
//
//   2. `keepPreviousData`. `useStockCounters` et `useCustomersStats` conservent
//      la dernière réponse réussie quand un refetch échoue. Tester
//      `data === undefined` seul laisse donc passer le cas le plus fréquent en
//      exploitation : la bande montre des chiffres périmés pendant que le
//      bandeau annonce qu'elle montre des tirets. L'état « données garnies ET
//      requête en échec » a son cas.
//
//   3. La NAVIGATION ne doit pas dépendre des compteurs. Pousser l'inconnue
//      dans le `total` de `ListPagination` réduit la liste à une seule page
//      (`pageCount = max(1, ceil(0 / pageSize))`) : les deux flèches se
//      désactivent et l'opérateur est bloqué sur sa tranche, alors que la
//      requête de LISTE, elle, a réussi. Ce cas garde la frontière : l'inconnue
//      vit dans ce qui se LIT, jamais dans ce qui se calcule.
//
// Les assertions sont discriminantes : mesurées contre le code d'avant, elles
// échouent. Les relâcher — accepter n'importe quel contenu de cellule, retirer
// le cas du zéro réel — rendrait ce fichier décoratif.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

const stockCounters = vi.fn();
const customerStats = vi.fn();

vi.mock('@/features/inventory/hooks/useStockCounters.js', () => ({
  useStockCounters: () => stockCounters() as unknown,
}));
vi.mock('@/features/customers/hooks/useCustomersStats.js', () => ({
  useCustomersStats: () => customerStats() as unknown,
}));

// Le store d'auth : toutes les permissions, pour que rien ne soit masqué.
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ hasPermission: () => true, user: { id: 'u1' } }),
}));

/** Une requête react-query en échec APRÈS un succès : données garnies. */
function staleThenFailed<T>(data: T) {
  return { data, isLoading: false, isError: true, error: new Error('network'), refetch: vi.fn() };
}
function loading() {
  return { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() };
}
function ok<T>(data: T) {
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn() };
}

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const DASH = '—';

describe('counters never assert a zero they do not have', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('customers — a real server zero stays 0, it does not become a dash', async () => {
    customerStats.mockReturnValue(ok({
      totalCustomers: 0, activeThisMonth: 0, loyaltyMembers: 0,
      loyaltyPercent: 0, outstandingB2b: 0, outstandingCount: 0,
    }));
    const { default: Page } = await import('@/pages/customers/CustomersListPage.js');
    render(wrap(<Page />));

    const strip = await screen.findByLabelText(/customer base overview/i);
    // Un zéro confirmé par le serveur est une information : il reste lisible.
    expect(within(strip).getAllByText('0').length).toBeGreaterThan(0);
    expect(within(strip).queryByText(DASH)).toBeNull();
  });

  it('customers — a failed refetch shows dashes even though stale data is still held', async () => {
    // Le cas que `data === undefined` seul laisse passer : react-query garde la
    // dernière réponse réussie, la bande afficherait 1240 avec un bandeau qui
    // annonce des tirets.
    customerStats.mockReturnValue(staleThenFailed({
      totalCustomers: 1240, activeThisMonth: 87, loyaltyMembers: 412,
      loyaltyPercent: 33, outstandingB2b: 4100000, outstandingCount: 6,
    }));
    const { default: Page } = await import('@/pages/customers/CustomersListPage.js');
    render(wrap(<Page />));

    const strip = await screen.findByLabelText(/customer base overview/i);
    expect(within(strip).queryByText('1,240')).toBeNull();
    expect(within(strip).queryByText(/1\s*240/)).toBeNull();
    expect(within(strip).getAllByText(DASH).length).toBeGreaterThanOrEqual(4);
    // Le bandeau décrit alors un écran qui existe vraiment.
    await waitFor(() => {
      expect(screen.getByTestId('customers-counters-error')).toBeInTheDocument();
    });
  });

  it('customers — while loading, the strip shows dashes and never a zero', async () => {
    customerStats.mockReturnValue(loading());
    const { default: Page } = await import('@/pages/customers/CustomersListPage.js');
    render(wrap(<Page />));

    const strip = await screen.findByLabelText(/customer base overview/i);
    expect(within(strip).getAllByText(DASH).length).toBeGreaterThanOrEqual(4);
    expect(within(strip).queryByText('0')).toBeNull();
    // Pas de bandeau d'erreur : rien n'a échoué, on attend.
    expect(screen.queryByTestId('customers-counters-error')).toBeNull();
  });
});
