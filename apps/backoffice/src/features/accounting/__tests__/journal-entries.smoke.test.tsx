// apps/backoffice/src/features/accounting/__tests__/journal-entries.smoke.test.tsx
//
// Session 26b / Wave 2.D — smoke for JournalEntriesPage.
//   T1 — Renders journal entries from useJournalEntries.
//   T2 — "+ New manual JE" opens modal ; balanced 2-line entry submits.
//
// Critique 2026-08-26 — trois défauts avaient chacun leur test :
//   T3 — l'ordre départage sur `entry_number`, jamais sur l'UUID `id`, et le
//        total vient d'un `count` serveur et non d'un plafond de requête.
//   T4 — les identifiants techniques des descriptions sont résolus À
//        L'AFFICHAGE.
//   T5 — la période vit dans l'URL : elle se lit au montage et s'y réécrit.
//
// Arbitrages du 2026-08-26 :
//   T6 — une session de caisse se rend « <jour métier> · <poste> », le poste
//        n'étant pas garanti.
//   T7 — une requête en échec ne se lit PAS « aucune écriture sur la période ».

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSX } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JournalEntriesPage from '@/features/accounting/pages/JournalEntriesPage.js';

const PRODUCT_ID = '998c9eee-a28e-4a59-9d27-3d14e6d150f3';
const SESSION_ID = '4d11cb01-1775-4f9e-b180-94decdb74584';
const SESSION_BARE_ID = '9acb24cc-d56a-4a53-939b-e63a902dcbe6';

const ENTRIES = [
  {
    id: 'je1', entry_number: 'JE-20260520-0001', entry_date: '2026-05-20',
    description: 'Test sale', reference_type: 'sale', reference_id: 'o1',
    status: 'posted', total_debit: 50000, total_credit: 50000,
    created_at: '2026-05-20T10:00:00Z',
  },
  {
    id: 'je2', entry_number: 'JE-20260521-0002', entry_date: '2026-05-21',
    description: 'April rent', reference_type: 'manual', reference_id: null,
    status: 'posted', total_debit: 12000000, total_credit: 12000000,
    created_at: '2026-05-21T09:00:00Z',
  },
  {
    id: 'je3', entry_number: 'JE-20260521-0003', entry_date: '2026-05-21',
    description: `Stock movement adjustment for product ${PRODUCT_ID}`,
    reference_type: 'stock_movement', reference_id: 'sm1',
    status: 'posted', total_debit: 4500, total_credit: 4500,
    created_at: '2026-05-21T11:00:00Z',
  },
  {
    id: 'je4', entry_number: 'JE-20260521-0004',
    description: `Shift close variance (session ${SESSION_ID})`,
    entry_date: '2026-05-21',
    reference_type: 'shift_close', reference_id: SESSION_ID,
    status: 'posted', total_debit: 2500, total_credit: 2500,
    created_at: '2026-05-21T22:00:00Z',
  },
  {
    id: 'je5', entry_number: 'JE-20260521-0005',
    description: `Shift close variance (session ${SESSION_BARE_ID})`,
    entry_date: '2026-05-21',
    reference_type: 'shift_close', reference_id: SESSION_BARE_ID,
    status: 'posted', total_debit: 1000, total_credit: 1000,
    created_at: '2026-05-21T23:00:00Z',
  },
];
const ACCOUNTS = [
  { id: 'a1', code: '1110', name: 'Cash', account_class: 1 },
  { id: 'a2', code: '5810', name: 'Rent Expense', account_class: 6 },
];
const PRODUCTS = [{ id: PRODUCT_ID, name: 'Croissant au beurre' }];
// Deux sessions : l'une rattachée à un poste, l'autre non — `terminal_id` est
// nullable et l'embed `lan_devices` retombe aussi à `null` quand le profil n'a
// pas `lan.devices.read`. Les deux heures d'ouverture sont choisies de part et
// d'autre de minuit WITA, pour que le libellé prouve qu'il rend le JOUR MÉTIER.
const POS_SESSIONS = [
  { id: SESSION_ID,      opened_at: '2026-05-21T14:20:00Z', terminal: { name: 'Register 1' } },
  { id: SESSION_BARE_ID, opened_at: '2026-05-21T17:30:00Z', terminal: null },
];

