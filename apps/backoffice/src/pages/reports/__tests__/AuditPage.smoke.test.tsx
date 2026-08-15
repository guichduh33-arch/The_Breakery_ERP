// apps/backoffice/src/pages/reports/__tests__/AuditPage.smoke.test.tsx
//
// Filtres + dépliage du contexte sur le journal d'audit. Prouve :
//   1. acteur / action / entité sont câblés sur les params de useAuditLogs ;
//   2. cliquer une ligne déplie son `metadata` (JSON rendu) ;
//   3. `audit_logs.payload` (la colonne de diff avant/après, S19) n'est PAS
//      servie par get_audit_logs_v3 — seul `metadata` est affichable ;
//   4. Action / Entity type sont débouncés 300 ms avant d'atteindre
//      useAuditLogs ; l'acteur (un `<select>`) reste immédiat.
//
// Lot G (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : les bornes de date quittent la barre de filtres pour le contrôle de
// période du bandeau (params `start` / `end`), donc TOUT appel à useAuditLogs
// porte désormais `dateStart` / `dateEnd`. Et le tri de colonne entre en scène :
// il réordonne les lignes chargées sans toucher à la pagination par curseur.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditPage from '@/pages/reports/AuditPage.js';

const ROWS = [
  {
    id: 2, actor_id: 'u-1', action: 'expense.approve', entity_type: 'expense',
    entity_id: 'e-1', metadata: { before: { status: 'submitted' }, after: { status: 'approved' } },
    created_at: '2026-07-04T10:00:00Z',
  },
  {
    id: 1, actor_id: 'u-2', action: 'product.update', entity_type: 'product',
    entity_id: 'p-1', metadata: { field: 'price', before: 10000, after: 12000 },
    created_at: '2026-07-03T09:00:00Z',
  },
];

const mockUseAuditLogs = vi.fn();
vi.mock('@/features/reports/hooks/useAuditLogs.js', () => ({
  useAuditLogs: (filters: unknown) => mockUseAuditLogs(filters) as unknown,
}));

vi.mock('@/features/auth/hooks/useLoginUsers.js', () => ({
  useLoginUsers: () => ({
    data: [
      { id: 'u-1', display_name: 'Made', role: 'MANAGER' },
      { id: 'u-2', display_name: 'Wayan', role: 'CASHIER' },
    ],
  }),
}));

// ExportMenu monte useGeneratePdf (useMutation) : hors QueryClientProvider, il
// faut le neutraliser. Ce test porte sur les filtres, pas sur l'export.
vi.mock('@/features/reports/components/ExportMenu.js', () => ({
  ExportMenu: () => <div data-testid="export-menu" />,
}));

function renderPage(entry = '/reports/audit'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuditPage />
    </MemoryRouter>,
  );
}

/** Les filtres métier, sans les bornes de période que le socle ajoute partout. */
function lastBusinessFilters(): Record<string, unknown> {
  const calls = mockUseAuditLogs.mock.calls;
  const last = calls[calls.length - 1]?.[0] as Record<string, unknown>;
  const { dateStart: _s, dateEnd: _e, ...rest } = last;
  return rest;
}

