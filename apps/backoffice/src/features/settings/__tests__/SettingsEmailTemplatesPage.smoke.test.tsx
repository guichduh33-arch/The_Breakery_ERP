// apps/backoffice/src/features/settings/__tests__/SettingsEmailTemplatesPage.smoke.test.tsx
// Session 13 / Phase 5.C — Smoke test for the email templates editor page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsEmailTemplatesPage from '@/pages/settings/SettingsEmailTemplatesPage.js';

const currentPerms = new Set<string>(['settings.read', 'settings.update']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const MOCK_TEMPLATES = [
  { id: 'em-1', code: 'welcome',          subject: 'Welcome, {{customer_name}}',  body_html: '<p>Hi</p>', body_text: 'Hi',  variables: ['{{customer_name}}'], is_active: true,  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: 'em-2', code: 'order_complete',   subject: 'Order #{{order_number}}',     body_html: '<p>O</p>',  body_text: 'O',   variables: ['{{order_number}}'],  is_active: true,  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

interface RpcResult { data: unknown; error: { message: string } | null }

interface MockChain {
  select: () => MockChain;
  order:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(): MockChain {
    const chain: MockChain = {
      select: () => chain,
      order:  () => Promise.resolve({ data: MOCK_TEMPLATES, error: null }),
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
      <SettingsEmailTemplatesPage />
    </QueryClientProvider>,
  );
}

describe('SettingsEmailTemplatesPage', () => {
  beforeEach(() => {
    currentPerms.clear();
    currentPerms.add('settings.read');
    currentPerms.add('settings.update');
  });

  it('renders the heading and one section per template', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Email templates/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^Welcome$/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Order complete/i })).toBeInTheDocument();
    });
  });

  it('shows the active badge for each seeded template', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders the preview pane with substituted variables', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('heading', { name: /^Welcome$/i }));
    // The Welcome template has subject "Welcome, {{customer_name}}" and one var.
    // The preview shows "Welcome, [customer_name]" once vars are substituted.
    expect(screen.getByText(/Welcome, \[customer_name\]/i)).toBeInTheDocument();
  });

  it('shows the "not wired yet" banner (S76 T5 — no email is sent by the system yet)', async () => {
    renderPage();
    expect(await screen.findByTestId('templates-not-wired-banner')).toBeInTheDocument();
  });
});
