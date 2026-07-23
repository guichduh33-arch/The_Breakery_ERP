// apps/backoffice/src/features/settings/__tests__/settings-notifications-page.smoke.test.tsx
// S73 Lot 3 — smoke test for the system notification templates editor page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsNotificationsPage from '@/pages/settings/SettingsNotificationsPage.js';

const currentPerms = new Set<string>(['settings.read', 'notifications.send']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const MOCK_TEMPLATES = [
  {
    id: 'nt-1',
    code: 'order_complete',
    channel: 'email',
    subject_template: 'Order {{order_number}} is ready',
    body_template: 'Hi {{customer_name}}, your order is ready.',
    variables: ['order_number', 'customer_name', 'total'],
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'nt-2',
    code: 'low_stock_alert',
    channel: 'email',
    subject_template: '[Low stock] {{product_name}}',
    body_template: 'Inventory alert: {{product_name}} is low.',
    variables: ['product_name', 'current_stock', 'threshold', 'unit'],
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

interface RpcResult { data: unknown; error: { message: string } | null }

const updateCalls: { table: string; values: unknown; id: unknown }[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];

interface MockChain {
  select: () => MockChain;
  order:  () => Promise<RpcResult>;
  update: (values: unknown) => MockChain;
  eq:     (col: string, value: unknown) => MockChain;
  single: () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(): MockChain {
    let pendingValues: unknown = null;
    let pendingId: unknown = null;
    const chain: MockChain = {
      select: () => chain,
      order:  () => Promise.resolve({ data: MOCK_TEMPLATES, error: null }),
      update: (values: unknown) => { pendingValues = values; return chain; },
      eq:     (_col: string, value: unknown) => { pendingId = value; return chain; },
      single: () => {
        updateCalls.push({ table: 'notification_templates', values: pendingValues, id: pendingId });
        const updated = MOCK_TEMPLATES.find((t) => t.id === pendingId);
        return Promise.resolve({ data: { ...updated, ...(pendingValues as object) }, error: null });
      },
    };
    return chain;
  }
  return {
    supabase: {
      from: () => buildChain(),
      rpc: (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        if (fn === 'get_settings_by_category_v4') {
          return Promise.resolve({
            data: { category: 'business', settings: { alert_email: 'ops@breakery.id' } },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null }); // set_setting_v6
      },
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsNotificationsPage />
    </QueryClientProvider>,
  );
}

describe('SettingsNotificationsPage', () => {
  beforeEach(() => {
    currentPerms.clear();
    currentPerms.add('settings.read');
    currentPerms.add('notifications.send');
    updateCalls.length = 0;
    rpcCalls.length = 0;
  });

  it('renders the heading and one card per template', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Notifications/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /order_complete/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /low_stock_alert/i })).toBeInTheDocument();
    });
  });

  it('shows channel badges and variable chips', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('heading', { name: /order_complete/i }));
    expect(screen.getAllByText('email').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('order_number')).toBeInTheDocument();
    expect(screen.getByText('customer_name')).toBeInTheDocument();
  });

  it('disables the Active toggle and hides Save when the user lacks notifications.send', async () => {
    currentPerms.clear();
    currentPerms.add('settings.read');
    renderPage();
    await waitFor(() => screen.getByRole('heading', { name: /order_complete/i }));

    const toggles = screen.getAllByLabelText('Active');
    for (const toggle of toggles) {
      expect(toggle).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  // Settings §6.A — internal alert recipient (business_config.alert_email).
  it('renders the alert email card hydrated from the business category', async () => {
    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>('Alert email');
    await waitFor(() => expect(input.value).toBe('ops@breakery.id'));
    // Editing is gated settings.update, absent here → no Save button in the card.
    expect(screen.getByTestId('alert-email-card').querySelector('button')).toBeNull();
  });

  it('saves alert_email via set_setting_v6 (business category) with settings.update', async () => {
    currentPerms.add('settings.update');
    renderPage();
    const input = await screen.findByLabelText<HTMLInputElement>('Alert email');
    await waitFor(() => expect(input.value).toBe('ops@breakery.id'));
    fireEvent.change(input, { target: { value: 'alerts@breakery.id' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]!);
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.fn === 'set_setting_v6');
      expect(call?.args).toEqual({ p_key: 'alert_email', p_value: 'alerts@breakery.id', p_category: 'business' });
    });
  });

  it('calls notification_templates.update when a dirty template is saved', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('heading', { name: /order_complete/i }));

    const subjectInputs = screen.getAllByLabelText(/subject template/i);
    fireEvent.change(subjectInputs[0]!, { target: { value: 'Updated subject {{order_number}}' } });

    const saveButtons = screen.getAllByRole('button', { name: /save changes/i });
    fireEvent.click(saveButtons[0]!);

    await waitFor(() => expect(updateCalls.length).toBe(1));
    expect(updateCalls[0]?.values).toMatchObject({
      subject_template: 'Updated subject {{order_number}}',
    });
  });
});
