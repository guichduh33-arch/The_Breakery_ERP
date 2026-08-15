// apps/backoffice/src/pages/reports/__tests__/StockVariancePage.queryStability.test.tsx
//
// Audit Reports 2026-08-01, lot E — test de NON-REGRESSION de R-01.
//
// Le bug : la page calculait ses bornes a chaque render via
//   const since = new Date(Date.now() - days * 86_400_000).toISOString();
//   const until = new Date().toISOString();
// puis les passait dans un objet neuf a useStockVariance, dont la queryKey est
// `[...STOCK_VARIANCE_QK, filters]`. Les bornes portant une precision a la
// MILLISECONDE, la cle changeait a chaque render : chaque resolution de requete
// declenchait un render, qui produisait une nouvelle cle, donc une nouvelle
// requete. La page bouclait en appels RPC tant qu'elle restait ouverte.
//
// Ce test echoue sur le code d'avant le correctif et passe apres : il compte les
// appels a la RPC apres stabilisation. Aucun test du module ne couvrait ce
// comportement — c'est precisement ce qui a laisse passer R-01.
//
// Lot F (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 en gardant sa FENÊTRE GLISSANTE. Ce fichier tient en plus, depuis, que les
// deux bornes restent DISTINCTES : `opened`, `sold` et `adjusted` sont des
// mouvements cumulés sur la période, et une fenêtre réduite à une seule journée
// les ramène tous à zéro — l'écart affiché se dégraderait alors en simple relevé
// de stock, et l'écran cesserait de mesurer quoi que ce soit.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { toLocalDateStr } from '@breakery/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_stock_variance_v2') {
        return Promise.resolve({
          data: [{
            product_id:   'p-1',
            product_name: 'Matcha Powder',
            sku:          'MAT-01',
            opened:       10,
            sold:         -4,
            adjusted:     0,
            current_qty:  6,
            expected:     6,
            variance:     0,
            variance_pct: 0,
          }],
          error: null,
        });
      }
      // Sections (filtre R-05) — lecture directe de table.
      return Promise.resolve({ data: [], error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
  },
}));

import StockVariancePage from '@/pages/reports/StockVariancePage.js';
import { useAuthStore } from '@/stores/authStore.js';

function renderPage(search = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/stock-variance${search}`]}>
        <StockVariancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function varianceCalls(): number {
  return mockRpc.mock.calls.filter(([fn]) => fn === 'get_stock_variance_v2').length;
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockClear();
  sessionStorage.clear();
});

describe('StockVariancePage — stabilite de la queryKey (R-01)', () => {
  it('ne relance pas la RPC en boucle une fois les donnees chargees', async () => {
    renderPage();

    // Les donnees arrivent.
    await screen.findByText('Matcha Powder');
    const afterLoad = varianceCalls();
    expect(afterLoad).toBeGreaterThan(0);

    // On laisse tourner : avec la boucle, chaque resolution reprogrammait une
    // requete et ce compteur continuait de grimper.
    await new Promise((r) => setTimeout(r, 300));
    expect(varianceCalls()).toBe(afterLoad);

    await new Promise((r) => setTimeout(r, 300));
    expect(varianceCalls()).toBe(afterLoad);
  });

  it('emet des bornes ancrees au jour, identiques d un appel a l autre', async () => {
    renderPage();
    await screen.findByText('Matcha Powder');

    const calls = mockRpc.mock.calls.filter(([fn]) => fn === 'get_stock_variance_v2');
    const bounds = calls.map(([, args]) => {
      const a = args as { p_date_start?: string; p_date_end?: string };
      return `${a.p_date_start ?? ''}|${a.p_date_end ?? ''}`;
    });

    // Toutes les bornes emises sont identiques : c'est ce qui rend la cle stable.
    expect(new Set(bounds).size).toBe(1);

    // Et elles tombent sur des frontieres de journee locale, pas sur « maintenant ».
    const [start, end] = bounds[0]!.split('|');
    expect(start).toMatch(/T\d{2}:00:00\.000Z$/);
    expect(end).toMatch(/T\d{2}:59:59\.999Z$/);
  });

  // Lot F — la RPC reçoit la FENÊTRE sélectionnée, bornes DISTINCTES. Une
  // fenêtre écrasée sur une seule journée ramènerait `opened`, `sold` et
  // `adjusted` à zéro : la variance ne serait plus qu'un relevé de stock.
  it('interroge la fenetre selectionnee, bornes distinctes', async () => {
    renderPage('?start=2026-05-01&end=2026-05-14');
    await screen.findByText('Matcha Powder');
    const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_variance_v2');
    const args = call![1] as { p_date_start: string; p_date_end: string };
    // Les bornes sont des TIMESTAMPTZ : on les repasse en date MÉTIER avant de
    // les comparer. Un `slice(0,10)` sur l'UTC rendrait la veille pour la borne
    // basse (minuit à Makassar = 16:00 UTC la veille) et ferait échouer un test
    // pourtant juste.
    expect(toLocalDateStr(new Date(args.p_date_start))).toBe('2026-05-01');
    expect(toLocalDateStr(new Date(args.p_date_end))).toBe('2026-05-14');
    expect(args.p_date_start).not.toBe(args.p_date_end);
  });

  // L'écran lit une FENÊTRE : il participe donc à la période partagée de la
  // session, comme les autres rapports de fenêtre — on ne reperd pas sa période
  // en naviguant d'un rapport à l'autre.
  it('herite de la periode partagee de la session quand l URL est vierge', async () => {
    sessionStorage.setItem(
      'breakery.reports.period.v1',
      JSON.stringify({ start: '2026-07-01', end: '2026-07-31' }),
    );
    renderPage();
    await screen.findByText('Matcha Powder');
    const args = mockRpc.mock.calls
      .find(([fn]) => fn === 'get_stock_variance_v2')![1] as {
        p_date_start: string; p_date_end: string;
      };
    expect(toLocalDateStr(new Date(args.p_date_start))).toBe('2026-07-01');
    expect(toLocalDateStr(new Date(args.p_date_end))).toBe('2026-07-31');
  });
});
