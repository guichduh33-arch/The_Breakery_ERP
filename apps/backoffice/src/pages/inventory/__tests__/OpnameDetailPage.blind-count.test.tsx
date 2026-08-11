// apps/backoffice/src/pages/inventory/__tests__/OpnameDetailPage.blind-count.test.tsx
//
// Comptage à l'aveugle en deux paliers. Ces tests figent le SENS des deux
// phases, pas leur mise en page :
//   - pendant le comptage, rien de l'attendu ne doit être à l'écran ;
//   - à la revue, tout est révélé ET la saisie est figée ;
//   - Valider passe par une confirmation, parce qu'il n'y a pas de retour ;
//   - Annuler reste offert en revue, seul recours contre une faute de frappe ;
//   - Finaliser n'est offert qu'à un porteur de `inventory.opname.finalize`
//     (ADMIN / SUPER_ADMIN en base — un MANAGER compte mais ne finalise pas).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpnameDetailPage from '@/pages/inventory/OpnameDetailPage.js';
import type { OpnameDetail } from '@/features/inventory-opname/hooks/useOpnameDetail.js';
import type { OpnameStatus } from '@/features/inventory-opname/hooks/useOpnameList.js';

function makeDetail(status: OpnameStatus): OpnameDetail {
  return {
    id:            'op-1',
    count_number:  'OPN-2026-0001',
    section_id:    's-1',
    status,
    started_at:    '2026-08-10T02:00:00Z',
    finalized_at:  null,
    cancelled_at:  null,
    cancel_reason: null,
    notes:         null,
    section:       { code: 'KIT', name: 'Kitchen' },
    items: [
      {
        id: 'it-1', product_id: 'p-1',
        expected_qty: 12, counted_qty: 9, variance: -3,
        unit: 'kg', notes: null, movement_id: null,
        product: { sku: 'RAW-001', name: 'White Flour' },
      },
    ],
  };
}

let detail: OpnameDetail = makeDetail('counting');
vi.mock('@/features/inventory-opname/hooks/useOpnameDetail.js', () => ({
  useOpnameDetail: () => ({ data: detail, isLoading: false, error: null }),
}));

const validateMutate = vi.fn();
vi.mock('@/features/inventory-opname/hooks/useOpnameMutations.js', () => ({
  useValidateOpname:  () => ({ mutate: validateMutate, isPending: false }),
  useSetOpnameCount:  () => ({ mutate: vi.fn(), isPending: false }),
  useFinalizeOpname:  () => ({ mutate: vi.fn(), isPending: false }),
  useCancelOpname:    () => ({ mutate: vi.fn(), isPending: false }),
  useAddOpnameItem:   () => ({ mutate: vi.fn(), isPending: false }),
}));

// AddItemForm tire ProductTypeahead → supabase : on le remplace par un marqueur,
// ce qui suffit à tester sa présence ou son absence.
vi.mock('@/features/inventory-opname/components/AddItemForm.js', () => ({
  AddItemForm: () => <div data-testid="add-item-form" />,
}));

let currentPerms = new Set<string>();
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/inventory/opname/op-1']}>
        <Routes>
          <Route path="/backoffice/inventory/opname/:id" element={<OpnameDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpnameDetailPage — comptage à l\'aveugle', () => {
  beforeEach(() => {
    validateMutate.mockReset();
    currentPerms = new Set(['inventory.read', 'inventory.opname.create', 'inventory.opname.finalize']);
    detail = makeDetail('counting');
  });

  it('pendant le comptage, ne montre ni attendu, ni écart, ni total des écarts', () => {
    renderPage();

    expect(screen.queryByText('Expected')).not.toBeInTheDocument();
    expect(screen.queryByText('Variance')).not.toBeInTheDocument();
    expect(screen.queryByText(/Total \|variance\|/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('cell-expected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cell-variance')).not.toBeInTheDocument();
    // La valeur attendue ne doit pas non plus fuir par un autre chemin.
    expect(screen.queryByText(/12 kg/)).not.toBeInTheDocument();

    expect(screen.getByTestId('blind-count-notice')).toBeInTheDocument();
    expect(screen.getByLabelText('Counted quantity for White Flour')).toBeInTheDocument();
  });

  it('à la revue, révèle tout et fige la saisie', () => {
    detail = makeDetail('review');
    renderPage();

    expect(screen.getByTestId('cell-expected')).toHaveTextContent('12 kg');
    expect(screen.getByTestId('cell-variance')).toHaveTextContent('-3');
    expect(screen.getByText(/Total \|variance\|/i)).toBeInTheDocument();
    expect(screen.queryByTestId('blind-count-notice')).not.toBeInTheDocument();

    expect(screen.queryByLabelText('Counted quantity for White Flour')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-item-form')).not.toBeInTheDocument();
  });

  it('laisse Annuler accessible en revue — seul recours après la révélation', () => {
    detail = makeDetail('review');
    renderPage();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('ne valide qu\'après confirmation, en annonçant qu\'il n\'y a pas de retour', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Validate & reveal variances/i }));
    expect(validateMutate).not.toHaveBeenCalled();

    expect(screen.getByText(/no way back to counting/i)).toBeInTheDocument();
    expect(screen.getByText(/cancel this count and recount/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-validate'));
    expect(validateMutate).toHaveBeenCalledTimes(1);
    expect(validateMutate.mock.calls[0]?.[0]).toEqual({ countId: 'op-1' });
  });

  it('n\'offre pas Finaliser sans la permission — un MANAGER compte, il ne finalise pas', () => {
    currentPerms = new Set(['inventory.read', 'inventory.opname.create']);
    renderPage();

    expect(screen.queryByRole('button', { name: /Finalize/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Validate & reveal variances/i })).toBeInTheDocument();
  });

  it('une fois finalisé, plus de saisie et plus d\'annulation', () => {
    detail = makeDetail('finalized');
    renderPage();

    expect(screen.getByTestId('cell-expected')).toBeInTheDocument();
    expect(screen.queryByLabelText('Counted quantity for White Flour')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument();
  });
});
