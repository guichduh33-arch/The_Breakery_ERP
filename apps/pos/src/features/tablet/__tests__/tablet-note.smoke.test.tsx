// apps/pos/src/features/tablet/__tests__/tablet-note.smoke.test.tsx
//
// Session 59 (17 D1.1) — order-level note wiring: typing in the
// TabletCartPanel note textarea updates tabletCartStore, and sending the
// order forwards it as p_notes to create_tablet_order_v7.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';
import { TabletCartPanel } from '../components/TabletCartPanel';
import { TabletOrderPage } from '../TabletOrderPage';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

// La saisie de la note reste testée sur le panneau (c'est lui qui la porte),
// mais l'ENVOI est passé à la page lors de la consolidation des deux écrans :
// les deux derniers cas rendent donc la page, grille produits stubbée.
vi.mock('../components/TabletMenuView', () => ({
  TabletMenuView: ({ toolbar }: { toolbar?: ReactNode }) => <div>{toolbar}</div>,
}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn().mockResolvedValue({ data: 'order-uuid', error: null }),
}));

// La page monte la sélection de table (tables + occupation realtime) : le mock
// doit couvrir `from`/`channel`, pas seulement `rpc`.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        })),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

function wrap(node: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('tablet order note — textarea → store → create_tablet_order_v7', () => {
  beforeEach(() => {
    mocks.rpc.mockClear();
    useTabletCartStore.setState({
      items: [
        { id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
      ],
      tableNumber: 'T1',
      orderType: 'dine_in',
      notes: null,
    });
    useAuthStore.setState({
      user: { id: 'waiter-001', full_name: 'Waiter Demo', role_code: 'waiter', employee_code: 'EMP002' },
      permissions: ['sales.create'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
    });
  });

  it('typing in the note textarea updates tabletCartStore.notes', () => {
    render(wrap(<TabletCartPanel />));
    const textarea = screen.getByLabelText(/note for kitchen/i);
    fireEvent.change(textarea, { target: { value: 'No gluten — nut allergy' } });
    expect(useTabletCartStore.getState().notes).toBe('No gluten — nut allergy');
  });

  it('clearing the textarea resets notes to null (not an empty string)', () => {
    useTabletCartStore.setState({ notes: 'draft note' });
    render(wrap(<TabletCartPanel />));
    const textarea = screen.getByLabelText(/note for kitchen/i);
    fireEvent.change(textarea, { target: { value: '' } });
    expect(useTabletCartStore.getState().notes).toBeNull();
  });

  it('forwards the note as p_notes when the order is sent', async () => {
    render(wrap(<TabletOrderPage />));
    fireEvent.change(screen.getByLabelText(/note for kitchen/i), {
      target: { value: 'No gluten — nut allergy' },
    });

    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        'create_tablet_order_v7',
        expect.objectContaining({ p_notes: 'No gluten — nut allergy' }),
      );
    });
  });

  it('omits p_notes entirely (server DEFAULT NULL applies) when no note was entered', async () => {
    render(wrap(<TabletOrderPage />));
    fireEvent.click(screen.getByRole('button', { name: /send to kitchen/i }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalled();
    });
    const callArgs = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('p_notes' in callArgs).toBe(false);
  });
});
