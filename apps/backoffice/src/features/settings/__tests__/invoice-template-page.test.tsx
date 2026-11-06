import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvoicePrintTemplate } from '../invoiceTemplate.js';
import SettingsInvoiceTemplatePage from '@/pages/settings/SettingsInvoiceTemplatePage.js';

const state = vi.hoisted(() => ({ read: true, write: true, loadError: false, saveError: false, rpc: vi.fn() }));
vi.mock('@/stores/authStore.js', () => ({ useAuthStore: (selector: (value: unknown) => unknown) => selector({
  user: { id: 'profile-test' }, hasPermission: (code: string) => code === 'settings.read' ? state.read : state.write,
}) }));
vi.mock('@/features/settings/hooks/useSettings.js', () => ({ useSettings: () => ({ data: { settings: { name: 'The Breakery', fiscal_address: 'Business address' } } }) }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: state.rpc } }));

const INITIAL: InvoicePrintTemplate = {
  id: true, revision: 1, updated_at: '2026-11-06T00:00:00Z', updated_by: null,
  heading: 'INVOICE', business_name: '', contact_text: '', payment_instructions: '',
  footer_message: 'Thank you for choosing The Breakery.', show_logo: true, show_contact: true,
  show_unit_prices: true, show_due_date: true, density: 'comfortable',
  paper_width_mm: 210, paper_height_mm: 297, margin_left_mm: 12, margin_right_mm: 12,
  margin_top_mm: 12, margin_bottom_mm: 12, offset_x_mm: 0, offset_y_mm: 0,
};
function setup() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <SettingsInvoiceTemplatePage /></QueryClientProvider>);
}

describe('Invoice template settings', () => {
  beforeEach(() => {
    Object.assign(state, { read: true, write: true, loadError: false, saveError: false });
    state.rpc.mockReset();
    state.rpc.mockImplementation((name: string, args?: { p_settings: Partial<InvoicePrintTemplate> }) => ({ single: () => Promise.resolve(
      name === 'get_invoice_print_template_v1'
        ? { data: state.loadError ? null : INITIAL, error: state.loadError ? { message: 'Unavailable' } : null }
        : { data: { ...INITIAL, ...args?.p_settings, revision: 2 }, error: state.saveError ? { code: '40001' } : null }) }));
  });
  it('edits a custom format and wording, then saves only presentation fields with a revision', async () => {
    setup();
    await screen.findByLabelText('Document heading');
    fireEvent.change(screen.getByLabelText('Document heading'), { target: { value: 'COMMERCIAL INVOICE' } });
    expect(screen.getByLabelText('Invoice preview')).toHaveTextContent('COMMERCIAL INVOICE');
    fireEvent.change(screen.getByLabelText('Paper preset'), { target: { value: 'continuous-half' } });
    expect(screen.getByLabelText('Width (mm)')).toHaveValue(241.3);
    expect(screen.getByLabelText('Height (mm)')).toHaveValue(139.7);
    fireEvent.change(screen.getByLabelText('Horizontal offset (mm)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Invoice template saved');
    const call = state.rpc.mock.calls.find(([name]) => name === 'update_invoice_print_template_v1');
    const args = call?.[1] as { p_settings: Record<string, unknown>; p_expected_revision: number } | undefined;
    expect(args?.p_expected_revision).toBe(1);
    expect(args?.p_settings).toMatchObject({ heading: 'COMMERCIAL INVOICE', paper_width_mm: 241.3, paper_height_mm: 139.7, offset_x_mm: 2 });
    expect(args?.p_settings).not.toHaveProperty('revision');
    expect(args?.p_settings).not.toHaveProperty('total');
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
  });
  it('rejects offsets that put content outside the paper', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('Horizontal offset (mm)'), { target: { value: '20' } });
    expect(screen.getByRole('alert')).toHaveTextContent('outside the paper');
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
    expect(state.rpc.mock.calls.some(([name]) => name === 'update_invoice_print_template_v1')).toBe(false);
  });
  it('keeps the draft after a concurrent edit and offers a reload', async () => {
    state.saveError = true;
    setup();
    fireEvent.change(await screen.findByLabelText('Footer message'), { target: { value: 'Draft footer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This template changed');
    expect(screen.getByLabelText('Footer message')).toHaveValue('Draft footer');
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved' }));
    await waitFor(() => expect(screen.getByLabelText('Footer message')).toHaveValue(INITIAL.footer_message));
  });
  it('shows the template read-only without settings.update', async () => {
    state.write = false;
    setup();
    expect(await screen.findByLabelText('Document heading')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
    expect(screen.getByText(/You can view this template/)).toBeInTheDocument();
  });
  it('does not fetch a template for an unauthorized reader', () => {
    state.read = false;
    setup();
    expect(screen.getByText('You do not have permission to view invoice settings.')).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('shows a retry when loading fails', async () => {
    state.loadError = true;
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('toggles optional columns and resets unsaved changes without saving', async () => {
    setup();
    fireEvent.click(await screen.findByLabelText('Show unit prices'));
    expect(screen.queryByRole('columnheader', { name: 'Unit price' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset changes' }));
    expect(screen.getByRole('columnheader', { name: 'Unit price' })).toBeInTheDocument();
    expect(state.rpc.mock.calls.some(([name]) => name === 'update_invoice_print_template_v1')).toBe(false);
  });
});
