// apps/backoffice/src/pages/settings/__tests__/SettingsHubPage.summary.test.tsx
//
// Lot 5 chantier 1 — le hub Réglages porte les valeurs courantes (archétype 5,
// DESIGN.md : « chaque tuile porte sa valeur courante sous son libellé »).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

vi.mock('@/stores/authStore.js', () => {
  const state = {
    hasPermission: () => true,
    user: { role_code: 'SUPER_ADMIN' },
  };
  return { useAuthStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

import SettingsHubPage from '../SettingsHubPage.js';

function renderHub() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SettingsHubPage — valeurs courantes', () => {
  it('rend la valeur sous le libellé, le tiret pour une section absente, le blurb pour une tuile sans valeur', async () => {
    rpc.mockResolvedValue({
      data: {
        company: { name: 'The Breakery', currency: 'IDR', tax_inclusive: true, tax_rate: 10 },
        payment_methods: { enabled: 6 },
        printing: { auto_print_receipt: true, auto_open_drawer: false },
        // lan_devices volontairement ABSENT (section gatée) → tiret.
      },
      error: null,
    });
    renderHub();

    expect(await screen.findByText('The Breakery · IDR · tax 10% incl.')).toBeInTheDocument();
    expect(screen.getByText('6 methods enabled')).toBeInTheDocument();
    expect(screen.getByText('Auto-print on · drawer off')).toBeInTheDocument();

    // Section gatée absente → tiret honnête, la tuile reste un lien.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // Tuile sans concept de valeur : le blurb d'origine reste.
    expect(screen.getByText('Audit trail of every setting change.')).toBeInTheDocument();

    // Un seul aller-retour.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_settings_hub_summary_v1');
  });
});
