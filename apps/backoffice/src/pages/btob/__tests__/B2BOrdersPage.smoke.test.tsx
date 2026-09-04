// apps/backoffice/src/pages/btob/__tests__/B2BOrdersPage.smoke.test.tsx
//
// Archétype LIST (régime FENÊTRÉ) + détail dépliable. Ce que ces tests tiennent :
//   · une ligne par commande, la plus récente en premier ;
//   · le détail ne se charge QU'à l'ouverture — sinon afficher cinquante
//     commandes lancerait cinquante requêtes pour rien ;
//   · une ligne annulée reste visible dans le détail, barrée et à zéro ;
//   · le pied déclare le CHARGÉ contre l'EXISTANT, jamais « N of N » ;
//   · la recherche et le filtre de règlement partent au SERVEUR et s'écrivent
//     dans l'URL ;
//   · l'action de création est verrouillée ET dit pourquoi ;
//   · une requête en échec laisse la page debout, avec un « Try again ».
//
// ── LE MOCK A DÛ ÊTRE RÉÉCRIT (campagne design 2026-08-18, lot E) ────────────
//
// L'ancien exposait `select/order/limit/eq/gt` et rendait TOUJOURS les deux
// mêmes lignes, quelle que soit la requête. Il ne pouvait donc pas voir passer
// une pagination (`range`), une recherche (`or`) ni un comptage
// (`count: 'exact'`), qui sont exactement ce que la page fait désormais faire au
// serveur. Le mock ci-dessous EXÉCUTE les filtres, le tri et la tranche sur le
// jeu d'essai — sinon un test vert ne prouverait que l'absence d'erreur de
// syntaxe.
//
// Les invariants de l'ancien fichier — ordre antichronologique, filtre par
// compteur — sont conservés tels quels.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

const itemsSpy = vi.fn();

interface InvoiceFixture {
  invoice_id: string; order_number: string; invoice_number: string | null;
  customer_id: string; b2b_company_name: string | null; customer_name: string | null;
  invoice_total: number; invoice_date: string; paid_at: string | null;
  order_status: string; age_days: number; is_unpaid: boolean;
  amount_paid: number; outstanding: number; pickup_date: string | null;
}

const INVOICES: InvoiceFixture[] = [
  {
    invoice_id: 'o-old', order_number: 'B2B-0001', invoice_number: null,
    customer_id: 'c1', b2b_company_name: 'Hotel Senggigi', customer_name: null,
    invoice_total: 1_200_000, invoice_date: '2026-08-01T08:00:00Z', paid_at: null,
    order_status: 'completed', age_days: 7, is_unpaid: true,
    amount_paid: 0, outstanding: 1_200_000, pickup_date: '2026-08-09',
  },
  {
    invoice_id: 'o-new', order_number: 'B2B-0002', invoice_number: 'INV/2026/2',
    customer_id: 'c2', b2b_company_name: null, customer_name: 'Warung Ayu',
    invoice_total: 450_000, invoice_date: '2026-08-06T08:00:00Z', paid_at: '2026-08-07T08:00:00Z',
    order_status: 'completed', age_days: 2, is_unpaid: false,
    amount_paid: 450_000, outstanding: 0, pickup_date: null,
  },
];

const ITEMS = [
  { id: 'i1', name_snapshot: 'Baguette tradition', quantity: 40, unit_price: 25_000, line_total: 1_000_000, is_cancelled: false },
  { id: 'i2', name_snapshot: 'Croissant beurre',   quantity: 10, unit_price: 20_000, line_total: 200_000,   is_cancelled: false },
  { id: 'i3', name_snapshot: 'Pain de mie',        quantity: 5,  unit_price: 30_000, line_total: 150_000,   is_cancelled: true },
];

/** Bascule d'un test à l'autre : la vue rend une erreur au lieu des lignes. */
const viewFails = { current: false };
/** Bascule : la RPC de compteurs rend une erreur. */
const rpcFails = { current: false };

