import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Les trois doublures étaient typées `any` et pesaient six erreurs de lint
// PRÉEXISTANTES. Le ratchet ne lint que les fichiers CHANGÉS par la PR : ajouter
// un test ici y fait entrer le fichier entier et réveille ces six-là (CLAUDE.md
// § Commandes). Elles sont donc closes en même temps, par des types réels.
const rpc = vi.fn();
interface Children { children: React.ReactNode }
interface AuthSlice { hasPermission: () => boolean }

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...a: unknown[]): unknown => rpc(...a) },
}));
vi.mock('@/components/PermissionGate.js', () => ({
  default:        ({ children }: Children) => <>{children}</>,
  PermissionGate: ({ children }: Children) => <>{children}</>,
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: <T,>(sel: (s: AuthSlice) => T): T => sel({ hasPermission: () => true }),
}));

import CashTreasuryPage from '../pages/CashTreasuryPage.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('CashTreasuryPage', () => {
  beforeEach(() => rpc.mockReset());

  it('renders the three wallet cards from balances', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'get_cash_wallet_balances_v2') return Promise.resolve({ data: [
        { account_code: '1110', account_name: 'Cash on Hand', balance: 6453000 },
        { account_code: '1111', account_name: 'Petty Cash',  balance: 47200 },
        { account_code: '1117', account_name: 'Small Money', balance: 4000000 },
      ], error: null });
      return Promise.resolve({ data: [], error: null });
    });

    render(<CashTreasuryPage />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Undeposited/i)).toBeInTheDocument());
    expect(screen.getByText(/Petty Cash/i)).toBeInTheDocument();
    expect(screen.getByText(/Small Money/i)).toBeInTheDocument();
  });

  // Critique du 2026-08-26 — « Petty Cash -Rp 14.000.000 » se rendait exactement
  // comme un coffre sain, alors que la tuile équivalente du tableau de bord dit
  // déjà « overdrawn » en danger. Le MOT est le signal qu'on épingle : la
  // couleur n'est jamais seule (WCAG 1.4.1) et un test ne la voit pas.
  it('names an overdrawn wallet, and only that one', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'get_cash_wallet_balances_v2') return Promise.resolve({ data: [
        { account_code: '1110', account_name: 'Cash on Hand', balance: 6453000 },
        { account_code: '1111', account_name: 'Petty Cash',  balance: -14000000 },
        { account_code: '1117', account_name: 'Small Money', balance: 4000000 },
      ], error: null });
      return Promise.resolve({ data: [], error: null });
    });

    render(<CashTreasuryPage />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Petty Cash/i)).toBeInTheDocument());
    expect(screen.getAllByTestId('wallet-overdrawn')).toHaveLength(1);
    expect(screen.getByTestId('wallet-overdrawn')).toHaveTextContent('Overdrawn');
  });
});
