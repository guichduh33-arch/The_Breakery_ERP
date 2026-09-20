import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayIsoDate } from '@breakery/utils';
import { KitchenEntry } from '../KitchenEntry.js';
import { emptyDraft, readDraft, requestFor, writeDraft } from '../drafts.js';
import type * as KitchenApi from '../api.js';

const api = vi.hoisted(() => ({ products: vi.fn(), submit: vi.fn(), resolve: vi.fn() }));
vi.mock('../api.js', async (importOriginal) => ({
  ...await importOriginal<typeof KitchenApi>(),
  getProducts: api.products, submitProduction: api.submit, resolveSubmission: api.resolve,
}));

function mount(online = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><KitchenEntry userId="chef" sectionId="station" online={online} today={todayIsoDate()} /></QueryClientProvider>);
}
async function enterBread() {
  fireEvent.click(await screen.findByRole('button', { name: 'Bread' }));
  fireEvent.change(screen.getByLabelText('Produced Bread'), { target: { value: '12' } });
}
describe('kitchen entry recovery', () => {
  beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    api.products.mockResolvedValue([{ id: 'bread', name: 'Bread', unit: 'pcs', units: [{ code: 'pcs', factor: 1 }] }]);
    api.resolve.mockResolvedValue(null);
    api.submit.mockResolvedValue({ batch_id: 'batch', batch_number: 'BATCH-1', idempotent_replay: false });
  });
  it('records production and clears the draft only after confirmation', async () => {
    mount(); await enterBread();
    fireEvent.click(screen.getByRole('button', { name: 'Record production' }));
    expect(await screen.findByText('Production recorded: BATCH-1.')).toBeInTheDocument();
    expect(api.submit.mock.calls[0]?.[0]).toMatchObject({ section_id: 'station', items: [{ quantity_produced: 12 }] });
    expect(readDraft('chef', 'station').rows).toHaveLength(0);
  });
  it('locks the payload after a lost response and resolves without a second write', async () => {
    api.submit.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const view = mount(); await enterBread();
    fireEvent.click(screen.getByRole('button', { name: 'Record production' }));
    await screen.findByRole('button', { name: 'Check submission' });
    expect(screen.getByLabelText('Produced Bread')).toBeDisabled();
    const pending = readDraft('chef', 'station').pending;
    expect(pending).not.toBeNull();
    view.unmount();
    api.resolve.mockResolvedValueOnce({ batch_id: 'batch', batch_number: 'BATCH-1', idempotent_replay: true });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Check submission' }));
    await screen.findByText('Production recorded: BATCH-1.');
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.resolve).toHaveBeenLastCalledWith(pending?.idempotency_key);
  });
  it('retains editable quantities after a stock rejection', async () => {
    api.submit.mockRejectedValueOnce({ code: 'P0002', message: 'insufficient_stock' });
    mount(); await enterBread();
    fireEvent.click(screen.getByRole('button', { name: 'Record production' }));
    await screen.findByText(/Not enough ingredients/);
    expect(screen.getByLabelText('Produced Bread')).toBeEnabled();
    expect(readDraft('chef', 'station').rows[0]?.quantity).toBe('12');
    expect(readDraft('chef', 'station').pending).toBeNull();
  });
  it('keeps an uncertain payload locked when permission prevents receipt lookup', async () => {
    api.submit.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mount(); await enterBread();
    fireEvent.click(screen.getByRole('button', { name: 'Record production' }));
    await screen.findByRole('button', { name: 'Check submission' });
    const pending = readDraft('chef', 'station').pending;
    api.resolve.mockRejectedValueOnce({ code: 'P0003', message: 'kitchen_forbidden' });
    fireEvent.click(screen.getByRole('button', { name: 'Check submission' }));
    await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check submission' })).toBeEnabled());
    expect(screen.getByLabelText('Produced Bread')).toBeDisabled();
    expect(readDraft('chef', 'station').pending).toEqual(pending);
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it('does not send offline and restores saved input', async () => {
    const view = mount(); await enterBread(); view.unmount();
    mount(false);
    expect(screen.getByLabelText('Produced Bread')).toHaveValue('12');
    expect(screen.getByRole('button', { name: 'Record production' })).toBeDisabled();
    expect(api.submit).not.toHaveBeenCalled();
  });
  it('resolves an uncertain submission after midnight before considering a new write', async () => {
    const draft = emptyDraft('chef', 'station');
    draft.day = '2000-01-01';
    draft.rows = [{ productId: 'bread', name: 'Bread', quantity: '12', waste: '0', wasteReason: '', unit: 'pcs', note: '' }];
    draft.pending = requestFor(draft, 'original-key'); writeDraft(draft);
    api.resolve.mockResolvedValueOnce({ batch_id: 'batch', batch_number: 'BATCH-OLD', idempotent_replay: true });
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Check submission' }));
    await screen.findByText('Production recorded: BATCH-OLD.');
    expect(api.submit).not.toHaveBeenCalled();
  });
  it('ignores a second click while a submission is in flight', async () => {
    api.resolve.mockImplementation(() => new Promise(() => { /* Requête volontairement en attente. */ }));
    mount(); await enterBread();
    const button = screen.getByRole('button', { name: 'Record production' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(api.resolve).toHaveBeenCalledTimes(1));
  });
});