// ---------------------------------------------------------------------------
// Mock PostgREST — filtre, trie, compte et tranche pour de bon.
// ---------------------------------------------------------------------------

type Pred = (r: InvoiceFixture) => boolean;

/** Accès par nom de colonne — le mock reçoit des chaînes, pas des clés typées. */
function cell(r: InvoiceFixture, col: string): string | number | boolean | null {
  return (r as unknown as Record<string, string | number | boolean | null>)[col] ?? null;
}
function text(r: InvoiceFixture, col: string): string {
  const v = cell(r, col);
  return v === null ? '' : String(v);
}

function makeViewChain() {
  let head = false;
  let sortCol: keyof InvoiceFixture = 'invoice_date';
  let sortAsc = true;
  let sorted = false;
  let from = 0;
  let to = Number.MAX_SAFE_INTEGER;
  const preds: Pred[] = [];

  const settle = (): { data: unknown; error: unknown; count: number | null } => {
    if (viewFails.current) {
      return { data: null, error: { message: 'view_b2b_invoices unreachable' }, count: null };
    }
    const kept = INVOICES.filter((r) => preds.every((p) => p(r)));
    const ordered = [...kept].sort((a, b) => {
      const va = a[sortCol] as string | number;
      const vb = b[sortCol] as string | number;
      const cmp = va === vb ? 0 : va < vb ? -1 : 1;
      return sortAsc ? cmp : -cmp;
    });
    return {
      // `head: true` ne transporte AUCUNE ligne — c'est tout l'intérêt d'un
      // comptage : le mock doit le refléter, sinon un compteur cassé passerait.
      data: head ? null : ordered.slice(from, to + 1),
      error: null,
      count: ordered.length,
    };
  };

  const chain = {
    select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
      head = opts?.head === true;
      return chain;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      // Seul le PREMIER `order` porte le classement ; le second est le
      // départage stable sur invoice_id, qui n'a pas d'effet sur ce jeu.
      if (!sorted) {
        sortCol = col as keyof InvoiceFixture;
        sortAsc = opts?.ascending !== false;
        sorted = true;
      }
      return chain;
    },
    range: (f: number, t: number) => { from = f; to = t; return chain; },
    limit: (n: number) => { from = 0; to = n - 1; return chain; },
    eq:  (col: string, v: unknown) => { preds.push((r) => (r as unknown as Record<string, unknown>)[col] === v); return chain; },
    gt:  (col: string, v: number)  => { preds.push((r) => Number((r as unknown as Record<string, unknown>)[col]) > v); return chain; },
    lte: (col: string, v: number)  => { preds.push((r) => Number((r as unknown as Record<string, unknown>)[col]) <= v); return chain; },
    or: (expr: string) => {
      const terms = [...expr.matchAll(/(\w+)\.ilike\.%([^%,]*)%/g)]
        .map((m) => [m[1]!, m[2]!.toLowerCase()] as const);
      preds.push((r) => terms.some(([col, needle]) => text(r, col).toLowerCase().includes(needle)));
      return chain;
    },
    then: (cb: (v: { data: unknown; error: unknown; count: number | null }) => unknown) =>
      Promise.resolve(settle()).then(cb),
  };
  return chain;
}

const rpcSpy = vi.fn((fn: string) => {
  if (fn === 'get_b2b_dashboard_counters_v1') {
    return Promise.resolve(
      rpcFails.current
        ? { data: null, error: { message: 'rpc down' } }
        : { data: { outstanding_ar: 1_200_000 }, error: null },
    );
  }
  return Promise.resolve({ data: null, error: null });
});

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'order_items') return itemsSpy(table) as unknown;
      return makeViewChain();
    },
    rpc: (fn: string) => rpcSpy(fn),
  },
}));

// authStore — la permission de création se pilote par test.
const { permRef } = vi.hoisted(() => ({ permRef: { current: new Set<string>() } }));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (code: string) => boolean }) => unknown) =>
    selector({ hasPermission: (code: string) => permRef.current.has(code) }),
}));

