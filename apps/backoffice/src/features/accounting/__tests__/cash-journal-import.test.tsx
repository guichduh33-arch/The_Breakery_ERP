import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CashJournalImport } from '../components/CashJournalImport.js';

const state = vi.hoisted(() => ({ rpc: vi.fn(), allowed: true }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: <T,>(select: (value: { hasPermission: () => boolean }) => T) => select({ hasPermission: () => state.allowed }),
}));
const payload = { version: 1, source_name: 'Cash fixture', source_sha256: 'a'.repeat(64), entries: [{}] };
const report = {
  preview_hash: 'hash', ready: 1, already_imported: 0, total_debit: 12000, total_credit: 12000,
  account_impacts: [{ account_code: '1111', account_name: 'Petty Cash', debit: 0, credit: 12000, change: -12000 }],
  rows: [{ source_key: 'cash-1', date: '2026-10-02', description: 'Correct existing purchase payment', state: 'ready', total: 12000,
    corrects_je_id: 'original-je', lines: [{ account_code: '1111', account_name: 'Petty Cash', debit: 0, credit: 12000 }] }],
};
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CashJournalImport />
  </QueryClientProvider>);
}
async function upload(text = JSON.stringify(payload)) {
  const file = new File([text], 'cash.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  fireEvent.change(screen.getByLabelText('Reconciled journal package'), { target: { files: [file] } });
  await waitFor(() => expect(screen.queryByText('Processing…')).not.toBeInTheDocument());
}
beforeEach(() => { state.allowed = true; state.rpc.mockReset(); });
describe('cash journal import', () => {
  it('hides mutation controls without the required permissions', () => {
    state.allowed = false; mount();
    expect(screen.queryByRole('button', { name: 'Import reconciled cash journals' })).not.toBeInTheDocument();
  });
  it('rejects malformed input before requesting a preview', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Import reconciled cash journals' }));
    await upload('{broken');
    expect(screen.getByRole('alert')).toBeInTheDocument(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it('shows account impacts, source corrections and a PIN-gated post action', async () => {
    state.rpc.mockResolvedValue({ data: report, error: null });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Import reconciled cash journals' }));
    await upload();
    expect(screen.getByRole('table', { name: 'Import account impacts' })).toHaveTextContent('Petty Cash');
    expect(screen.getByText(/Corrects journal: original-je/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post 1 journal entries' })).toBeDisabled();
    expect(state.rpc).toHaveBeenCalledWith('preview_cash_journal_import_v3', { p_payload: payload });
  });
  it('posts the reviewed payload and hash, then clears the PIN and preview', async () => {
    state.rpc.mockResolvedValueOnce({ data: report, error: null }).mockResolvedValueOnce({ data: { ok: true, created: 1 }, error: null });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Import reconciled cash journals' }));
    await upload(); fireEvent.change(screen.getByLabelText('Your manager PIN'), { target: { value: '285741' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post 1 journal entries' }));
    await screen.findByText(/1 journal entries posted/);
    expect(state.rpc).toHaveBeenLastCalledWith('apply_cash_journal_import_v4', { p_payload: payload, p_preview_hash: 'hash', p_manager_pin: '285741' });
    expect(screen.queryByLabelText('Your manager PIN')).not.toBeInTheDocument();
  });
  it('requires a fresh preview after an uncertain response and accepts durable replay', async () => {
    state.rpc.mockResolvedValueOnce({ data: report, error: null }).mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ data: { ...report, ready: 0, already_imported: 1, rows: [], account_impacts: [] }, error: null });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Import reconciled cash journals' }));
    await upload(); fireEvent.change(screen.getByLabelText('Your manager PIN'), { target: { value: '285741' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post 1 journal entries' }));
    await screen.findByRole('alert'); expect(screen.queryByLabelText('Your manager PIN')).not.toBeInTheDocument();
    await upload(); expect(screen.getByText(/0 ready · 1 already imported/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Post.*journal entries/ })).not.toBeInTheDocument();
  });
});
