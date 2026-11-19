import { describe, expect, it } from 'vitest';
import type { BankLine, GlLine } from '../contracts.js';
import { proposeSettlements, proposeTransferFees, rateBp, selectionVerdict, standaloneFeeLines, type ClearingDay } from '../groupSuggestions.js';

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const bank = (n: number, date: string, amount: string, description = '"DR 0000029511812 KR 1610016244977 "'): BankLine =>
  ({ id: uuid(n), ordinal: n, transaction_date: date, amount, description, reference: '', match_id: null });
const day = (n: number, date: string, code: string, gross: string): ClearingDay =>
  ({ entry_date: date, account_id: uuid(900 + Number(code)), account_code: code, account_name: code, line_count: 3, gross, line_ids: [uuid(500 + n)] });
const gl = (n: number, date: string, amount: string): GlLine =>
  ({ id: uuid(700 + n), entry_date: date, entry_number: `JE-${n}`, amount, description: 'Supplier payment', reference_type: 'purchase_payment', match_id: null, account_code: '1112' });

// Chiffres réels du relevé Mandiri d'octobre 2026 : versements du 02/10 pour les ventes du 01/10.
describe('card / QRIS payout proposals', () => {
  const days = [day(1, '2026-10-01', '1115', '3843000.00'), day(2, '2026-10-01', '1116', '7014000.00'),
    day(3, '2026-10-02', '1115', '2803000.00'), day(4, '2026-10-02', '1116', '5887000.00')];
  it('pairs each payout with the sales day it nets, and computes the fee and rate', () => {
    const result = proposeSettlements([bank(5, '2026-10-02', '3820390.00'), bank(6, '2026-10-02', '6911790.00'),
      bank(11, '2026-10-03', '2786921.00'), bank(12, '2026-10-03', '5804446.00')], days);
    expect(result.map((r) => [r.bankLine.ordinal, r.day.entry_date, r.day.account_code, r.fee])).toEqual([
      [5, '2026-10-01', '1115', '22610.00'], [6, '2026-10-01', '1116', '102210.00'],
      [11, '2026-10-02', '1115', '16079.00'], [12, '2026-10-02', '1116', '82554.00']]);
    expect(result[1]!.rateBasisPoints).toBe(146);
  });
  it('never uses a sales day twice, nor proposes a fee above 5% or a payout before the sale', () => {
    const result = proposeSettlements([bank(1, '2026-10-02', '3820390.00'), bank(2, '2026-10-02', '3820000.00'),
      bank(3, '2026-10-02', '3000000.00'), bank(4, '2026-09-30', '2800000.00')], [days[0]!]);
    expect(result).toHaveLength(1);
    expect(result[0]!.bankLine.ordinal).toBe(1);
  });
  it('ignores matched lines, outgoing lines and days too large to settle in one entry', () => {
    const matched = { ...bank(1, '2026-10-02', '3820390.00'), match_id: uuid(99) };
    expect(proposeSettlements([matched, bank(2, '2026-10-02', '-3820390.00')], days)).toEqual([]);
    expect(proposeSettlements([bank(3, '2026-10-02', '3820390.00')], [{ ...days[0]!, line_ids: null }])).toEqual([]);
  });
});

