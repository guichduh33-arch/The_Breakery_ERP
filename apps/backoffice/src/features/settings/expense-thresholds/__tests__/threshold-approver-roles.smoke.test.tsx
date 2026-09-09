// apps/backoffice/src/features/settings/expense-thresholds/__tests__/threshold-approver-roles.smoke.test.tsx
//
// Audit expense-governance 2026-08-31, finding n°5 (P1) — le formulaire de palier offrait
// une liste de rôles EN DUR qui incluait CASHIER, lequel ne détient pas `expenses.approve`.
// Un palier ainsi configuré gelait toute la tranche : personne ne pouvait l'approuver, et
// une dépense rejetée ne se re-soumet pas.
//
// T1 : les puces de rôle viennent de la BASE. La donnée simulée contient un code que la
//       liste en dur ne contenait pas (`SUPERVISOR`) : c'est ce qui rend le test capable de
//       rougir. Assert sur MANAGER seul ne prouverait rien — MANAGER figure aussi dans la
//       liste de repli, donc l'assertion passerait même sans lecture de la base.
// T2 : CASHIER n'est plus proposé.
// Le vrai garde-fou est serveur (`set_expense_threshold` refuse une étape sans approbateur
// possible) — cet écran évite simplement de composer une configuration vouée au refus.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThresholdFormDialog } from '../ThresholdFormDialog.js';

interface RoleRowsResult { data: { role_code: string }[] | null; error: { message: string } | null }
const orderMock = vi.fn<(...args: unknown[]) => Promise<RoleRowsResult>>();

interface QueryBuilder {
  select: (cols: string) => QueryBuilder;
  eq: (col: string, val: unknown) => QueryBuilder;
  order: (col: string, opts: unknown) => Promise<RoleRowsResult>;
}
const builder: QueryBuilder = {
  select: () => builder,
  eq: () => builder,
  order: (...args: unknown[]) => orderMock(...args),
};

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => builder),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

function noop(): void {
  // le dialogue reste ouvert pendant tout le test
}

function renderDialog(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ThresholdFormDialog open onOpenChange={noop} categories={[]} />
    </QueryClientProvider>,
  );
}

describe('ThresholdFormDialog — rôles approbateurs', () => {
  beforeEach(() => {
    orderMock.mockReset();
    // Ce que rend la base : les rôles qui détiennent expenses.approve. Pas CASHIER.
    orderMock.mockResolvedValue({
      data: [
        { role_code: 'ADMIN' }, { role_code: 'MANAGER' },
        { role_code: 'SUPERVISOR' }, { role_code: 'SUPER_ADMIN' },
      ],
      error: null,
    });
  });

  it('T1: les puces de rôle sont celles des porteurs de expenses.approve, lues en base', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /add step/i }));
    // SUPERVISOR n'existe que dans la réponse simulée : le voir prouve que la liste vient
    // de la base et non d'une constante.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'SUPERVISOR' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'MANAGER', pressed: true })).toBeInTheDocument();
  });

  it('T2: CASHIER n’est plus proposé — il ne peut pas approuver', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /add step/i }));
    // On attend la LISTE CHARGÉE (SUPERVISOR) avant de conclure : attendre MANAGER
    // laisserait passer la liste de repli, qui contient déjà MANAGER.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'SUPERVISOR' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'CASHIER' })).toBeNull();
  });
});