import B2BOrdersPage from '../B2BOrdersPage.js';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('B2BOrdersPage', () => {
  beforeEach(() => {
    itemsSpy.mockReset();
    rpcSpy.mockClear();
    viewFails.current = false;
    rpcFails.current = false;
    permRef.current = new Set<string>();
    const chain = {
      select: () => chain,
      eq:     () => chain,
      order:  () => Promise.resolve({ data: ITEMS, error: null }),
    };
    itemsSpy.mockReturnValue(chain);
  });

  it('lists one row per order, most recent first', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0002')).toBeInTheDocument());
    const numbers = screen.getAllByText(/^B2B-000\d$/).map((n) => n.textContent);
    expect(numbers).toEqual(['B2B-0002', 'B2B-0001']);
  });

  it('does not load any order line until a row is opened', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(itemsSpy).not.toHaveBeenCalled();
  });

  it('opens the order onto its lines, keeping a cancelled line visible at zero', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('B2B-0001'));

    await waitFor(() => expect(screen.getByTestId('b2b-items-panel')).toBeInTheDocument());
    expect(itemsSpy).toHaveBeenCalledWith('order_items');
    expect(screen.getByText('Baguette tradition')).toBeInTheDocument();

    // La ligne annulée reste — la faire disparaître donnerait une somme qui ne
    // retombe pas sur le total, et laisserait croire qu'elle n'a pas existé.
    const cancelled = screen.getByText('Pain de mie');
    expect(cancelled).toBeInTheDocument();
    expect(cancelled.className).toMatch(/line-through/);
  });

  it('opens an order from the keyboard — the chevron is a button, not an ornament', async () => {
    // Le clic-ligne du DataTable ne se prend ni au Tab ni à Entrée : sans ce
    // bouton, le détail d'une commande était inatteignable au clavier
    // (WCAG 2.1.1). Un <button> natif est dans l'ordre de tabulation et
    // Entrée / Espace y émettent un clic — c'est ce clic qu'on rejoue ici.
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /show the lines of order B2B-0001/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByTestId('b2b-items-panel')).toBeInTheDocument());
    const opened = screen.getByRole('button', { name: /hide the lines of order B2B-0001/i });
    expect(opened).toHaveAttribute('aria-expanded', 'true');

    // Le bouton ne bascule qu'UNE fois : son clic ne doit pas remonter jusqu'à
    // la ligne, qui refermerait aussitôt ce qu'il vient d'ouvrir.
    fireEvent.click(opened);
    await waitFor(() => expect(screen.queryByTestId('b2b-items-panel')).not.toBeInTheDocument());
  });

  it('marks an order with an outstanding balance as unpaid', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByText('unpaid')).toBeInTheDocument();
  });

  it('lot 3 — breadcrumb, badge de statut unifié et action de création dans le bandeau', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('Orders');
    // Le badge vient de statusMeta : libellé humain, plus la valeur brute.
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
    // D3 acté : la liste porte l'action de création (désactivée sans la gate).
    expect(screen.getByRole('button', { name: /new b2b order/i })).toBeInTheDocument();
  });

  it('shows the pickup day, and says so when none was agreed', async () => {
    // La colonne est ouverte mais sa saisie n'est pas branchee : « not set » est
    // l'etat NORMAL aujourd'hui, pas une erreur. Il doit se lire comme tel.
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByText('09 Aug')).toBeInTheDocument();
    expect(screen.getByText('not set')).toBeInTheDocument();
  });

  it('filters to unpaid orders from the counter strip', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0002')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('counter-unpaid'));

    // Le filtre part au SERVEUR : la requête change de clé, la table repasse
    // par son squelette. On attend donc l'état FINAL — les deux assertions
    // ensemble — plutôt que la seule disparition, qui est vraie dès le
    // squelette et laisserait le test vert sur une liste jamais revenue.
    await waitFor(() => {
      expect(screen.queryByText('B2B-0002')).not.toBeInTheDocument();
      expect(screen.getByText('B2B-0001')).toBeInTheDocument();
    });
  });

  // ── Lot E ─────────────────────────────────────────────────────────────────

  it('le pied déclare le CHARGÉ contre l’EXISTANT, pas « N of N »', async () => {
    // L'ancien pied lisait « 2 of 2 » : les deux nombres venaient du même
    // tableau reçu, donc il ne pouvait dire que « tout » — y compris quand le
    // plafond de 500 lignes avait tronqué le résultat. Le second nombre est
    // maintenant le `count: 'exact'` du serveur.
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByTestId('b2b-orders-footer-count')).toHaveTextContent('2 of 2 loaded');
  });

  it('la recherche part au serveur et réduit la liste', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('b2b-orders-search'), { target: { value: 'Senggigi' } });

    // Débounce : la frappe ne commet qu'après une pause, puis la requête
    // repart. On attend l'état final, squelette compris.
    await waitFor(() => {
      expect(screen.queryByText('B2B-0002')).not.toBeInTheDocument();
      expect(screen.getByText('B2B-0001')).toBeInTheDocument();
    }, { timeout: 3000 });
    // Les compteurs, eux, couvrent tout le registre — la page le DIT.
    expect(screen.getByTestId('b2b-orders-counters-hint')).toBeInTheDocument();
    expect(screen.getByTestId('counter-all')).toHaveTextContent('2');
  });

  it('les compteurs sont comptés serveur, encours compris', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByTestId('counter-all')).toHaveTextContent('2');
    expect(screen.getByTestId('counter-unpaid')).toHaveTextContent('1');
    expect(screen.getByTestId('counter-paid')).toHaveTextContent('1');
    // L'encours vient de get_b2b_dashboard_counters_v1, pas d'une somme faite
    // sur les lignes reçues.
    expect(rpcSpy).toHaveBeenCalledWith('get_b2b_dashboard_counters_v1');
    expect(screen.getByTestId('counter-outstanding').textContent).toMatch(/1\.200\.000/);
  });

  it('une RPC d’encours muette rend un tiret, sans effacer les trois comptes', async () => {
    rpcFails.current = true;
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByTestId('counter-outstanding')).toHaveTextContent('—');
    expect(screen.getByTestId('counter-all')).toHaveTextContent('2');
  });

  it('E3 — l’action de création est verrouillée ET dit pourquoi', async () => {
    // La règle a changé : masquer un contrôle laisse croire que la fonction
    // n'existe pas ; le désactiver nomme la règle. Le bouton l'était déjà, il
    // ne disait rien.
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /new b2b order/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires the pos.sale.create permission.');
    const describedBy = btn.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent)
      .toBe('Requires the pos.sale.create permission.');
  });

  it('E3 — avec la permission, le bouton est actif et sans raison affichée', async () => {
    permRef.current = new Set(['pos.sale.create']);
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /new b2b order/i });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute('aria-describedby');
  });

  it('E2 — une requête en échec laisse la page debout, avec un « Try again »', async () => {
    viewFails.current = true;
    render(wrap(<B2BOrdersPage />));

    await waitFor(() => expect(screen.getByTestId('b2b-orders-error')).toBeInTheDocument());
    // Le titre, le fil d'Ariane et la bande de compteurs SURVIVENT : la page
    // n'est pas remplacée par son message d'erreur.
    expect(screen.getByRole('heading', { level: 1, name: 'B2B orders' })).toBeInTheDocument();
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('Orders');
    expect(screen.getByTestId('b2b-orders-counters')).toBeInTheDocument();
    // Le message serveur est relégué, mais il est là — c'est du diagnostic.
    expect(screen.getByTestId('b2b-orders-error')).toHaveTextContent('view_b2b_invoices unreachable');
    // La vue en panne emporte aussi les comptages : DEUX bandeaux, chacun avec
    // sa propre reprise, parce qu'ils rejouent deux requêtes distinctes.
    expect(screen.getByTestId('b2b-orders-counters-error')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /try again/i })).toHaveLength(2);
  });
});
