// apps/pos/src/features/cart/__tests__/void-confirm-and-hold-note.smoke.test.tsx
//
// Session 43 — Wave E (P2-1, P2-2):
//   P2-1 — the LOCAL void (cart not yet fired to the kitchen) no longer wipes
//          the cart on a single tap: a `role="alertdialog"` confirmation is
//          shown first. Confirm wipes; Cancel keeps the cart intact.
//          (The post-kitchen manager-PIN flow is untouched — see
//          void-order.smoke.test.tsx / void-post-kitchen.smoke.test.tsx.)
//   P2-2 — Hold no longer uses `window.prompt` for the optional note: a
//          proper modal with a textarea + Cancel/Hold buttons collects it,
//          then the existing hold mutation fires with the note.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const holdMutateAsync = vi.fn().mockResolvedValue('order-1');
vi.mock('@/features/heldOrders/hooks/useHoldOrder', () => ({
  useHoldOrder: () => ({ mutateAsync: holdMutateAsync, isPending: false }),
}));

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
    fireEvent.click(screen.getByRole('menuitem', { name: /void order/i }));
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

describe('P2-2 — hold note collected via modal, not window.prompt', () => {
  it('never calls window.prompt and opens a note modal with a textarea', () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    render(wrapper(<BottomActionBar />));

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /note/i })).toBeInTheDocument();
    expect(screen.getByTestId('hold-note-confirm')).toBeInTheDocument();
  });

  it('submits the hold mutation with the typed note', async () => {
    render(wrapper(<BottomActionBar />));

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
      target: { value: 'for Mr. Tan' },
    });
    fireEvent.click(screen.getByTestId('hold-note-confirm'));

    await waitFor(() => expect(holdMutateAsync).toHaveBeenCalled());
    const arg = holdMutateAsync.mock.calls[0]?.[0] as { notes: string | null };
    expect(arg.notes).toBe('for Mr. Tan');
    await waitFor(() => expect(useCartStore.getState().cart.items).toHaveLength(0));
  });

  it('an empty note submits as null', async () => {
    render(wrapper(<BottomActionBar />));

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.click(screen.getByTestId('hold-note-confirm'));

    await waitFor(() => expect(holdMutateAsync).toHaveBeenCalled());
    const arg = holdMutateAsync.mock.calls[0]?.[0] as { notes: string | null };
    expect(arg.notes).toBeNull();
  });
});
