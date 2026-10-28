import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { deferred, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { bankCatalogFixture, bankDetailFixture } from './fixtures.js';
import type { StatementFile } from '../statementParser.js';
import type * as ParserModule from '../statementParser.js';
const mocks = vi.hoisted(() => ({ read: vi.fn<() => Promise<StatementFile>>(),preview: vi.fn<(...args: unknown[]) => Promise<{ count: number; total: string; warnings: unknown[]; alreadyImported: boolean; balanceCheck: string }>>() }));
vi.mock('@/stores/authStore.js',async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
vi.mock('../statementParser.js',async () => ({ ...await vi.importActual<typeof ParserModule>('../statementParser.js'),readStatement: mocks.read }));
vi.mock('../api.js',() => ({ previewBankImport: mocks.preview }));
import { BankImportDialog } from '../BankImportDialog.js';
const file: StatementFile = { name: 'source.csv',sha256: 'a'.repeat(64),sheets: [{ name: 'Transactions',date1904: false,formulas: [],rows: [['Date','Description','Amount'],['2026-10-27','Exact bank receipt','1379998.62']] }] };
async function fill() {
  fireEvent.change(screen.getByLabelText('Bank account'),{ target: { value: bankCatalogFixture.bank_accounts[0]!.id } });
  fireEvent.change(screen.getByLabelText('Period start'),{ target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Period end'),{ target: { value: '2026-10-31' } });
  fireEvent.change(screen.getByLabelText('Statement file'),{ target: { files: [new File(['fictitious'],'source.csv')] } });
  await screen.findByLabelText('Transaction date');
  fireEvent.change(screen.getByLabelText('Transaction date'),{ target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Description'),{ target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Signed amount'),{ target: { value: '2' } });
}
describe('bank statement import UI',() => {
  beforeEach(() => { resetFinancialSession(); mocks.read.mockResolvedValue(file); mocks.preview.mockReset(); });
  it('requires server preview and preserves unavailable balances as null',async () => {
    const ready = vi.fn(); mocks.preview.mockResolvedValue({ count: 1,total: '1379998.62',warnings: [],alreadyImported: false,balanceCheck: 'Unavailable' });
    render(<BankImportDialog accounts={bankCatalogFixture.bank_accounts} onClose={() => undefined} onReady={ready} />);
    await fill(); expect(screen.queryByRole('button',{ name: 'Continue to confirmation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{ name: 'Validate preview' }));
    fireEvent.click(await screen.findByRole('button',{ name: 'Continue to confirmation' }));
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ source_sha256: file.sha256,opening_balance: null,closing_balance: null,rows: [expect.objectContaining({ amount: '1379998.62',source_row: 2 })] }));
  });
  it.each([
    { opening: '100.00',closing: '1379998.62' },
    { opening: null,closing: null },
  ])('preserves existing canonical balances $opening / $closing with comma-format rows',async ({ opening,closing }) => {
    const ready = vi.fn();
    const existing = { ...bankDetailFixture.reconciliation,opening_balance: opening,closing_balance: closing };
    mocks.read.mockResolvedValue({ ...file,sheets: [{ ...file.sheets[0]!,rows: [['Date','Description','Amount'],['2026-10-27','Exact bank receipt','1.379.998,62']] }] });
    mocks.preview.mockResolvedValue({ count: 1,total: '1379998.62',warnings: [],alreadyImported: false,balanceCheck: 'Unavailable' });
    render(<BankImportDialog accounts={bankCatalogFixture.bank_accounts} existing={existing} onClose={() => undefined} onReady={ready} />);
    fireEvent.change(screen.getByLabelText('Statement file'),{ target: { files: [new File(['fictitious'],'source.csv')] } });
    await screen.findByLabelText('Transaction date');
    fireEvent.change(screen.getByLabelText('Transaction date'),{ target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Description'),{ target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Signed amount'),{ target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Number format'),{ target: { value: 'comma' } });
    expect(screen.getByLabelText('Opening balance (optional)')).toBeDisabled();
    expect(screen.getByLabelText('Closing balance (optional)')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{ name: 'Validate preview' }));
    fireEvent.click(await screen.findByRole('button',{ name: 'Continue to confirmation' }));
    const expected: unknown = expect.objectContaining({ reconciliation_id: existing.id,opening_balance: opening,closing_balance: closing,
      rows: [expect.objectContaining({ amount: '1379998.62',source_row: 2 })] });
    expect(mocks.preview).toHaveBeenCalledWith(expected);
    expect(ready).toHaveBeenCalledWith(expected);
  });
  it('parses newly entered balances using the selected comma number format',async () => {
    const ready = vi.fn();
    mocks.read.mockResolvedValue({ ...file,sheets: [{ ...file.sheets[0]!,rows: [['Date','Description','Amount'],['2026-10-27','Exact bank receipt','1.379.998,62']] }] });
    mocks.preview.mockResolvedValue({ count: 1,total: '1379998.62',warnings: [],alreadyImported: false,balanceCheck: 'OK' });
    render(<BankImportDialog accounts={bankCatalogFixture.bank_accounts} onClose={() => undefined} onReady={ready} />);
    await fill();
    fireEvent.change(screen.getByLabelText('Number format'),{ target: { value: 'comma' } });
    fireEvent.change(screen.getByLabelText('Opening balance (optional)'),{ target: { value: '100,00' } });
    fireEvent.change(screen.getByLabelText('Closing balance (optional)'),{ target: { value: '1.379.998,62' } });
    fireEvent.click(screen.getByRole('button',{ name: 'Validate preview' }));
    fireEvent.click(await screen.findByRole('button',{ name: 'Continue to confirmation' }));
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ opening_balance: '100.00',closing_balance: '1379998.62',
      rows: [expect.objectContaining({ amount: '1379998.62',source_row: 2 })] }));
  });
  it('ignores a preview response after the operator changes the mapping',async () => {
    const pending = deferred<{ count: number; total: string; warnings: unknown[]; alreadyImported: boolean; balanceCheck: string }>(); mocks.preview.mockReturnValue(pending.promise);
    render(<BankImportDialog accounts={bankCatalogFixture.bank_accounts} onClose={() => undefined} onReady={() => undefined} />);
    await fill(); fireEvent.click(screen.getByRole('button',{ name: 'Validate preview' }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Number format'),{ target: { value: 'comma' } });
    await act(async () => { pending.resolve({ count: 1,total: '1379998.62',warnings: [],alreadyImported: false,balanceCheck: 'Unavailable' }); await pending.promise; });
    expect(screen.queryByRole('button',{ name: 'Continue to confirmation' })).not.toBeInTheDocument();
  });
});
