// apps/backoffice/src/features/expenses/__tests__/expense-consequence-rail.smoke.test.tsx
//
// Lot 8 — le rail de conséquence de l'archétype 4 (Form). Un rail qui affirme
// une conséquence sans test est exactement la promesse que ce lot corrige :
// on fige donc les trois cas de la chaîne d'approbation, le total dérivé, la
// traduction des codes de rôle en noms, et la formule qui dit que le rail
// PRÉVOIT et ne DÉCIDE pas.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatCurrency } from '@breakery/utils';
import { MemoryRouter } from 'react-router-dom';
import { ExpenseConsequenceRail } from '@/features/expenses/components/ExpenseConsequenceRail.js';
import type { ExpenseThresholdRow } from '@/features/settings/expense-thresholds/hooks/useExpenseThresholds.js';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('@/features/settings/expense-thresholds/hooks/useExpenseThresholds.js', () => ({
  useExpenseThresholds: vi.fn(),
}));
import { useExpenseThresholds } from '@/features/settings/expense-thresholds/hooks/useExpenseThresholds.js';

vi.mock('@/features/users/hooks/useRolesList.js', () => ({
  useRolesList: () => ({
    data: [
      { code: 'MANAGER', name: 'Manager',     description: null, is_system: true },
      { code: 'ADMIN',   name: 'Super Admin', description: null, is_system: true },
    ],
  }),
}));

vi.mock('@/features/expenses/hooks/useExpensesList.js', () => ({
  useExpensesList: () => ({ data: [], isLoading: false, isError: false }),
  useExpenseCategories: () => ({ data: [{ id: 'cat-1', name: 'Utilities' }] }),
}));

// ── Données ──────────────────────────────────────────────────────────────────
const base = {
  category_id: null,
  category_name: null,
  steps: [],
  created_at: '',
  updated_at: '',
};

const TWO_STEP: ExpenseThresholdRow = {
  ...base,
  id: 'two',
  amount_min: 1_000_000,
  amount_max: 9_999_999_999,
  steps: [
    { role_codes: ['MANAGER', 'ADMIN'], label: 'Manager approval' },
    { role_codes: ['ADMIN'],            label: 'Owner approval' },
  ],
};

