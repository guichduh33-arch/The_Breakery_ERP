// apps/pos/src/features/tablet/__tests__/TabletCartPanel.touch.test.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — the tablet cart quantity
// controls must be ≥48px touch targets (was 24px). Verifies the stepper and
// remove buttons carry the h-12/w-12 sizing.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { TabletCartPanel } from '../components/TabletCartPanel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
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

describe('TabletCartPanel — touch targets (LOT 6)', () => {
  beforeEach(() => {
    useTabletCartStore.setState({
      items: [
        { id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30_000, quantity: 2, modifiers: [] },
      ],
      tableNumber: 'T1',
      orderType: 'dine_in',
    });
  });

  it('renders quantity stepper and remove buttons at ≥48px (h-12/w-12)', () => {
    render(wrap(<TabletCartPanel />));

    const inc = screen.getByLabelText(/increase latte/i);
    const dec = screen.getByLabelText(/decrease latte/i);
    const rm = screen.getByLabelText(/remove latte/i);

    for (const btn of [inc, dec, rm]) {
      expect(btn.className).toContain('h-12');
      expect(btn.className).toContain('w-12');
      // The cramped 24px size must be gone.
      expect(btn.className).not.toContain('w-6');
    }
  });

  // Critique 2026-08-24 — le « − » à quantité 1 n'est plus désactivé : il
  // retire l'article, comme le pouce s'y attend. Son nom accessible est
  // DISTINCT du × de tête (`Remove last` vs `Remove`) — deux boutons au même
  // nom sur une ligne étaient indistinguables au lecteur d'écran (review).
  it('the − at quantity 1 removes the item instead of being disabled', () => {
    useTabletCartStore.setState({
      items: [
        { id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
      ],
      tableNumber: 'T1',
      orderType: 'dine_in',
    });
    render(wrap(<TabletCartPanel />));

    const stepperRemove = screen.getByLabelText('Remove last Latte');
    expect(screen.getByLabelText('Remove Latte')).not.toBeDisabled(); // le × de tête
    expect(stepperRemove).not.toBeDisabled();

    fireEvent.click(stepperRemove);
    expect(useTabletCartStore.getState().items).toHaveLength(0);
  });
});