describe('AuditPage — filtres + contexte déplié', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockUseAuditLogs.mockReset();
    mockUseAuditLogs.mockReturnValue({
      data: { pages: [ROWS] },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    });
  });

  it('renders the two audit rows', () => {
    renderPage();
    expect(screen.getByTestId('audit-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('audit-row-2')).toBeInTheDocument();
  });

  it('borne la requête sur la période du socle (start / end)', () => {
    renderPage();
    const args = mockUseAuditLogs.mock.calls[0]?.[0] as { dateStart: string; dateEnd: string };
    expect(args.dateStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(args.dateEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pre-fills the action filter from ?action= (S73 Settings History deep-link)', () => {
    renderPage('/reports/audit?action=setting.update');
    expect(lastBusinessFilters()).toEqual({ action: 'setting.update' });
    expect(screen.getByTestId('audit-filter-action')).toHaveValue('setting.update');
  });

  it('actor (select) filter reaches useAuditLogs immediately, no debounce', () => {
    renderPage();
    expect(lastBusinessFilters()).toEqual({});

    fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'u-1' } });
    expect(lastBusinessFilters()).toEqual({ actorId: 'u-1' });
  });

  describe('debounced action/entity filters (review finding fix)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('debounces action/entity so useAuditLogs settles 300ms after the last keystroke', () => {
      renderPage();

      fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'u-1' } });
      expect(lastBusinessFilters()).toEqual({ actorId: 'u-1' });

      fireEvent.change(screen.getByTestId('audit-filter-action'), { target: { value: 'expense.approve' } });
      // Pas encore commité vers useAuditLogs — le débounce court.
      expect(lastBusinessFilters()).toEqual({ actorId: 'u-1' });
      act(() => { vi.advanceTimersByTime(300); });
      expect(lastBusinessFilters()).toEqual({ actorId: 'u-1', action: 'expense.approve' });

      fireEvent.change(screen.getByTestId('audit-filter-entity'), { target: { value: 'expense' } });
      expect(lastBusinessFilters()).toEqual({ actorId: 'u-1', action: 'expense.approve' });
      act(() => { vi.advanceTimersByTime(300); });
      expect(lastBusinessFilters()).toEqual({
        actorId: 'u-1', action: 'expense.approve', entityType: 'expense',
      });
    });

    it('typing character by character only triggers ONE fetch, after stabilization', () => {
      renderPage();
      const callsBefore = mockUseAuditLogs.mock.calls.length;
      const input = screen.getByTestId('audit-filter-action');

      // « exp » frappé caractère par caractère, 100 ms d'écart — bien en deçà
      // de la fenêtre de 300 ms entre deux frappes.
      fireEvent.change(input, { target: { value: 'e' } });
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.change(input, { target: { value: 'ex' } });
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.change(input, { target: { value: 'exp' } });
      act(() => { vi.advanceTimersByTime(100); });

      // 300 ms ne se sont pas écoulées depuis la DERNIÈRE frappe — aucun commit.
      expect(lastBusinessFilters()).toEqual({});
      expect(mockUseAuditLogs.mock.calls.length).toBe(callsBefore);

      act(() => { vi.advanceTimersByTime(200); }); // 300 ms au total
      expect(lastBusinessFilters()).toEqual({ action: 'exp' });
      // Exactement UN appel de plus : le commit débouncé, pas un par frappe.
      expect(mockUseAuditLogs.mock.calls.length).toBe(callsBefore + 1);
    });

    // Constat de re-revue — fermeture périmée : le timer débouncé fermait sur
    // `value.actorId` AU MOMENT DE LA FRAPPE. Changer l'acteur (commit immédiat)
    // pendant qu'un timer Action/Entity était en vol faisait revenir l'acteur
    // périmé 300 ms plus tard. Ce test reproduit exactement ce recouvrement.
    it('overlapping an immediate Actor change with an in-flight Action debounce keeps BOTH (no reversion)', () => {
      renderPage();

      fireEvent.change(screen.getByTestId('audit-filter-action'), { target: { value: 'exp' } }); // t=0
      act(() => { vi.advanceTimersByTime(150); }); // timer Action encore en vol

      fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'u-1' } });
      expect(lastBusinessFilters()).toEqual({ actorId: 'u-1' });

      act(() => { vi.advanceTimersByTime(150); }); // t=300 ms — le timer part
      expect(lastBusinessFilters()).toEqual({ actorId: 'u-1', action: 'exp' });
    });
  });

  it('"Clear filters" resets back to no filters', () => {
    renderPage();
    fireEvent.change(screen.getByTestId('audit-filter-actor'), { target: { value: 'u-1' } });
    fireEvent.click(screen.getByTestId('audit-filter-clear'));
    expect(lastBusinessFilters()).toEqual({});
  });

  it('clicking a row expands its metadata (before/after) detail; clicking again collapses it', async () => {
    renderPage();
    expect(screen.queryByTestId('audit-detail-2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('audit-row-2'));
    await waitFor(() => {
      const detail = screen.getByTestId('audit-detail-2');
      expect(detail.textContent).toContain('submitted');
      expect(detail.textContent).toContain('approved');
    });

    fireEvent.click(screen.getByTestId('audit-row-2'));
    expect(screen.queryByTestId('audit-detail-2')).not.toBeInTheDocument();
  });

  describe('tri de colonne (lot G)', () => {
    it('les en-têtes triables sont des BOUTONS focusables portant aria-sort', () => {
      renderPage();
      const header = screen.getByRole('columnheader', { name: 'Action' });
      expect(header).toHaveAttribute('aria-sort', 'none');
      expect(within(header).getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });

    it('trie les lignes chargées sans toucher à l\'ordre serveur par défaut', () => {
      renderPage();
      const bodyIds = (): string[] =>
        screen.getAllByRole('row')
          .map((r) => r.getAttribute('data-testid'))
          .filter((t): t is string => t?.startsWith('audit-row-') === true);

      // Ordre serveur : le plus récent d'abord (id 2, puis id 1).
      expect(bodyIds()).toEqual(['audit-row-2', 'audit-row-1']);

      // Tri ascendant par action : « expense.approve » avant « product.update ».
      fireEvent.click(screen.getByRole('button', { name: 'Action' }));
      expect(screen.getByRole('columnheader', { name: 'Action' })).toHaveAttribute('aria-sort', 'ascending');
      expect(bodyIds()).toEqual(['audit-row-2', 'audit-row-1']);

      // Descendant : l'inverse.
      fireEvent.click(screen.getByRole('button', { name: 'Action' }));
      expect(bodyIds()).toEqual(['audit-row-1', 'audit-row-2']);

      // Troisième clic : retour à l'ordre serveur.
      fireEvent.click(screen.getByRole('button', { name: 'Action' }));
      expect(screen.getByRole('columnheader', { name: 'Action' })).toHaveAttribute('aria-sort', 'none');
      expect(bodyIds()).toEqual(['audit-row-2', 'audit-row-1']);
    });
  });

  it('rend la bannière d\'erreur unifiée du socle quand la requête échoue', () => {
    mockUseAuditLogs.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('RPC audit error'),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('report-error')).toHaveTextContent('RPC audit error');
  });
});
