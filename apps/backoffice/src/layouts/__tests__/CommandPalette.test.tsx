// apps/backoffice/src/layouts/__tests__/CommandPalette.test.tsx
//
// Refonte shell 2026-08-05 — le filet de la palette ⌘K.
//
// La palette est la CONTREPARTIE du passage de 85 entrées visibles à 7 onglets :
// si elle ne retrouve pas une page, cette page est perdue. D'où l'insistance
// sur le filtrage par permission (une destination interdite ne doit jamais
// apparaître, même en tapant son nom exact) et sur le fil d'Ariane.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CommandPalette, fuzzyScore } from '@/layouts/CommandPalette.js';
import { useAuthStore } from '@/stores/authStore.js';

const ALL_PERMS = [
  'orders.read', 'customers.read', 'settings.read', 'products.read',
  'inventory.read', 'expenses.read', 'expenses.create', 'reports.read',
  'reports.sales.read', 'reports.financial.read', 'reports.inventory.read',
  'users.read', 'users.create', 'combos.create', 'purchasing.po.create',
];

function setAuthState(perms: string[]) {
  useAuthStore.setState({
    user: { id: 'u-1', full_name: 'Mamat', role_code: 'OWNER', employee_code: 'E1' },
    sessionToken: 'tok',
    permissions: perms,
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

/** Sonde de route — rend le pathname courant pour vérifier la navigation. */
function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderPalette(onClose: () => void = vi.fn()) {
  // La palette interroge désormais les entités via react-query (lot 4) : un
  // QueryClient neuf par rendu, retry off — les sections serveur restent
  // vides sous test, seuls pages/actions sont exercés ici.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/backoffice']}>
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
        <CommandPalette open onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// `combobox` et non `textbox` : le champ pilote une liste d'options par
// `aria-activedescendant`, et il le DIT désormais (role + aria-autocomplete +
// aria-expanded). Le rôle rendu change avec l'annonce.
const input = () => screen.getByRole('combobox', { name: /pages and actions/i });

describe('fuzzyScore', () => {
  it('classe une sous-chaîne littérale devant une correspondance dispersée', () => {
    const literal = fuzzyScore('sales', 'Sales by hour') ?? Infinity;
    const scattered = fuzzyScore('sbh', 'Sales by hour') ?? Infinity;
    expect(scattered).toBeLessThan(Infinity);
    expect(literal).toBeLessThan(scattered);
  });

  it('trouve les initiales dans l’ordre', () => {
    expect(fuzzyScore('sbh', 'Sales by hour')).not.toBeNull();
    expect(fuzzyScore('cf', 'Cash flow')).not.toBeNull();
  });

  it('rejette ce qui n’apparaît pas dans l’ordre', () => {
    expect(fuzzyScore('hbs', 'Sales by hour')).toBeNull();
    expect(fuzzyScore('zzz', 'Sales by hour')).toBeNull();
  });

  it('accepte tout sur une requête vide', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
});

describe('CommandPalette', () => {
  beforeEach(() => {
    cleanup();
    // La palette donne le focus au champ au frame suivant — on rend le rAF
    // synchrone pour que le champ soit prêt dès le premier assert.
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it('ne rend rien quand elle est fermée', () => {
    setAuthState(ALL_PERMS);
    // Même fermée, la palette monte usePaletteSearch (les hooks ne sont pas
    // conditionnels) : il lui faut un QueryClient.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommandPalette open={false} onClose={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('propose les actions avant les pages à froid', () => {
    setAuthState(ALL_PERMS);
    renderPalette();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('New expense');
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('filtre sur le titre et affiche le fil d’Ariane', () => {
    setAuthState(ALL_PERMS);
    renderPalette();
    fireEvent.change(input(), { target: { value: 'cash flow' } });
    const option = screen.getByRole('option', { name: /Cash flow/ });
    // Le fil d'Ariane est rendu SEGMENT par segment depuis le 2026-08-18, le
    // séparateur étant une icône `ChevronRight` et non le glyphe `›` : on
    // vérifie donc les deux segments, dans l'ordre, à l'intérieur de l'option.
    const crumbs = within(option).getAllByText(/^(Reports|Financial)$/);
    expect(crumbs.map((n) => n.textContent)).toEqual(['Reports', 'Financial']);
  });

  it('n’expose jamais une destination interdite, même sur son nom exact', () => {
    setAuthState(['expenses.read']); // pas de reports.financial.read
    renderPalette();
    fireEvent.change(input(), { target: { value: 'cash flow' } });
    expect(screen.queryByRole('option', { name: /Cash flow/ })).not.toBeInTheDocument();
    // Avant l'échéance du debounce (250 ms) le message est « No page or
    // action matches » ; après, la variante longue avec les entités. Les deux
    // contiennent « page or action matches » — l'assert reste hors-timing.
    expect(screen.getByText(/page or action matches/)).toBeInTheDocument();
  });

  it('n’expose pas une action dont le droit de création manque', () => {
    setAuthState(['expenses.read']); // lecture seule : pas de expenses.create
    renderPalette();
    fireEvent.change(input(), { target: { value: 'new expense' } });
    expect(screen.queryByRole('option', { name: /New expense/ })).not.toBeInTheDocument();
  });

  it('navigue vers la ligne surlignée sur Entrée et se ferme', () => {
    setAuthState(ALL_PERMS);
    const onClose = vi.fn();
    renderPalette(onClose);
    fireEvent.change(input(), { target: { value: 'cash flow' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByTestId('pathname')).toHaveTextContent('/backoffice/reports/cash-flow');
  });

  it('descend et remonte le surlignage aux flèches', () => {
    setAuthState(ALL_PERMS);
    renderPalette();
    // Le clavier est écouté là où le focus se trouve réellement : le champ.
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('annonce la ligne surlignée — aria-activedescendant suit la flèche bas', () => {
    setAuthState(ALL_PERMS);
    renderPalette();
    // Le focus ne quitte jamais le champ : sans ce pointeur, un lecteur
    // d'écran ne dit rien de ce que les flèches parcourent (WCAG 4.1.2).
    const first = screen.getAllByRole('option')[0]!;
    expect(first.id).not.toBe('');
    expect(input()).toHaveAttribute('aria-activedescendant', first.id);

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const second = screen.getAllByRole('option')[1]!;
    expect(second.id).not.toBe(first.id);
    expect(input()).toHaveAttribute('aria-activedescendant', second.id);

    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveAttribute('aria-activedescendant', first.id);
  });

  it('ne fait pas compter les <li> comme options du listbox', () => {
    setAuthState(ALL_PERMS);
    renderPalette();
    const option = screen.getAllByRole('option')[0]!;
    expect(option.tagName).toBe('BUTTON');
    expect(option.closest('li')).toHaveAttribute('role', 'presentation');
  });

  it('ne pointe vers rien quand aucune ligne ne correspond', () => {
    setAuthState(ALL_PERMS);
    renderPalette();
    fireEvent.change(input(), { target: { value: 'zzzzzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(input()).not.toHaveAttribute('aria-activedescendant');
  });

  it('se ferme sur Échap', () => {
    setAuthState(ALL_PERMS);
    const onClose = vi.fn();
    renderPalette(onClose);
    fireEvent.keyDown(screen.getByTestId('command-palette'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
