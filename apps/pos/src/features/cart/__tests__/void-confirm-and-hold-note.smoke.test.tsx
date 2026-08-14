// apps/pos/src/features/cart/__tests__/void-confirm-and-hold-note.smoke.test.tsx
//
// Session 43 — Wave E (P2-1, P2-2):
//   P2-1 — the LOCAL void (cart not yet fired to the kitchen) no longer wipes
//          the cart on a single tap: a `role="alertdialog"` confirmation is
//          shown first. Confirm wipes; Cancel keeps the cart intact.
//          (The post-kitchen manager-PIN flow is untouched — see
//          void-order.smoke.test.tsx / void-post-kitchen.smoke.test.tsx.)
//   P2-2 — retiré : ADR-022 déc. 4 supprime le parcage de panier, donc la note
//          de hold qu'il collectait. Voir le describe en bas de fichier.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { setSession: vi.fn(), signOut: vi.fn().mockResolvedValue({}), getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
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

import { useCartStore } from '@/stores/cartStore';
import { BottomActionBar } from '../BottomActionBar';

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const ITEM = { id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [] as never[] };

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [ITEM], order_type: 'dine_in' },
    lockedItemIds: [],
    printedItemIds: [],
    appliedPromotions: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
  });
});

describe('Void — under More, always reason + manager PIN', () => {
  function openVoid(): void {
    fireEvent.click(screen.getByRole('button', { name: /^more$/i }));
    fireEvent.click(screen.getByRole('button', { name: /void order/i }));
  }

  it('opens a reason+PIN alertdialog and does NOT wipe the cart yet', () => {
    render(wrapper(<BottomActionBar />));
    openVoid();

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName();
    expect(screen.getByLabelText(/void reason/i)).toBeInTheDocument();
    // Cart intact until reason + PIN are satisfied.
    expect(useCartStore.getState().cart.items).toHaveLength(1);
  });

  it('Cancel keeps the cart and closes the dialog', () => {
    render(wrapper(<BottomActionBar />));
    openVoid();
    fireEvent.click(screen.getByTestId('void-modal-cancel'));

    expect(useCartStore.getState().cart.items).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

// ADR-022 déc. 4 — le bloc « P2-2 : note de hold collectée par modale » est
// retiré avec le parcage de panier : on ne met plus en attente qu'une commande
// déjà envoyée en cuisine, et ce geste-là ne collecte pas de note. Restent
// ci-dessus les smokes P2-1 sur la confirmation du void local, qui n'ont jamais
// eu de rapport avec le hold. Le bouton Hold est désormais désactivé tant que
// rien n'est parti en cuisine — voir rehold-fired-order.smoke.test.tsx.
describe('ADR-022 déc. 4 — le hold exige une commande envoyée en cuisine', () => {
  // Critique run 2 (2026-08-14 P2) — l'indisponible n'est plus `disabled` :
  // il reste tapable, porte aria-disabled et explique le parcours au tap.
  it('le bouton Hold est indisponible (aria-disabled) sur un panier non envoyé', () => {
    render(wrapper(<BottomActionBar />));

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByRole('button', { name: /^hold$/i })).toHaveAttribute('aria-disabled', 'true');
  });
});
