// apps/backoffice/src/features/settings/__tests__/SettingsGeneralPage.smoke.test.tsx
// Session 13 / Phase 5.C — Smoke test for the general settings page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsGeneralPage from '@/pages/settings/SettingsGeneralPage.js';

const currentPerms = new Set<string>(['settings.read', 'settings.update']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const settingsByCategory: Record<string, Record<string, unknown>> = {
  business: { name: 'The Breakery', fiscal_address: 'Lombok, Indonesia' },
  localization: { currency: 'IDR', timezone: 'Asia/Makassar' },
  tax: { tax_rate: 0.1, tax_inclusive: true },
  pos: { shift_variance_threshold_pct: 0.005, shift_variance_threshold_abs: 50000 },
};

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
// Lot 6b — set to true to make the next set_setting_v8('tax_inclusive') fail
// with the server gate error (open orders present).
let failNextTaxSwitch = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v6') {
        const category = String(args.p_category);
        return Promise.resolve({
          data: { category, settings: settingsByCategory[category] ?? {} },
          error: null,
        });
      }
      if (fn === 'set_setting_v8') {
        if (failNextTaxSwitch && args.p_key === 'tax_inclusive') {
          failNextTaxSwitch = false;
          return Promise.resolve({ data: null, error: { message: 'tax_mode_switch_blocked' } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsGeneralPage />
    </QueryClientProvider>,
  );
}

describe('SettingsGeneralPage', () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    failNextTaxSwitch = false;
    currentPerms.clear();
    currentPerms.add('settings.read');
    currentPerms.add('settings.update');
  });

  it('renders fields populated from the four category RPCs', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/Business name/i)).toHaveValue('The Breakery');
    });
    expect(screen.getByLabelText(/Currency code/i)).toHaveValue('IDR');
    expect(screen.getByLabelText(/Timezone/i)).toHaveValue('Asia/Makassar');
    // DB decimal 0.1 renders as percent 10.
    expect(screen.getByLabelText(/^Tax rate$/i)).toHaveValue(10);
  });

  it('currency and timezone are selects, tax rate is a percent input', async () => {
    renderPage();
    await waitFor(() => screen.getByLabelText(/Business name/i));
    expect(screen.getByLabelText('Currency code').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Timezone').tagName).toBe('SELECT');
    expect(screen.getByLabelText(/tax rate/i)).toHaveAttribute('type', 'number');
    // valeur DB 0.10 rendue 10 (%)
    expect(screen.getByLabelText(/tax rate/i)).toHaveValue(10);
  });

  it('shows "No changes" while the form is clean', async () => {
    renderPage();
    await waitFor(() => screen.getByLabelText(/Business name/i));
    expect(screen.getByRole('button', { name: /No changes/i })).toBeInTheDocument();
  });

  it('calls set_setting_v8 once per dirty key on submit', async () => {
    renderPage();
    await waitFor(() => screen.getByLabelText(/Business name/i));
    rpcCalls.length = 0;

    fireEvent.change(screen.getByLabelText(/Business name/i), { target: { value: 'New Bakery' } });
    fireEvent.click(screen.getByRole('button', { name: /Save 1 change/i }));

    await waitFor(() => {
      const setCalls = rpcCalls.filter((c) => c.fn === 'set_setting_v8');
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]?.args.p_key).toBe('name');
      expect(setCalls[0]?.args.p_value).toBe('New Bakery');
      expect(setCalls[0]?.args.p_category).toBe('business');
    });
  });

  it('saving a percent field writes the decimal to the RPC (money-path guard)', async () => {
    renderPage();
    await waitFor(() => screen.getByLabelText(/^Tax rate$/i));
    rpcCalls.length = 0;

    // Displayed 10 (%) -> edited to 25 (%) -> must write 0.25, never 25.
    fireEvent.change(screen.getByLabelText(/^Tax rate$/i), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /Save 1 change/i }));

    await waitFor(() => {
      const setCalls = rpcCalls.filter((c) => c.fn === 'set_setting_v8');
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]?.args.p_key).toBe('tax_rate');
      expect(setCalls[0]?.args.p_value).toBe(0.25);
      expect(setCalls[0]?.args.p_category).toBe('tax');
    });
  });

  // Lot 6b — the tax-mode switch goes through a confirmation dialog and the
  // server error tax_mode_switch_blocked surfaces as an actionable message.
  it('changing tax_inclusive opens the confirmation dialog before any write', async () => {
    renderPage();
    await waitFor(() => screen.getByLabelText(/Tax inclusive/i));
    rpcCalls.length = 0;

    fireEvent.click(screen.getByLabelText(/Tax inclusive/i));
    fireEvent.click(screen.getByRole('button', { name: /Save 1 change/i }));

    // Dialog shown, nothing written yet.
    expect(await screen.findByText(/Switch the tax mode\?/i)).toBeInTheDocument();
    expect(rpcCalls.filter((c) => c.fn === 'set_setting_v8')).toHaveLength(0);

    // Confirming performs the write.
    fireEvent.click(screen.getByRole('button', { name: /Switch tax mode/i }));
    await waitFor(() => {
      const setCalls = rpcCalls.filter((c) => c.fn === 'set_setting_v8');
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]?.args.p_key).toBe('tax_inclusive');
      expect(setCalls[0]?.args.p_value).toBe(false);
    });
  });

  it('cancelling the tax-mode dialog writes nothing', async () => {
    renderPage();
    await waitFor(() => screen.getByLabelText(/Tax inclusive/i));
    rpcCalls.length = 0;

    fireEvent.click(screen.getByLabelText(/Tax inclusive/i));
    fireEvent.click(screen.getByRole('button', { name: /Save 1 change/i }));
    expect(await screen.findByText(/Switch the tax mode\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Switch the tax mode\?/i)).not.toBeInTheDocument();
    });
    expect(rpcCalls.filter((c) => c.fn === 'set_setting_v8')).toHaveLength(0);
  });

  it('maps tax_mode_switch_blocked to an actionable error message', async () => {
    failNextTaxSwitch = true;
    renderPage();
    await waitFor(() => screen.getByLabelText(/Tax inclusive/i));

    fireEvent.click(screen.getByLabelText(/Tax inclusive/i));
    fireEvent.click(screen.getByRole('button', { name: /Save 1 change/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Switch tax mode/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/orders are still open/i);
  });

  it('disables save when settings.update is missing', async () => {
    currentPerms.delete('settings.update');
    renderPage();
    await waitFor(() => screen.getByLabelText(/Business name/i));
    expect(screen.queryByRole('button', { name: /No changes|Save/i })).not.toBeInTheDocument();
  });
});
