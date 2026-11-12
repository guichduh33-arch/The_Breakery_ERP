import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupSupplierReference } from '../supplierReferenceLookup.js';
import type { SupplierReferenceRow } from '../supplierReferenceLookup.js';

interface Result { data: SupplierReferenceRow[] | null; error: { message: string } | null }

interface State { calls: { op: string; column: string; value: string }[]; byCode: Result; byName: Result }

const state = vi.hoisted(() => {
  const initial: State = { calls: [], byCode: { data: [], error: null }, byName: { data: [], error: null } };
  return initial;
});

// Le faux client n'expose QUE `eq` et `ilike` : un retour à `.or()` casserait le test.
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => { state.calls.push({ op: 'eq', column, value }); return Promise.resolve(state.byCode); },
        ilike: (column: string, value: string) => { state.calls.push({ op: 'ilike', column, value }); return Promise.resolve(state.byName); },
      }),
    }),
  },
}));

const ROW: SupplierReferenceRow = { id: 's1', code: 'AYU', name: 'Ayu, Warung (Bali)*', is_active: true, deleted_at: null };

beforeEach(() => {
  state.calls.length = 0;
  state.byCode = { data: [], error: null };
  state.byName = { data: [], error: null };
});

describe('lookupSupplierReference (S1-13)', () => {
  it('sends code and name as two simple filters, never an .or() string', async () => {
    await lookupSupplierReference({ code: 'AYU),(id.gt.*', name: 'Ayu, Warung (Bali)*' });
    expect(state.calls).toEqual([
      { op: 'eq', column: 'code', value: 'AYU),(id.gt.*' },
      { op: 'ilike', column: 'name', value: 'Ayu, Warung (Bali)*' },
    ]);
  });

  it('escapes the SQL wildcards of the name', async () => {
    await lookupSupplierReference({ code: 'X', name: '50%_off' });
    expect(state.calls[1]?.value).toBe('50\\%\\_off');
  });

  it('returns the union of both lookups once per supplier', async () => {
    state.byCode = { data: [ROW], error: null };
    state.byName = { data: [ROW], error: null };
    expect(await lookupSupplierReference({ code: 'AYU', name: ROW.name })).toEqual([ROW]);
  });

  it('surfaces a server error', async () => {
    state.byCode = { data: null, error: { message: 'boom' } };
    await expect(lookupSupplierReference({ code: 'A', name: 'B' })).rejects.toThrow('boom');
  });
});
