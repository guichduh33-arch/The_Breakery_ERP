// ADR-022 déc. 4 — il n'y a plus de branchement « draft vs sent » : la voie
// brouillon (hold_order → restore_held_order) est supprimée, et la liste ne
// présente que des commandes envoyées en cuisine. Ce fichier vérifie donc
// l'inverse de ce qu'il vérifiait : que TOUTE ligne listée part en réouverture,
// et qu'aucun badge « Draft » ne subsiste.
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { reopenMutate } = vi.hoisted(() => ({
  reopenMutate: vi.fn().mockResolvedValue('order-5'),
}));

vi.mock('@/features/heldOrders/hooks/useHeldOrdersQuery', () => ({
  useHeldOrdersQuery: () => ({
    data: [
      { id: 'order-5', order_number: '#0005', table_number: '7', notes: null, total: 0, created_at: '2026-06-25T10:00:00Z', status: 'pending_payment', sent_to_kitchen_at: '2026-06-25T09:59:00Z' },
      { id: 'order-6', order_number: '#0006', table_number: null, notes: null, total: 50000, created_at: '2026-06-25T10:01:00Z', status: 'pending_payment', sent_to_kitchen_at: '2026-06-25T10:00:30Z' },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/features/heldOrders/hooks/useReopenHeldOrder', () => ({ useReopenHeldOrder: () => ({ mutateAsync: reopenMutate }) }));
vi.mock('@/features/heldOrders/hooks/useDiscardHeldOrder', () => ({ useDiscardHeldOrder: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@/features/heldOrders/hooks/useHeldOrdersRealtime', () => ({ useHeldOrdersRealtime: () => undefined }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HeldOrdersModal } from '@/features/cart/HeldOrdersModal';
import { useCartStore } from '@/stores/cartStore';

function wrap(n: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [], order_type: 'take_out' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: null, appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('HeldOrdersModal — toute commande en attente est une commande envoyée', () => {
  it('route une commande envoyée vers la réouverture', async () => {
    render(wrap(<HeldOrdersModal open onClose={vi.fn()} />));
    fireEvent.click(screen.getByRole('button', { name: /restore held order #0005/i }));
    await waitFor(() => expect(reopenMutate).toHaveBeenCalledWith('order-5'));
  });

  it('route AUSSI la seconde ligne vers la réouverture — il n’y a plus de voie brouillon', async () => {
    render(wrap(<HeldOrdersModal open onClose={vi.fn()} />));
    fireEvent.click(screen.getByRole('button', { name: /restore held order #0006/i }));
    await waitFor(() => expect(reopenMutate).toHaveBeenCalledWith('order-6'));
  });

  it('n’affiche que des badges « Sent », plus aucun « Draft »', () => {
    render(wrap(<HeldOrdersModal open onClose={vi.fn()} />));
    expect(screen.getAllByText(/^sent$/i)).toHaveLength(2);
    expect(screen.queryByText(/^draft$/i)).not.toBeInTheDocument();
  });
});
