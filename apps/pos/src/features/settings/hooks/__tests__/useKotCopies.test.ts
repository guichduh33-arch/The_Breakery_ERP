// apps/pos/src/features/settings/hooks/__tests__/useKotCopies.test.ts
//
// S1-22 — lecture des copies d'impression. Sur une base sans la colonne
// kot_copies_waiter (POS livré avant la migration), PostgREST refuse toute la
// lecture : le repli doit garder les copies réglées par poste, et le ticket
// serveur garde son exemplaire unique historique.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const { selects, responses } = vi.hoisted(() => ({
  selects: [] as string[],
  responses: [] as { data: unknown; error: { message: string } | null }[],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => {
        selects.push(columns);
        return { limit: () => ({ maybeSingle: () => Promise.resolve(responses.shift()) }) };
      },
    }),
  },
}));

import { getKotCopies } from '../useKotCopies';

describe('getKotCopies', () => {
  beforeEach(() => {
    selects.length = 0;
    responses.length = 0;
  });

  it('reads the four copy settings, waiter included', async () => {
    responses.push({ data: { kot_copies_barista: 0, kot_copies_kitchen: 2, kot_copies_display: 1, kot_copies_waiter: 3 }, error: null });
    expect(await getKotCopies(new QueryClient())).toEqual({ barista: 0, kitchen: 2, display: 1, waiter: 3 });
    expect(selects).toHaveLength(1);
  });

  it('keeps the per-station copies when the database has no waiter column yet', async () => {
    responses.push({ data: null, error: { message: 'column business_config.kot_copies_waiter does not exist' } });
    responses.push({ data: { kot_copies_barista: 0, kot_copies_kitchen: 2, kot_copies_display: 1 }, error: null });
    expect(await getKotCopies(new QueryClient())).toEqual({ barista: 0, kitchen: 2, display: 1, waiter: 1 });
    expect(selects[1]).not.toContain('kot_copies_waiter');
  });

  it('falls back to one copy everywhere when the configuration cannot be read at all', async () => {
    responses.push({ data: null, error: { message: 'network' } });
    responses.push({ data: null, error: { message: 'network' } });
    expect(await getKotCopies(new QueryClient())).toEqual({ barista: 1, kitchen: 1, display: 1, waiter: 1 });
  });
});
