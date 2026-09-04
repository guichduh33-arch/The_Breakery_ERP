// apps/backoffice/src/features/products/__tests__/product-performance-card.smoke.test.tsx
//
// La carte de ventes de la fiche produit. Ce qu'on garde ici, c'est la leçon du
// distill : cette carte a affiché « 0 / 0% / — » en dur pendant toute la vie du
// module. Les assertions portent donc autant sur ce qu'elle montre que sur ce
// qu'elle refuse de montrer — un chargement, un refus de droit et une panne ne
// doivent JAMAIS se rendre en zéro.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ProductPerformanceCard,
  ProductPerformanceRestricted,
} from '../components/ProductPerformanceCard.js';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: rpcMock },
}));

function envelope(over: Record<string, unknown> = {}) {
  return {
    product_id: 'p1',
    window_days: 30,
    from_date: '2026-07-11',
    to_date: '2026-08-09',
    timezone: 'Asia/Makassar',
    generated_at: '2026-08-09T00:00:00Z',
    total:   { units_sold: 142, revenue: 3_550_000, orders_with_product: 118, orders_total: 1145, conversion_pct: 10.31 },
    counter: { units_sold: 120, revenue: 3_000_000, orders_with_product: 100, orders_total: 1100, conversion_pct: 9.09 },
    b2b:     { units_sold: 22,  revenue: 550_000,   orders_with_product: 18,  orders_total: 45,   conversion_pct: 40 },
    ...over,
  };
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProductPerformanceCard productId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe('ProductPerformanceCard', () => {
  it('renders the three measures from the RPC envelope', async () => {
    rpcMock.mockResolvedValue({ data: envelope(), error: null });
    renderCard();

    const card = await screen.findByTestId('product-performance');
    expect(card).toHaveTextContent('142');
    expect(card).toHaveTextContent('10,31%');
    // Le dénominateur accompagne le taux : 10 % sur 8 commandes et 10 % sur
    // 1 145 ne disent pas la même chose.
    expect(card).toHaveTextContent(/118 of 1\.145 orders/);
  });

  it('shows the counter / B2B split when the product sells in both channels', async () => {
    rpcMock.mockResolvedValue({ data: envelope(), error: null });
    renderCard();

    const card = await screen.findByTestId('product-performance');
    expect(card).toHaveTextContent(/Counter 120 · B2B 22/);
  });

  // Régression vue en vrai dans le navigateur, invisible pour les tests
  // précédents : la note du revenu et la valeur au-dessus d'elle ne passaient
  // pas par le même formateur, si bien qu'un même montant changeait de
  // séparateur d'une ligne à l'autre et se lisait mille fois trop petit.
  // Ce que le test verrouille est l'UNICITÉ du rendu, pas un séparateur
  // particulier : depuis l'audit UX/UI du 2026-08-13 le back-office écrit en
  // `id-ID` (« Rp 3.000.000 »), c'est donc la VIRGULE qui est désormais
  // l'intruse.
  it('renders the revenue split through Currency, like the value above it', async () => {
    rpcMock.mockResolvedValue({ data: envelope(), error: null });
    renderCard();

    const card = await screen.findByTestId('product-performance');
    expect(card).toHaveTextContent(/Counter\s*Rp\s*3\.000\.000\s*·\s*B2B\s*Rp\s*550\.000/);
    // La garde porte désormais sur la carte ENTIÈRE, et non plus sur les seuls
    // montants : depuis la passe quantités de l'audit, le compteur de commandes
    // suit la même locale que les montants (« 1.145 orders », plus « 1,145 »).
    // Aucun groupement de milliers par virgule ne doit donc subsister nulle
    // part — c'était la dernière poche d'`en-US` du composant.
    expect(card.textContent ?? '').not.toMatch(/\d,\d{3}/);
  });

  it('hides the split when there is no B2B sale — a "· B2B 0" teaches nothing', async () => {
    rpcMock.mockResolvedValue({
      data: envelope({
        total:   { units_sold: 120, revenue: 3_000_000, orders_with_product: 100, orders_total: 1100, conversion_pct: 9.09 },
        counter: { units_sold: 120, revenue: 3_000_000, orders_with_product: 100, orders_total: 1100, conversion_pct: 9.09 },
        b2b:     { units_sold: 0,   revenue: 0,         orders_with_product: 0,   orders_total: 0,    conversion_pct: 0 },
      }),
      error: null,
    });
    renderCard();

    const card = await screen.findByTestId('product-performance');
    expect(card).toHaveTextContent('120');
    expect(card).not.toHaveTextContent(/B2B/);
  });

  it('renders a skeleton while loading — never a zero', () => {
    rpcMock.mockReturnValue(new Promise(() => { /* pending forever */ }));
    renderCard();

    expect(screen.getByTestId('product-performance-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('product-performance')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  // Timeout élargi : une erreur serveur ordinaire est retentée deux fois par le
  // hook avant d'atteindre le rendu (contrairement au 42501 et au payload
  // malformé, qui ne se retentent pas).
  it('says the data is unknown rather than zero when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });
    renderCard();

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent(/unavailable/i);
    expect(alert).toHaveTextContent(/Nothing here is a zero/i);
    await waitFor(() => {
      expect(screen.queryByTestId('product-performance')).not.toBeInTheDocument();
    });
  });

  // Régression : le mock générique d'un autre test rendait une enveloppe d'une
  // AUTRE RPC. Sans garde de forme, la carte déréférençait `total.units_sold`,
  // plantait, et emportait la fiche produit entière.
  it('treats a malformed envelope as unknown instead of crashing the page', async () => {
    rpcMock.mockResolvedValue({ data: { product: { name: 'x' } }, error: null });
    renderCard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/unavailable/i);
    // Une seule tentative : une forme fausse ne se répare pas en réessayant.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('renders the restricted variant without calling the RPC at all', () => {
    render(<ProductPerformanceRestricted />);

    expect(screen.getByTestId('product-performance-restricted')).toHaveTextContent(/Restricted/i);
    // Le point de la variante : pas de requête vouée au 42501, et aucun hook
    // react-query — d'où l'absence de QueryClientProvider dans ce render.
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
