import { describe, expect, it } from 'vitest';
import { paymentJournalDetail } from '../paymentJournal';

// Cas réel du journal 2026-11-26 : T126112026068, 495 000 en trois règlements,
// journalisé « card » alors que 125 000 étaient en espèces.
describe('paymentJournalDetail', () => {
  it('lists every tender of a split, not only the first one', () => {
    expect(paymentJournalDetail([
      { method: 'card', amount: 60000 },
      { method: 'cash', amount: 125000, cash_received: 125000 },
      { method: 'card', amount: 310000 },
    ])).toEqual({
      split: [
        { method: 'card', amount: 60000 },
        { method: 'cash', amount: 125000 },
        { method: 'card', amount: 310000 },
      ],
    });
  });

  it('carries the amount left on a tab', () => {
    expect(paymentJournalDetail([], 580000)).toEqual({ split: [], outstanding_due: 580000 });
  });

  it('keeps a zero balance and omits the key when there is no tab', () => {
    expect(paymentJournalDetail([{ method: 'qris', amount: 50000 }], 0)).toHaveProperty('outstanding_due', 0);
    expect(paymentJournalDetail([{ method: 'qris', amount: 50000 }])).not.toHaveProperty('outstanding_due');
  });
});
