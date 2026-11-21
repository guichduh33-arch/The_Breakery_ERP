// apps/backoffice/src/__tests__/promotions-list.smoke.test.tsx
//
// Session 14 / Phase 5.B — smoke for the rebuilt PromotionsPage.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PromotionsPage from '@/pages/Promotions.js';

vi.mock('@/lib/supabase.js', () => {
  const promotions = [
    { id: 'p1', name: 'Spring 10%',  slug: 'spring-10', type: 'percentage',
      scope: null, priority: 50, is_active: true,  start_at: null, end_at: null,
      created_at: '2026-01-01T00:00:00Z' },
    { id: 'p2', name: 'BOGO Croissant', slug: 'bogo-croissant', type: 'bogo',
      scope: null, priority: 70, is_active: false, start_at: null, end_at: null,
      created_at: '2026-01-01T00:00:00Z' },
    { id: 'p3', name: 'Free coffee with cake', slug: 'free-coffee', type: 'free_product',
      scope: null, priority: 60, is_active: true,  start_at: null, end_at: null,
      created_at: '2026-01-01T00:00:00Z' },
  ];
  type Resolver = (v: unknown) => void;
  const builder: Record<string, unknown> = {
    select:  () => builder,
    is:      () => builder,
    eq:      () => builder,
    gte:     () => builder,
    lte:     () => builder,
    order:   () => builder,
    limit:   () => builder,
    range:   () => builder,
    in:      () => builder,
    or:      () => builder,
    then:    (resolve: Resolver) => resolve({ data: promotions, error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      rpc:  () => Promise.resolve({ data: null, error: null }),
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        ['promotions.read', 'promotions.create', 'promotions.update', 'promotions.delete'].includes(p),
    }),
}));

// Interrupteur : le résultat se dit (audit Sales 2026-11-21). Le hook est
// remplacé pour piloter le succès ou l'échec sans base.
const toggle = vi.hoisted(() => ({ fail: false, calls: [] as unknown[] }));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastSpy }));
vi.mock('@/features/promotions/hooks/useUpdatePromotion.js', () => ({
  useUpdatePromotion: () => ({
    isPending: false,
    variables: undefined,
    mutate: (input: unknown, opts?: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
      toggle.calls.push(input);
      if (toggle.fail) opts?.onError?.(new Error('permission denied'));
      else opts?.onSuccess?.();
    },
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PromotionsPage />
    </QueryClientProvider>,
  );
}

describe('PromotionsPage', () => {
  it('renders header, KPI tiles and table rows', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /promotions/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/total promotions/i)).toBeInTheDocument();
    // Audit Sales 2026-11-21 : la tuile compte sur la fenêtre de dates.
    expect(screen.getByText(/live now/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Spring 10%')).toBeInTheDocument());
    expect(screen.getByText('BOGO Croissant')).toBeInTheDocument();
  });

  it('shows + New promotion button when permitted', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /new promotion/i })).toBeInTheDocument();
  });
  it('says when a promotion toggle fails, instead of failing silently', async () => {
    toggle.fail = true;
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: /toggle bogo croissant active/i }));
    // L'activation passe par la confirmation (décision 2026-11-21).
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(toastSpy.error).toHaveBeenCalledWith('BOGO Croissant could not be activated: permission denied');
  });

  it('confirms the activation', async () => {
    toggle.fail = false;
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: /toggle bogo croissant active/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(toggle.calls.at(-1)).toEqual({ id: 'p2', values: { is_active: true } });
    expect(toastSpy.success).toHaveBeenCalledWith('BOGO Croissant is now active.');
  });
});
