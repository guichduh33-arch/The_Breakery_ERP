import type { BankCatalog, BankDetail } from '../contracts.js';
export const fixtureRec = '11111111-1111-4111-8111-111111111111';
export const fixtureAccount = '22222222-2222-4222-8222-222222222222';
export const fixtureBank = '33333333-3333-4333-8333-333333333333';
export const fixtureGl = '44444444-4444-4444-8444-444444444444';
export const fixtureMatch = '55555555-5555-4555-8555-555555555555';
export const bankCatalogFixture: BankCatalog = {
  bank_accounts: [{ id: fixtureAccount,code: '1112',name: 'Operating bank',account_class: 1 }],
  clearing_accounts: [{ id: fixtureGl,code: '1116',name: 'Card clearing',account_class: 1 }],
  counter_accounts: [{ id: fixtureMatch,code: '6101',name: 'Bank charges',account_class: 6 }],
};
export const bankDetailFixture: BankDetail = {
  reconciliation: { id: fixtureRec,account_id: fixtureAccount,period_start: '2026-10-01',period_end: '2026-10-31',status: 'draft',opening_balance: '0.00',closing_balance: '1379998.62',snapshot_sha256: null,account_code: '1112',account_name: 'Operating bank',row_count: 1,matched_count: 0 },
  bank_lines: [{ id: fixtureBank,ordinal: 1,transaction_date: '2026-10-27',amount: '1379998.62',description: 'A supplier settlement with a long bank reference for the layout review',reference: 'BIFAST-EXAMPLE-001',match_id: null }],
  gl_lines: [{ id: fixtureGl,entry_date: '2026-10-27',entry_number: 'JE-20261027-0001',amount: '1379998.62',description: 'Posted transaction with a long descriptive source label',reference_type: 'b2b_payment',match_id: null,account_code: '1112' }],
  balances: { bank_opening: '0.00',bank_closing: '1379998.62',gl_opening: '0.00',gl_closing: '1379998.62',bank_total: '1379998.62' },
  matches: [],imports: [],entries: [],source_integrity: null,next_bank_after: null,next_gl_after: null,match_history_truncated: false,
};