// Le serveur en connaît 137 ; la page n'en a chargé que 3. C'est exactement le
// mensonge que la critique a relevé : « 200 entries » pour un plafond de
// requête. Le total DOIT venir d'ici.
const SERVER_COUNT = 137;

const spy = vi.hoisted(() => ({
  rpc: vi.fn(),
  orders:    [] as { table: string; column: string; ascending: boolean | undefined }[],
  selects:   [] as { table: string; cols: string; count: string | undefined }[],
  inFilters: [] as { table: string; ids: readonly string[] }[],
  eqs:       [] as { table: string; column: string; value: unknown }[],
  ors:       [] as { table: string; expr: string }[],
  /** Message d'erreur à renvoyer pour `journal_entries`, ou `null`. */
  jeError:   null as string | null,
  reset(): void {
    this.orders.length = 0;
    this.selects.length = 0;
    this.inFilters.length = 0;
    this.eqs.length = 0;
    this.ors.length = 0;
    this.jeError = null;
  },
}));

interface TableResult { data: unknown; error: { message: string } | null; count: number | null }

vi.mock('@/lib/supabase.js', () => {
  function tableData(table: string): TableResult {
    if (table === 'journal_entries') {
      return spy.jeError === null
        ? { data: ENTRIES, error: null, count: SERVER_COUNT }
        : { data: null, error: { message: spy.jeError }, count: null };
    }
    if (table === 'accounts')             return { data: ACCOUNTS, error: null, count: null };
    if (table === 'products')             return { data: PRODUCTS, error: null, count: null };
    if (table === 'customers')            return { data: [],       error: null, count: null };
    if (table === 'pos_sessions')         return { data: POS_SESSIONS, error: null, count: null };
    if (table === 'journal_entry_lines')  return { data: [],       error: null, count: null };
    return { data: [], error: null, count: null };
  }
  function buildChain(table: string) {
    const result = tableData(table);
    type Resolver = (v: TableResult) => unknown;
    const chain: Record<string, unknown> = {
      select: (cols: string, opts?: { count?: string }) => {
        spy.selects.push({ table, cols, count: opts?.count });
        return chain;
      },
      is:  () => chain,
      eq:  (column: string, value: unknown) => {
        spy.eqs.push({ table, column, value });
        return chain;
      },
      gte: () => chain,
      lte: () => chain,
      or:  (expr: string) => {
        spy.ors.push({ table, expr });
        return chain;
      },
      in:  (_col: string, ids: readonly string[]) => {
        spy.inFilters.push({ table, ids });
        return chain;
      },
      order: (column: string, opts?: { ascending?: boolean }) => {
        spy.orders.push({ table, column, ascending: opts?.ascending });
        return chain;
      },
      limit: () => chain,
      then:  (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = spy.rpc(fn, args) as TableResult | undefined;
        return Promise.resolve(out ?? {
          data: {
            je_id: 'new-je', entry_number: 'JE-20260523-0001',
            entry_date: '2026-05-23', total_debit: 100, total_credit: 100, line_count: 2,
          },
          error: null,
        });
      },
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function LocationProbe(): JSX.Element {
  return <span data-testid="probe-search">{useLocation().search}</span>;
}

function renderPage(entry = '/'): void {
  render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <JournalEntriesPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JournalEntriesPage (S26b Wave 2)', () => {
  beforeEach(() => { spy.rpc.mockReset(); spy.reset(); });

  it('T1 — renders journal entries from useJournalEntries', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('je-row-JE-20260520-0001')).not.toBeNull();
      expect(screen.queryByTestId('je-row-JE-20260521-0002')).not.toBeNull();
    });
  });

  it('T2 — opens manual JE modal and submits a balanced 2-line entry', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('je-new-btn'));

    fireEvent.change(screen.getByTestId('je-modal-description'),
      { target: { value: 'April rent payment' } });
    fireEvent.click(screen.getByTestId('je-modal-next'));

    // Step 2 — fill two lines + PIN
    await waitFor(() => {
      expect(screen.queryByTestId('je-modal-lines-table')).not.toBeNull();
    });
    await waitFor(
      () => {
        const opts = screen.queryAllByRole('option');
        expect(opts.length).toBeGreaterThanOrEqual(6);
      },
      { timeout: 4000 },
    );

    const accountSelects = screen.getAllByTestId(/^je-modal-line-account-/);
    expect(accountSelects.length).toBe(2);
    fireEvent.change(accountSelects[0]!, { target: { value: 'a2' } }); // Rent Expense
    fireEvent.change(accountSelects[1]!, { target: { value: 'a1' } }); // Cash

    // Find debit/credit inputs by position within the table rows.
    const debits  = screen.getAllByRole('spinbutton').filter((_, i) => i % 2 === 0);
    const credits = screen.getAllByRole('spinbutton').filter((_, i) => i % 2 === 1);
    fireEvent.change(debits[0]!,  { target: { value: '12000000' } });
    fireEvent.change(credits[1]!, { target: { value: '12000000' } });

    fireEvent.change(screen.getByTestId('je-modal-pin'), { target: { value: '123456' } });

    fireEvent.click(screen.getByTestId('je-modal-submit'));

    // Les matchers d'`expect` sont typés `any` : on les passe par une variable
    // annotée plutôt que de laisser un `any` s'infiltrer dans l'objet littéral.
    const linesMatcher: unknown = expect.arrayContaining([
      expect.objectContaining({ account_id: 'a2', debit:  12000000 }),
      expect.objectContaining({ account_id: 'a1', credit: 12000000 }),
    ]);
    await waitFor(() => {
      expect(spy.rpc).toHaveBeenCalledWith('create_manual_je_v1',
        expect.objectContaining({
          p_description: 'April rent payment',
          p_manager_pin: '123456',
          p_lines: linesMatcher,
        }),
      );
    });
  });

  it('T3 — orders on entry_number (not the UUID id) and reports the server count', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('je-table')).not.toBeNull();
    });

    const jeOrders = spy.orders.filter((o) => o.table === 'journal_entries');
    expect(jeOrders.map((o) => o.column)).toEqual(['entry_date', 'entry_number']);
    expect(jeOrders.every((o) => o.ascending === false)).toBe(true);
    expect(jeOrders.some((o) => o.column === 'id')).toBe(false);

    // Première page : le total est DEMANDÉ au serveur…
    expect(spy.selects.some((s) => s.table === 'journal_entries' && s.count === 'exact')).toBe(true);
    // …et le pied de table l'écrit sans le confondre avec ce qui est chargé.
    expect(screen.getByTestId('je-count').textContent).toBe('5 loaded of 137');
  });

  it('T4 — resolves product identifiers in descriptions at render time', async () => {
    renderPage();
    const cell = await screen.findByTestId('je-desc-JE-20260521-0003');
    await waitFor(() => {
      expect(cell.textContent).toBe('Stock movement adjustment for product Croissant au beurre');
    });
    // L'identifiant original reste accessible, et la résolution s'est faite en
    // UN lot pour toute la liste.
    expect(cell.querySelector(`[title="${PRODUCT_ID}"]`)).not.toBeNull();
    expect(spy.inFilters.filter((f) => f.table === 'products')).toHaveLength(1);
  });

  it('T5 — reads the period from the URL and writes it back', async () => {
    renderPage('/?start=2026-01-01&end=2026-01-31');
    const from = await screen.findByTestId<HTMLInputElement>('je-filter-start');
    expect(from.value).toBe('2026-01-01');
    expect(screen.getByTestId<HTMLInputElement>('je-filter-end').value).toBe('2026-01-31');

    fireEvent.change(from, { target: { value: '2026-02-01' } });
    await waitFor(() => {
      const search = screen.getByTestId('probe-search').textContent ?? '';
      expect(new URLSearchParams(search).get('start')).toBe('2026-02-01');
      expect(new URLSearchParams(search).get('end')).toBe('2026-01-31');
    });
  });

  // T6 — un `pos_sessions.id` nu ne dit ni quand ni où. Le libellé rend la date
  // d'ouverture en JOUR MÉTIER, et le poste quand il est connu.
  it('T6 — renders a shift_close session id as a date, plus the station when known', async () => {
    renderPage();

    const withStation = await screen.findByTestId('je-desc-JE-20260521-0004');
    await waitFor(() => {
      // Le libellé ne redit PAS « session » : la description le dit déjà.
      expect(withStation.textContent)
        .toBe('Shift close variance (session 21 May · Register 1)');
    });
    // L'UUID d'origine reste à un survol de distance — un rapprochement avec un
    // export en a besoin.
    expect(withStation.querySelector(`[title="${SESSION_ID}"]`)).not.toBeNull();

    // Sans poste : la date seule, jamais un séparateur orphelin. Ouverte à
    // 17:30 UTC, soit 01:30 le LENDEMAIN à Makassar — c'est le jour métier qui
    // s'écrit.
    const bare = screen.getByTestId('je-desc-JE-20260521-0005');
    expect(bare.textContent).toBe('Shift close variance (session 22 May)');

    // Toujours un seul aller-retour pour toute la liste.
    expect(spy.inFilters.filter((f) => f.table === 'pos_sessions')).toHaveLength(1);
  });

  // T8 — critique 2026-08-26 (soir) : 591 écritures ne se filtraient QUE par
  // date. Les trois filtres neufs vivent dans l'URL (comme les bornes) et
  // atteignent la requête : `eq` sur la famille d'émetteur, `eq` sur le compte
  // via l'embed `!inner`, `.or(ilike)` sur description + numéro.
  it('T8 — source, account and search filters write the URL and reach the query', async () => {
    renderPage();
    await screen.findByTestId('je-table');

    fireEvent.change(screen.getByTestId('je-filter-source'),
      { target: { value: 'shift_close' } });
    fireEvent.change(screen.getByTestId('je-filter-account'),
      { target: { value: 'a1' } });
    fireEvent.change(screen.getByTestId('je-filter-search'),
      { target: { value: 'variance' } });

    // L'URL d'abord : un filtre se partage et survit au retour arrière. La
    // recherche y arrive APRÈS le debounce (250 ms), d'où le waitFor commun.
    await waitFor(() => {
      const search = new URLSearchParams(
        screen.getByTestId('probe-search').textContent ?? '');
      expect(search.get('source')).toBe('shift_close');
      expect(search.get('account')).toBe('a1');
      expect(search.get('q')).toBe('variance');
    });

    await waitFor(() => {
      expect(spy.eqs.some((e) =>
        e.table === 'journal_entries'
        && e.column === 'reference_type' && e.value === 'shift_close')).toBe(true);
      expect(spy.eqs.some((e) =>
        e.table === 'journal_entries'
        && e.column === 'journal_entry_lines.account_id' && e.value === 'a1')).toBe(true);
      expect(spy.ors.some((o) =>
        o.table === 'journal_entries'
        && o.expr.includes('description.ilike.%variance%')
        && o.expr.includes('entry_number.ilike.%variance%'))).toBe(true);
      // Le filtre par compte passe par l'embed filtrant, pas par une seconde
      // requête : la première page filtrée le demande dans ses colonnes.
      expect(spy.selects.some((s) =>
        s.table === 'journal_entries'
        && s.cols.includes('journal_entry_lines!inner'))).toBe(true);
    });
  });

  // T7 — LE MENSONGE. Requête en échec, la page annonçait « No journal entries
  // in this period. » : une affirmation sur le grand livre là où le serveur
  // n'avait rien répondu.
  it('T7 — a failed query shows the error banner, never the empty state', async () => {
    spy.jeError = 'permission denied for table journal_entries';
    renderPage();

    const banner = await screen.findByTestId('je-error');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('could not be loaded');
    expect(banner.textContent).toContain('permission denied for table journal_entries');

    // L'état vide se tait, et la table ne se rend pas.
    expect(screen.queryByText('No journal entries in this period.')).toBeNull();
    expect(screen.queryByTestId('je-table')).toBeNull();

    // « Try again » relance la requête — ici elle réussit, la liste apparaît.
    spy.jeError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.queryByTestId('je-table')).not.toBeNull();
      expect(screen.queryByTestId('je-error')).toBeNull();
    });
  });
});
