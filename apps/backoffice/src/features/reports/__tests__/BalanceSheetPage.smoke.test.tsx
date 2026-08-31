// apps/backoffice/src/features/reports/__tests__/BalanceSheetPage.smoke.test.tsx
//
// Lot E (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2, en variante de période `as-of` : un bilan est une PHOTO, pas une fenêtre.
// Ce fichier tient :
//
//  · l'ancien lien `?asOf=` reste honoré (repli legacy) ;
//  · la RPC reçoit une date, pas une plage ;
//  · l'indicateur d'équilibre survit à la migration — c'est lui qui crie quand
//    A ≠ L + E + CYE ;
//  · les trois sections restent séparées et intactes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toLocalDateStr } from '@breakery/domain';

const mockRpc = vi.fn();
let balanced = true;

function bsPayload(asOf: string) {
  return {
    assets: {
      current: { cash: 100, ar: 0, inventory: -40, other: 0, total: 60 },
      fixed:   { total: 0 },
      total:   60,
    },
    liabilities: {
      current:   { ap: 0, tax_payable: 0, loyalty: 0, other: 0, total: 0 },
      long_term: { total: 0 },
      total:     0,
    },
    equity: {
      share_capital:         0,
      retained_earnings:     0,
      current_year_earnings: 60,
      other:                 0,
      total:                 60,
    },
    balanced,
    delta:    balanced ? 0 : 12,
    as_of:    asOf,
    lines: [
      {
        account_id: 'acc-1110', code: '1110', name: 'Cash on hand',
        debit: 100, credit: 0, balance: 100, account_class: 1,
      },
    ],
  };
}

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_balance_sheet_v2') {
        return Promise.resolve({ data: bsPayload(String(args.p_as_of_date)), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import BalanceSheetPage from '@/pages/reports/BalanceSheetPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2026-05-14&end=2026-05-14') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/balance-sheet${search}`]}>
        <BalanceSheetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function asOfQueried(): string[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_balance_sheet_v2')
    .map(([, args]) => String((args as { p_as_of_date: string }).p_as_of_date));
}

// La page interroge DEUX dates : `asOf` et la même un mois plus tôt (la
// comparaison). Sur une horloge réelle, ce second appel finit tôt ou tard par
// tomber pile sur une date que le test interdit par ailleurs — le 2026-08-31,
// `oneMonthEarlier(aujourd'hui)` valait `2026-07-31`, la fin de période que le
// cas « jamais la session » utilise comme leurre, et le test a crié à la fuite
// alors que la page était juste. On fige donc l'horloge : la date du jour est
// une ENTRÉE de ces cas, pas un aléa d'exécution.
const FROZEN_NOW = new Date('2026-05-14T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FROZEN_NOW);
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  balanced = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BalanceSheetPage (smoke)', () => {
  it('renders heading and queries get_balance_sheet_v2 with a YYYY-MM-DD as-of', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Balance Sheet', level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(asOfQueried()).toContain('2026-05-14');
    });
    for (const d of asOfQueried()) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Une photo d'état s'ouvre sur AUJOURD'HUI. Elle héritait de la période
  // partagée de la session — montrer hier pour aujourd'hui sur un état de
  // comptes n'est pas une commodité, c'est un chiffre faux.
  it('sans param d URL : ouvre sur la date du jour, jamais sur la session', async () => {
    sessionStorage.setItem(
      'breakery.reports.period.v1',
      JSON.stringify({ start: '2026-07-01', end: '2026-07-31' }),
    );
    const today = toLocalDateStr(new Date());
    renderPage('');
    await waitFor(() => {
      expect(asOfQueried()).toContain(today);
    });
    expect(asOfQueried()).not.toContain('2026-07-31');
    // …et elle ne réinjecte pas sa journée unique dans la clé partagée.
    expect(JSON.parse(sessionStorage.getItem('breakery.reports.period.v1') ?? '{}')).toEqual({
      start: '2026-07-01',
      end:   '2026-07-31',
    });
  });

  it('honore l ancien lien ?asOf= (repli legacy)', async () => {
    renderPage('?asOf=2026-03-31');
    await waitFor(() => {
      expect(asOfQueried()).toContain('2026-03-31');
    });
  });

  it('compare a la MEME DATE UN MOIS PLUS TOT, pas a la veille', async () => {
    renderPage();
    await waitFor(() => {
      expect(asOfQueried().length).toBeGreaterThanOrEqual(2);
    });
    expect(asOfQueried()).toContain('2026-04-14');
    expect(asOfQueried()).not.toContain('2026-05-13');
  });

  it('shows the balanced indicator when payload.balanced = true', async () => {
    renderPage();
    const status = await screen.findByRole('status', { name: 'Balanced indicator' });
    expect(status.textContent).toMatch(/balanced/i);
  });

  it('passe l indicateur en alerte quand le bilan ne boucle pas', async () => {
    balanced = false;
    renderPage();
    const alert = await screen.findByRole('alert', { name: 'Balanced indicator' });
    expect(alert.textContent).toMatch(/Not balanced/);
  });

  it('les trois sections restent separees, chacune avec son total', async () => {
    renderPage();
    await screen.findAllByText('Total assets');
    expect(within(screen.getByTestId('bs-assets')).getByText('Total assets')).toBeInTheDocument();
    expect(within(screen.getByTestId('bs-liabilities')).getByText('Total liabilities')).toBeInTheDocument();
    expect(within(screen.getByTestId('bs-equity')).getByText('Total equity')).toBeInTheDocument();
  });

  it('aucun graphe : un bilan est un etat, pas une serie', async () => {
    renderPage();
    await screen.findAllByText('Total assets');
    // Les seules images du document sont les barres de partage des cartes de
    // ventilation, absentes ici — donc aucune.
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
