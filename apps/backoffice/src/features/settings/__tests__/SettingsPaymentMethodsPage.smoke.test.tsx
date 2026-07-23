import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPaymentMethodsPage from '@/pages/settings/SettingsPaymentMethodsPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v5') {
        return Promise.resolve({
          data: {
            category: 'payments',
            settings: {
              enabled_payment_methods: ['cash', 'card'],
              // Lot C — frais informatifs par méthode (% seul).
              payment_method_fees: { qris: 0.7 },
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v7
    },
  },
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe('SettingsPaymentMethodsPage', () => {
  it('renders checked/unchecked state from the RPC', async () => {
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => expect(screen.getByLabelText(/^cash$/i)).toBeInTheDocument());

    expect(screen.getByLabelText<HTMLInputElement>(/^cash$/i).checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(/^card$/i).checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(/^qris$/i).checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>(/^edc$/i).checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>(/^transfer$/i).checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>(/^store credit$/i).checked).toBe(false);
  });

  it('disables save and shows a warning when every method is unchecked', async () => {
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => screen.getByLabelText(/^cash$/i));

    fireEvent.click(screen.getByLabelText(/^cash$/i));
    fireEvent.click(screen.getByLabelText(/^card$/i));

    expect(screen.getByText(/au moins une méthode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enregistrer/i })).toBeDisabled();
  });

  // ADR-006 déc. 9 lot A — the array order IS the POS display order.
  it('reordering with the arrows marks dirty and saves the new order', async () => {
    rpcCalls.length = 0;
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => screen.getByTestId('pm-row-cash'));

    // ['cash', 'card'] → move cash down → ['card', 'cash']
    fireEvent.click(screen.getByTestId('pm-down-cash'));
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'set_setting_v7')).toBe(true));
    const call = rpcCalls.find((c) => c.fn === 'set_setting_v7');
    expect(call?.args).toEqual({
      p_key: 'enabled_payment_methods',
      p_value: ['card', 'cash'],
      p_category: 'payments',
    });
  });

  it('renders enabled methods in the configured order, disabled ones below', async () => {
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => screen.getByTestId('pm-row-cash'));

    const rows = screen.getAllByTestId(/^pm-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['pm-row-cash', 'pm-row-card']);
    // Disabled methods have no reorder arrows.
    expect(screen.queryByTestId('pm-up-qris')).not.toBeInTheDocument();
  });

  // ADR-006 déc. 9 lot C — frais informatifs par méthode (% seul).
  it('renders the stored fee percentage and saves an edited fee via payment_method_fees', async () => {
    rpcCalls.length = 0;
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => screen.getByTestId('pm-fee-qris'));

    expect(screen.getByTestId<HTMLInputElement>('pm-fee-qris').value).toBe('0.7');
    expect(screen.getByTestId<HTMLInputElement>('pm-fee-cash').value).toBe('');

    fireEvent.change(screen.getByTestId('pm-fee-gopay'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'set_setting_v7')).toBe(true));
    const call = rpcCalls.find((c) => c.fn === 'set_setting_v7');
    expect(call?.args).toEqual({
      p_key: 'payment_method_fees',
      p_value: { qris: 0.7, gopay: 2 },
      p_category: 'payments',
    });
  });

  it('blocks save and warns when a fee is out of [0, 100]', async () => {
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => screen.getByTestId('pm-fee-cash'));

    fireEvent.change(screen.getByTestId('pm-fee-cash'), { target: { value: '150' } });

    expect(screen.getByText(/entre 0 et 100/i)).toBeInTheDocument();
    // Frais invalide → feesDirty false → le bouton retombe sur « Aucun changement », désactivé.
    expect(screen.getByRole('button', { name: /aucun changement/i })).toBeDisabled();
  });

  it('calls set_setting_v7 with the remaining methods on save', async () => {
    rpcCalls.length = 0;
    render(wrap(<SettingsPaymentMethodsPage />));
    await waitFor(() => screen.getByLabelText(/^cash$/i));

    fireEvent.click(screen.getByLabelText(/^card$/i));
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'set_setting_v7')).toBe(true));

    const call = rpcCalls.find((c) => c.fn === 'set_setting_v7');
    expect(call?.args).toEqual({
      p_key: 'enabled_payment_methods',
      p_value: ['cash'],
      p_category: 'payments',
    });
  });
});
