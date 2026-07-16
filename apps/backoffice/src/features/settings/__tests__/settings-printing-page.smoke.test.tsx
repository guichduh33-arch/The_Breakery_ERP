// apps/backoffice/src/features/settings/__tests__/settings-printing-page.smoke.test.tsx
// S73 Lot 2 — smoke test for the org-level Printing settings page.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPrintingPage from '@/pages/settings/SettingsPrintingPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
let mockSettings: Record<string, boolean> = {};
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v1') {
        return Promise.resolve({
          data: { category: 'printing', settings: mockSettings },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v1
    },
  },
}));

let canUpdate = true;
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => canUpdate }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('SettingsPrintingPage', () => {
  it('renders checked/unchecked state from the RPC', async () => {
    canUpdate = true;
    mockSettings = { pos_auto_print_receipt: true, pos_auto_open_drawer: false };
    render(wrap(<SettingsPrintingPage />));
    await waitFor(() => expect(screen.getByLabelText(/auto-print receipt/i)).toBeInTheDocument());

    expect(screen.getByLabelText<HTMLInputElement>(/auto-print receipt/i).checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(/auto-open cash drawer/i).checked).toBe(false);
  });

  it('defaults missing keys to ON, matching the DB default and the POS fallback', async () => {
    canUpdate = true;
    mockSettings = {}; // config row absent → RPC returns empty settings
    render(wrap(<SettingsPrintingPage />));
    await waitFor(() => expect(screen.getByLabelText(/auto-print receipt/i)).toBeInTheDocument());

    expect(screen.getByLabelText<HTMLInputElement>(/auto-print receipt/i).checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(/auto-open cash drawer/i).checked).toBe(true);
    expect(screen.getByRole('button', { name: /no changes/i })).toBeDisabled();
  });

  it('disables the checkboxes and hides Save without settings.update', async () => {
    canUpdate = false;
    mockSettings = { pos_auto_print_receipt: true, pos_auto_open_drawer: false };
    render(wrap(<SettingsPrintingPage />));
    await waitFor(() => expect(screen.getByLabelText(/auto-print receipt/i)).toBeInTheDocument());

    expect(screen.getByLabelText(/auto-print receipt/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('calls set_setting_v1 with the printing category on save', async () => {
    canUpdate = true;
    mockSettings = { pos_auto_print_receipt: true, pos_auto_open_drawer: false };
    rpcCalls.length = 0;
    render(wrap(<SettingsPrintingPage />));
    await waitFor(() => screen.getByLabelText(/auto-open cash drawer/i));

    fireEvent.click(screen.getByLabelText(/auto-open cash drawer/i));
    fireEvent.click(screen.getByRole('button', { name: /save 1 change/i }));

    await waitFor(() => expect(rpcCalls.some((c) => c.fn === 'set_setting_v1')).toBe(true));

    const call = rpcCalls.find((c) => c.fn === 'set_setting_v1');
    expect(call?.args).toEqual({
      p_key: 'pos_auto_open_drawer',
      p_value: true,
      p_category: 'printing',
    });
  });
});
