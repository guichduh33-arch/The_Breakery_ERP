// apps/backoffice/src/features/categories/__tests__/CategoryFormDialog.smoke.test.tsx
//
// S75 (task 7) — no existing suite covered CategoryFormDialog, so this file
// is added to guard the KDS station select. The previous KDS_STATIONS list
// ('kitchen'/'pastry'/'bakery') violated the DB CHECK on
// categories.kds_station (hot|cold|bar|prep|expo — migration
// 20260517000150_add_categories_kds_station.sql) — a latent bug: any save
// with one of those values would have been rejected by Postgres. This test
// asserts the select now renders exactly the 5 CHECK-valid options.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryFormDialog } from '../components/CategoryFormDialog.js';

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

function renderDialog() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CategoryFormDialog mode="create" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('CategoryFormDialog — smoke (S75 task 7)', () => {
  it('renders exactly the 5 CHECK-valid KDS station options', () => {
    renderDialog();

    const select = screen.getByLabelText(/kds station/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => ({ value: o.value, label: o.text }));

    expect(options).toEqual([
      { value: 'hot',  label: 'Hot kitchen' },
      { value: 'cold', label: 'Cold prep' },
      { value: 'bar',  label: 'Bar' },
      { value: 'prep', label: 'Prep / Bakery' },
      { value: 'expo', label: 'Expo / Pickup' },
    ]);

    // None of the old invalid values ('kitchen'/'pastry'/'bakery' — which
    // collide in spelling with dispatch_station's own vocabulary) survive.
    expect(options.some((o) => o.value === 'kitchen')).toBe(false);
    expect(options.some((o) => o.value === 'pastry')).toBe(false);
    expect(options.some((o) => o.value === 'bakery')).toBe(false);
  });

  it('defaults the KDS station select to "expo" on create', () => {
    renderDialog();
    const select = screen.getByLabelText(/kds station/i) as HTMLSelectElement;
    expect(select.value).toBe('expo');
  });
});