describe('transfer fee proposals', () => {
  const lines = [bank(18, '2026-10-04', '-1100000.00', '"BRINIDJA/RIAMAN INVOICE 24 AND 28 SE"'), bank(19, '2026-10-04', '-2500.00', '""'),
    bank(20, '2026-10-04', '-329000.00', '"CENAIDJA/ZULHARMAN INVOICE"'), bank(21, '2026-10-04', '-2500.00', '""')];
  it('groups a transfer with the fee line that follows it and its single ledger payment', () => {
    const result = proposeTransferFees(lines, [gl(1, '2026-10-03', '-1100000.00'), gl(2, '2026-10-04', '-329000.00')]);
    expect(result.map((r) => [r.payment.ordinal, r.feeLine.ordinal, r.gl.entry_number, r.fee])).toEqual([[18, 19, 'JE-1', '2500.00'], [20, 21, 'JE-2', '2500.00']]);
  });
  it('stays silent when the ledger payment is ambiguous or missing', () => {
    expect(proposeTransferFees(lines.slice(0, 2), [gl(1, '2026-10-03', '-1100000.00'), gl(2, '2026-10-04', '-1100000.00')])).toEqual([]);
    expect(proposeTransferFees(lines.slice(0, 2), [])).toEqual([]);
  });
  it('leaves standalone charges for one grouped bank charges entry', () => {
    const transfers = proposeTransferFees(lines, [gl(1, '2026-10-03', '-1100000.00')]);
    const left = standaloneFeeLines(lines, [], new Set(transfers.flatMap((t) => [t.payment.id, t.feeLine.id])));
    expect(left.map((l) => l.ordinal)).toEqual([21]);
    expect(standaloneFeeLines([bank(1, '2026-10-04', '-60000.00', '""'), bank(2, '2026-10-04', '-6000.00', '"Supplier refund"')], [], new Set())).toEqual([]);
  });
  it('never counts a small payment that waits in the ledger as a bank charge', () => {
    const small = bank(1, '2026-10-04', '-25000.00', '""');
    expect(standaloneFeeLines([small], [gl(9, '2026-10-04', '-25000.00')], new Set())).toEqual([]);
  });
  it('survives ordinal gaps and newest-first exports, but not a fee on another day', () => {
    const gap = [bank(40, '2026-10-04', '-329000.00', '"X"'), bank(57, '2026-10-04', '-2500.00', '""')];
    expect(proposeTransferFees(gap, [gl(2, '2026-10-04', '-329000.00')])).toHaveLength(1);
    const reversed = [bank(1, '2026-10-04', '-2500.00', '""'), bank(2, '2026-10-04', '-329000.00', '"X"')];
    expect(proposeTransferFees(reversed, [gl(2, '2026-10-04', '-329000.00')]).map((r) => r.feeLine.ordinal)).toEqual([1]);
    const otherDay = [bank(1, '2026-10-04', '-329000.00', '"X"'), bank(2, '2026-10-05', '-2500.00', '""')];
    expect(proposeTransferFees(otherDay, [gl(2, '2026-10-04', '-329000.00')])).toEqual([]);
  });
});

describe('payout ambiguity', () => {
  it('flags a payout that fits more than one sales day', () => {
    const [result] = proposeSettlements([bank(1, '2026-10-03', '990000.00')],
      [day(1, '2026-10-01', '1115', '1000000.00'), day(2, '2026-10-02', '1115', '1010000.00')]);
    expect(result!.day.entry_date).toBe('2026-10-02');
    expect(result!.ambiguous).toBe(true);
  });
});

describe('manual selection verdict', () => {
  it('recognises exact matches, fees on receipts and on transfers, and mismatches', () => {
    expect(selectionVerdict(100n, 100n, 1, 1)).toEqual({ kind: 'exact' });
    expect(selectionVerdict(9_800_000n, 10_000_000n, 1, 1)).toEqual({ kind: 'fee', fee: '2000.00' });
    expect(selectionVerdict(-33_150_000n, -32_900_000n, 2, 1)).toEqual({ kind: 'fee', fee: '2500.00' });
    expect(selectionVerdict(10_000_100n, 10_000_000n, 1, 1)).toEqual({ kind: 'mismatch', difference: '1.00' });
    expect(selectionVerdict(-100n, 100n, 1, 1).kind).toBe('mismatch');
    expect(selectionVerdict(100n, 0n, 1, 0)).toEqual({ kind: 'empty' });
  });
  it('rounds the rate in basis points', () => { expect(rateBp(102_210n, 7_014_000n)).toBe(146); expect(rateBp(1n, 0n)).toBe(0); });
});
