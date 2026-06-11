// apps/backoffice/src/__tests__/btob-settings.smoke.test.tsx
//
// Session 39 / Wave C2 — smoke tests for B2BSettingsPage wired to b2b_settings RPCs.
//
// T1: page displays SERVER values from get_b2b_settings_v1, not hardcoded seeds.
// T2: editing threshold + Save calls update_b2b_settings_v1 with a 4-key patch
//     whose aging_buckets have NO local ids.
// T3: the «Read-only preview» banner is absent.

import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import B2BSettingsPage from '@/pages/btob/B2BSettingsPage.js';

// ── auth store ──────────────────────────────────────────────────────────────
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => p === 'settings.read' || p === 'settings.update' }),
}));

// ── supabase rpc mock ────────────────────────────────────────────────────────
// Use vi.hoisted so rpcMock is available when the vi.mock factory is called.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

const SERVER_SETTINGS = {
  default_payment_terms:   'net_14',
  available_payment_terms: ['cod', 'net_14', 'net_30'],
  critical_overdue_days:   45,
  aging_buckets: [
    { label: 'Current',  min: 0,  max: 30   },
    { label: 'Overdue',  min: 31, max: 60   },
    { label: 'Critical', min: 61, max: null },
  ],
};

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <B2BSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('B2BSettingsPage', () => {
  it('T1: displays SERVER values (net_14, threshold 45) — not hardcoded seeds', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'get_b2b_settings_v1') {
        return Promise.resolve({ data: SERVER_SETTINGS, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderPage();

    // Heading present
    expect(screen.getByRole('heading', { name: /b2b settings/i })).toBeInTheDocument();

    // Wait for data to populate the form
    await waitFor(() => {
      expect((screen.getByLabelText(/default payment terms/i) as HTMLSelectElement).value).toBe('net_14');
    });

    // Threshold from server = 45, not the old hardcoded 30
    expect((screen.getByLabelText(/critical overdue threshold/i) as HTMLInputElement).value).toBe('45');

    // Available terms from server
    expect(screen.getByText('net_14')).toBeInTheDocument();
    expect(screen.getByText('net_30')).toBeInTheDocument();
  });

  it('T2: editing threshold + Save calls update_b2b_settings_v1 with 4-key patch (no local ids on buckets)', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'get_b2b_settings_v1') {
        return Promise.resolve({ data: SERVER_SETTINGS, error: null });
      }
      if (name === 'update_b2b_settings_v1') {
        return Promise.resolve({ data: SERVER_SETTINGS, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderPage();

    // Wait for server data to populate
    await waitFor(() => {
      expect((screen.getByLabelText(/critical overdue threshold/i) as HTMLInputElement).value).toBe('45');
    });

    // Edit threshold to 60
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/critical overdue threshold/i), { target: { value: '60' } });
    });

    // Save bar should appear with enabled Save button
    const saveBtn = await screen.findByRole('button', { name: /save changes/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('update_b2b_settings_v1', expect.anything());
    });

    // Verify the p_patch shape
    const allCalls = (rpcMock as Mock).mock.calls as Array<[string, { p_patch: Record<string, unknown> }]>;
    const call = allCalls.find((c) => c[0] === 'update_b2b_settings_v1');
    expect(call).toBeDefined();
    const patch = call![1].p_patch;

    // 4 keys present
    expect(patch).toHaveProperty('default_payment_terms');
    expect(patch).toHaveProperty('available_payment_terms');
    expect(patch).toHaveProperty('critical_overdue_days', 60);
    expect(patch).toHaveProperty('aging_buckets');

    // Buckets have no local `id`
    const buckets = patch.aging_buckets as Array<Record<string, unknown>>;
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      expect(bucket).not.toHaveProperty('id');
      expect(bucket).toHaveProperty('label');
      expect(bucket).toHaveProperty('min');
      expect('max' in bucket).toBe(true);
    }
  });

  it('T3: the «Read-only preview» banner is absent', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'get_b2b_settings_v1') {
        return Promise.resolve({ data: SERVER_SETTINGS, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderPage();

    // Banner text from the old stub must be gone
    expect(screen.queryByText(/read-only preview/i)).toBeNull();
    expect(screen.queryByText(/D-W6-B2BSET-01/i)).toBeNull();
  });
});
