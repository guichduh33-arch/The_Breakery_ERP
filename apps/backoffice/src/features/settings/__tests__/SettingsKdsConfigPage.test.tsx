// apps/backoffice/src/features/settings/__tests__/SettingsKdsConfigPage.test.tsx
// S75 Task 8 — smoke test for the org-level KDS Configuration settings page.
// Server-side (set_setting_v4, migration 20260712000163) enforces
// warning < urgent against the OTHER key's CURRENTLY STORED value — a
// same-request bump of both keys in the wrong order 22023s. The client
// mirrors that with an inline validation message + disabled Save, and saves
// in the order that never trips the guard (whichever of warning/urgent moves
// away from the other first; archive last).

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsKdsConfigPage from '@/pages/settings/SettingsKdsConfigPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v3') {
        return Promise.resolve({
          data: {
            category: 'kds',
            settings: {
              kds_warning_threshold_minutes: 5,
              kds_urgent_threshold_minutes: 10,
              kds_auto_archive_minutes: 5,
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v4
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

describe('SettingsKdsConfigPage', () => {
  it('renders the 3 threshold inputs seeded from the RPC', async () => {
    canUpdate = true;
    render(wrap(<SettingsKdsConfigPage />));
    await waitFor(() => expect(screen.getByLabelText(/warning threshold/i)).toBeInTheDocument());

    expect(screen.getByLabelText<HTMLInputElement>(/warning threshold/i).value).toBe('5');
    expect(screen.getByLabelText<HTMLInputElement>(/urgent threshold/i).value).toBe('10');
    expect(screen.getByLabelText<HTMLInputElement>(/ready auto-archive/i).value).toBe('5');
  });

  it('disables the inputs and hides Save without settings.update', async () => {
    canUpdate = false;
    render(wrap(<SettingsKdsConfigPage />));
    await waitFor(() => expect(screen.getByLabelText(/warning threshold/i)).toBeInTheDocument());

    expect(screen.getByLabelText(/warning threshold/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('warning >= urgent shows an inline error and disables Save', async () => {
    canUpdate = true;
    render(wrap(<SettingsKdsConfigPage />));
    await waitFor(() => screen.getByLabelText(/warning threshold/i));

    fireEvent.change(screen.getByLabelText(/warning threshold/i), { target: { value: '12' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/warning threshold must be less than urgent threshold/i);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('warning < urgent clears the error and enables Save', async () => {
    canUpdate = true;
    render(wrap(<SettingsKdsConfigPage />));
    await waitFor(() => screen.getByLabelText(/warning threshold/i));

    fireEvent.change(screen.getByLabelText(/warning threshold/i), { target: { value: '8' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save 1 change/i })).toBeEnabled();
  });

  it('saves warning before urgent when urgent is not increasing (anti-22023 order)', async () => {
    canUpdate = true;
    rpcCalls.length = 0;
    render(wrap(<SettingsKdsConfigPage />));
    await waitFor(() => screen.getByLabelText(/warning threshold/i));

    // 5/10 -> 8/9: urgent decreases, so warning (8, still < old urgent 10) must
    // commit first, then urgent (9, now > new warning 8).
    fireEvent.change(screen.getByLabelText(/warning threshold/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/urgent threshold/i), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /save 2 changes/i }));

    await waitFor(() => expect(rpcCalls.filter((c) => c.fn === 'set_setting_v4')).toHaveLength(2));

    const sets = rpcCalls.filter((c) => c.fn === 'set_setting_v4');
    expect(sets[0]?.args).toEqual({ p_key: 'kds_warning_threshold_minutes', p_value: 8, p_category: 'kds' });
    expect(sets[1]?.args).toEqual({ p_key: 'kds_urgent_threshold_minutes', p_value: 9, p_category: 'kds' });
  });

  it('saves urgent before warning when urgent is increasing (anti-22023 order)', async () => {
    canUpdate = true;
    rpcCalls.length = 0;
    render(wrap(<SettingsKdsConfigPage />));
    await waitFor(() => screen.getByLabelText(/warning threshold/i));

    // 5/10 -> 11/15: urgent increases, so urgent must commit first (15, still
    // > old warning 5), then warning (11, now < new urgent 15).
    fireEvent.change(screen.getByLabelText(/urgent threshold/i), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/warning threshold/i), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: /save 2 changes/i }));

    await waitFor(() => expect(rpcCalls.filter((c) => c.fn === 'set_setting_v4')).toHaveLength(2));

    const sets = rpcCalls.filter((c) => c.fn === 'set_setting_v4');
    expect(sets[0]?.args).toEqual({ p_key: 'kds_urgent_threshold_minutes', p_value: 15, p_category: 'kds' });
    expect(sets[1]?.args).toEqual({ p_key: 'kds_warning_threshold_minutes', p_value: 11, p_category: 'kds' });
  });

  it('saves the archive delay last when all 3 fields change', async () => {
    canUpdate = true;
    rpcCalls.length = 0;
    render(wrap(<SettingsKdsConfigPage />));
    await waitFor(() => screen.getByLabelText(/warning threshold/i));

    fireEvent.change(screen.getByLabelText(/warning threshold/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/urgent threshold/i), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText(/ready auto-archive/i), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /save 3 changes/i }));

    await waitFor(() => expect(rpcCalls.filter((c) => c.fn === 'set_setting_v4')).toHaveLength(3));

    const sets = rpcCalls.filter((c) => c.fn === 'set_setting_v4');
    expect(sets[2]?.args).toEqual({ p_key: 'kds_auto_archive_minutes', p_value: 7, p_category: 'kds' });
  });
});
