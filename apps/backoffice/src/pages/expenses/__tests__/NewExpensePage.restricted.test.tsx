// apps/backoffice/src/pages/expenses/__tests__/NewExpensePage.restricted.test.tsx
//
// Lot 4 / tâche B — l'état « pas le droit de créer une dépense ».
//
// Avant : `<div className="text-text-secondary">You do not have permission to
// create expenses.</div>` — une ligne de gris nue. Pas de titre, pas de fil
// d'Ariane, pas de retour : l'utilisateur ne savait plus où il était, et sa
// seule issue était le bouton Retour du navigateur.
//
// Fichier séparé du smoke existant : celui-ci fige `hasPermission: () => true`
// dans son `vi.mock`, qui est hissé au sommet du module et ne se repique pas
// par test.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NewExpensePage from '@/pages/expenses/NewExpensePage.js';

vi.mock('@/features/expenses/hooks/useCreateExpense.js', () => ({
  useCreateExpense: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => false }),
}));

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/expenses/new']}>
        <Routes>
          <Route path="/backoffice/expenses/new" element={<NewExpensePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NewExpensePage — droit de création manquant', () => {
  // Lot 8 — la sortie est le fil d'Ariane, et lui seul. La page rendait AUSSI
  // un « ← Back to expenses » : deux vocabulaires pour le même geste sur le
  // même écran, quand l'ossature commune (DESIGN.md) ne déclare qu'un fil
  // d'Ariane.
  it('garde le fil d’Ariane, le titre et une sortie', () => {
    renderPage();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New expense');
    expect(screen.getByRole('link', { name: 'Expenses' })).toHaveAttribute(
      'href',
      '/backoffice/expenses',
    );
    expect(screen.queryByRole('link', { name: /back to expenses/i })).not.toBeInTheDocument();
  });

  it('nomme la permission manquante au lieu d’une ligne de gris nue', () => {
    renderPage();
    const restricted = screen.getByRole('status');
    expect(restricted).toHaveTextContent('Access to creating expenses is restricted.');
    expect(restricted).toHaveTextContent('expenses.create');
  });

  it('ne rend pas le formulaire', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /save as draft/i })).not.toBeInTheDocument();
  });
});
