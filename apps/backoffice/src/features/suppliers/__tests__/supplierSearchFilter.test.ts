import { describe, expect, it } from 'vitest';
import { supplierSearchFilter } from '../hooks/useSuppliersList.js';

describe('supplierSearchFilter (S1-13)', () => {
  it('keeps a hostile search inside the name/code terms', () => {
    const filter = supplierSearchFilter('cgs%,is_active.eq.false),(id.gt.*');
    expect(filter).toBe('name.ilike.%cgsisactive.eq.falseid.gt.%,code.ilike.%cgsisactive.eq.falseid.gt.%');
    expect(filter?.split(',')).toHaveLength(2);
  });

  it('poses no filter for an empty search', () => {
    expect(supplierSearchFilter('   ')).toBeNull();
  });
});
