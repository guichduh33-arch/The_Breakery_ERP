import { describe, expect, it } from 'vitest';
import { expenseSearchFilter } from '../hooks/useExpensesList.js';

describe('expenseSearchFilter (S1-13)', () => {
  it('keeps a hostile search inside the four searched columns', () => {
    const filter = expenseSearchFilter('gas,status.eq.paid),(amount.gt.*');
    expect(filter?.split(',')).toEqual([
      'description.ilike.%gasstatus.eq.paidamount.gt.%',
      'vendor_name.ilike.%gasstatus.eq.paidamount.gt.%',
      'remarks.ilike.%gasstatus.eq.paidamount.gt.%',
      'expense_number.ilike.%gasstatus.eq.paidamount.gt.%',
    ]);
  });

  it('poses no filter when only metacharacters are typed', () => {
    expect(expenseSearchFilter(',)*')).toBeNull();
  });
});