function setThresholds(rows: ExpenseThresholdRow[]): void {
  vi.mocked(useExpenseThresholds).mockReturnValue({
    data: rows,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useExpenseThresholds>);
}

function renderRail(props: { categoryId?: string; amount?: string; vatAmount?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ExpenseConsequenceRail
          categoryId={props.categoryId ?? 'cat-1'}
          amount={props.amount ?? ''}
          vatAmount={props.vatAmount ?? '0'}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Chaîne d'approbation : les trois cas ─────────────────────────────────────
describe('ExpenseConsequenceRail — chaîne d’approbation', () => {
  it('cas 1 — palier trouvé : les étapes s’affichent dans l’ordre, avec le NOM des rôles', () => {
    setThresholds([TWO_STEP]);
    renderRail({ amount: '4850000' });

    expect(screen.getByTestId('forecast-chain')).toHaveTextContent('2 approval steps');
    expect(screen.getByTestId('forecast-step-0')).toHaveTextContent('Manager approval');
    // La table `roles` porte un nom propre — on ne montre pas `ADMIN` brut.
    expect(screen.getByTestId('forecast-step-0')).toHaveTextContent('Manager, Super Admin');
    expect(screen.getByTestId('forecast-step-1')).toHaveTextContent('Owner approval');
    expect(screen.getByTestId('forecast-step-1')).not.toHaveTextContent('ADMIN');
  });

  it('cas 2 — aucun palier : le rail dit que la soumission sera REFUSÉE, pas qu’aucune approbation n’est requise', () => {
    setThresholds([]);
    renderRail({ amount: '4850000' });

    const box = screen.getByTestId('forecast-unconfigured');
    expect(box).toHaveTextContent('No threshold covers this amount.');
    expect(box).toHaveTextContent(/the server refuses a submission it cannot price/i);
    expect(screen.queryByTestId('forecast-chain')).not.toBeInTheDocument();
  });

  it('cas 3 — montant vide : le rail n’affirme rien et rend le tiret', () => {
    setThresholds([TWO_STEP]);
    renderRail({ amount: '' });

    expect(screen.getByTestId('forecast-pending')).toHaveTextContent('—');
    expect(screen.queryByTestId('forecast-chain')).not.toBeInTheDocument();
    expect(screen.queryByTestId('forecast-unconfigured')).not.toBeInTheDocument();
  });

  it('steps = [] est une AUTO-APPROBATION, distincte de « aucun palier »', () => {
    setThresholds([{ ...TWO_STEP, id: 'auto', amount_min: 0, amount_max: 100_000, steps: [] }]);
    renderRail({ amount: '50000' });

    expect(screen.getByTestId('forecast-auto')).toHaveTextContent('Approved on submit');
    expect(screen.queryByTestId('forecast-unconfigured')).not.toBeInTheDocument();
  });

  it('dit que la prévision n’est pas la décision', () => {
    setThresholds([TWO_STEP]);
    renderRail({ amount: '4850000' });

    expect(screen.getByTestId('forecast-reserve')).toHaveTextContent(
      'Forecast only — the server resolves the final chain when you submit.',
    );
  });
});

// ── Total dérivé ─────────────────────────────────────────────────────────────
describe('ExpenseConsequenceRail — total dérivé', () => {
  it('le total engagé EST le montant saisi : la TVA est dedans, jamais ajoutée', () => {
    setThresholds([TWO_STEP]);
    renderRail({ amount: '4850000', vatAmount: '350000' });

    expect(screen.getByTestId('expense-total')).toHaveTextContent(formatCurrency(4_850_000));
    // Le piège : 4 850 000 + 350 000 = 5 200 000 n'engage rien.
    expect(screen.getByTestId('expense-total')).not.toHaveTextContent(formatCurrency(5_200_000));
  });

  it('le net hors TVA est dérivé, et le bloc se dit dérivé et en lecture seule', () => {
    setThresholds([TWO_STEP]);
    renderRail({ amount: '4850000', vatAmount: '350000' });

    const box = screen.getByTestId('expense-breakdown');
    expect(box).toHaveTextContent(formatCurrency(4_500_000));
    expect(box).toHaveTextContent(/Derived from Amount and VAT — read-only/i);
  });

  it('sans montant saisi, le total est un tiret et non un zéro', () => {
    setThresholds([TWO_STEP]);
    renderRail({ amount: '' });

    expect(screen.getByTestId('expense-total')).toHaveTextContent('—');
  });

  it('une TVA supérieure au montant ne fabrique pas un net négatif', () => {
    setThresholds([TWO_STEP]);
    renderRail({ amount: '100000', vatAmount: '150000' });

    expect(screen.getByTestId('expense-breakdown-vat-warning')).toBeInTheDocument();
    expect(screen.getByTestId('expense-breakdown')).not.toHaveTextContent(formatCurrency(-50_000));
  });
});

// ── Historique comparable ────────────────────────────────────────────────────
describe('ExpenseConsequenceRail — historique', () => {
  it('sans catégorie choisie, invite à en choisir une au lieu d’un bloc vide', () => {
    setThresholds([TWO_STEP]);
    renderRail({ categoryId: '', amount: '4850000' });

    expect(screen.getByTestId('expense-history-nocategory')).toBeInTheDocument();
    // …et la prévision porte alors sa réserve.
    expect(screen.getByTestId('forecast-caveat')).toHaveTextContent(/category rule can still override/i);
  });

  it('avec une catégorie neuve et aucun antécédent, le dit au lieu d’afficher un vide', () => {
    setThresholds([TWO_STEP]);
    renderRail({ categoryId: 'cat-1', amount: '4850000' });

    expect(screen.getByTestId('expense-history-empty')).toHaveTextContent(
      /No earlier expense in this category/i,
    );
  });
});
