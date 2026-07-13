// apps/backoffice/src/features/settings/__tests__/SettingsReceiptTemplatesPage.smoke.test.tsx
// Session 13 / Phase 5.C — Smoke test for the receipt template page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsReceiptTemplatesPage from '@/pages/settings/SettingsReceiptTemplatesPage.js';

const currentPerms = new Set<string>(['settings.read', 'settings.update']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const MOCK_TEMPLATES = [
  { id: 'rec-1', name: 'Default 80mm', header: 'Breakery', footer: 'Thanks', paper_size: '80mm', show_qr: false, show_logo: true,  custom_css: null, is_default: true,  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

interface RpcResult { data: unknown; error: { message: string } | null }

interface MockChain {
  select: () => MockChain;
  order:  (...args: unknown[]) => MockChain | Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(): MockChain {
    let orderCount = 0;
    const chain: MockChain = {
      select: () => chain,
      order: () => {
        orderCount += 1;
        // The hook chains .order().order() ; resolve on the second call.
        if (orderCount >= 2) return Promise.resolve({ data: MOCK_TEMPLATES, error: null });
        return chain;
      },
    };
    return chain;
  }
  return {
    supabase: { from: () => buildChain() },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsReceiptTemplatesPage />
    </QueryClientProvider>,
  );
}

describe('SettingsReceiptTemplatesPage', () => {
  beforeEach(() => {
    currentPerms.clear();
    currentPerms.add('settings.read');
    currentPerms.add('settings.update');
  });

  it('renders the heading and the seeded default template', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Receipt templates/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Default 80mm/i })).toBeInTheDocument();
    });
  });

  it('shows the "Default" badge on the default-flagged row', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Default')).toBeInTheDocument();
    });
  });

  it('shows the "not wired yet" banner (S76 T5 — receipt printing does not read them yet)', async () => {
    renderPage();
    expect(await screen.findByTestId('templates-not-wired-banner')).toBeInTheDocument();
  });
});
