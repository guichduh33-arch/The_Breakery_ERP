import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as ImportPackageModule from '../importPackage.js';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), state: { isAuthenticated: true, sessionToken: 'session-a', user: { id: 'operator', role_code: 'SUPER_ADMIN' }, hasPermission: (_code: string): boolean => true } }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: mocks.rpc }, supabaseUrl: 'https://yjhhhmjgsmyzyymvixot.supabase.co' }));
vi.mock('@/stores/authStore.js', () => ({ useAuthStore: Object.assign((selector: (s: typeof mocks.state) => unknown) => selector(mocks.state), { getState: () => mocks.state }) }));
vi.mock('../importPackage.js', async (original) => ({ ...await original<typeof ImportPackageModule>(), packageHash: () => Promise.resolve('b'.repeat(64)) }));
import HistoricalImportPage from '../HistoricalImportPage.js';
function Page() { return <MemoryRouter><HistoricalImportPage /></MemoryRouter>; }

function packageFile(project = 'yjhhhmjgsmyzyymvixot'): File {
  return { size: 1000, text: () => Promise.resolve(JSON.stringify({ format: 'breakery-historical-financial/1', target_project_ref: project, batches: [{
    client_key: '20000000-0000-0000-0000-000000000001', payload: { contract_version: 1, kind: 'sales', stock_mode: 'financial_only', currency: 'IDR',
      source_system: 'fixture', batch_reference: 'fixture', documents: [{ source_reference: 'SALE-1', stock_mode: 'financial_only' }], payments: [] },
  }] })) } as File;
}
async function upload(file = packageFile()) {
  fireEvent.change(screen.getByLabelText('Financial package (.json)'), { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Validate and import' });
}
beforeEach(() => {
  mocks.rpc.mockReset(); localStorage.clear();
  mocks.state.user = { id: 'operator', role_code: 'SUPER_ADMIN' }; mocks.state.hasPermission = () => true;
  mocks.state.isAuthenticated = true; mocks.state.sessionToken = 'session-a';
});
afterEach(cleanup);

describe('historical import page', () => {
  it('does not expose upload controls to an administrator', () => {
    mocks.state.user.role_code = 'ADMIN'; render(<Page />);
    expect(screen.queryByLabelText('Financial package (.json)')).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires the package money permissions, even for a super administrator', async () => {
    mocks.state.hasPermission = (code) => code !== 'pos.sale.create'; render(<Page />);
    fireEvent.change(screen.getByLabelText('Financial package (.json)'), { target: { files: [packageFile()] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('permission is missing');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects another database before contacting the server', async () => {
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Financial package (.json)'), { target: { files: [packageFile('other-project')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires deliberate confirmation and then uses the authenticated singleton', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { valid: true, preview_hash: 'a'.repeat(64), stock_mode: 'financial_only', stock_deferred: true, stock_effects: [] }, error: null })
      .mockResolvedValueOnce({ data: { run_id: '30000000-0000-0000-0000-000000000001', stock_mode: 'financial_only', stock_effect_count: 0 }, error: null });
    render(<Page />); await upload();
    expect(screen.getByRole('button', { name: 'Validate and import' })).toBeDisabled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Validate and import' }));
    await screen.findByRole('button', { name: 'Verify completed import' });
    expect(mocks.rpc.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual(['preview_historical_import_v3', 'apply_historical_import_v3']);
  });
  it('blocks double clicks while a preview is pending', async () => {
    let complete: (value: unknown) => void = () => undefined;
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render(<Page />); await upload(); fireEvent.click(screen.getByRole('checkbox'));
    const button = screen.getByRole('button', { name: 'Validate and import' }); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    complete({ data: { valid: false, errors: [{ code: 'insufficient_display_stock' }] }, error: null });
    expect(await screen.findByRole('alert')).toHaveTextContent('insufficient_display_stock');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('stops before apply if the operator changes during preview', async () => {
    let complete: (value: unknown) => void = () => undefined;
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render(<Page />); await upload(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and import' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    mocks.state.user = { id: 'other-operator', role_code: 'SUPER_ADMIN' }; mocks.state.sessionToken = 'session-b';
    complete({ data: { valid: true, preview_hash: 'a'.repeat(64) }, error: null });
    expect(await screen.findByRole('alert')).toHaveTextContent('operator session changed');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not apply after the page unmounts during preview', async () => {
    let complete: (value: unknown) => void = () => undefined;
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const view = render(<Page />); await upload(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and import' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1)); view.unmount();
    await act(async () => { complete({ data: { valid: true, preview_hash: 'a'.repeat(64) }, error: null }); await Promise.resolve(); });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('refuses a valid-looking preview that would consume stock', async () => {
    mocks.rpc.mockResolvedValue({ data: { valid: true, preview_hash: 'a'.repeat(64), stock_mode: 'legacy', stock_effects: [{ quantity: -1 }] }, error: null });
    render(<Page />); await upload(); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not defer all stock');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
