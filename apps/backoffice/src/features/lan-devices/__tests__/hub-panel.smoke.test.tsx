// apps/backoffice/src/features/lan-devices/__tests__/hub-panel.smoke.test.tsx
// Spec 006x lot 1 — le panneau Hub couvre ses 3 états : joignable (devices +
// stats), bridge sans hub (enabled:false), bridge injoignable.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HubPanel } from '../components/HubPanel.js';

afterEach(() => vi.restoreAllMocks());

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HubPanel />
    </QueryClientProvider>,
  );
}

describe('HubPanel', () => {
  it('lists connected devices and buffer stats when the hub answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      enabled: true, version: '0.1.0', uptime_s: 3700, token_required: true,
      devices: [{
        device_code: 'POS-FRONT-01', device_type: 'pos', ip: '192.168.1.10',
        connected_at: '2026-07-19T10:00:00Z', last_seen_at: '2026-07-19T10:05:00Z',
      }],
      buffer: { count: 3, oldest_ts: 'a', newest_ts: 'b' },
    }), { status: 200 })));
    renderPanel();
    await waitFor(() => expect(screen.getByText('POS-FRONT-01')).toBeInTheDocument());
    expect(screen.getByText(/hub online/i)).toBeInTheDocument();
    expect(screen.getByText(/token required/i)).toBeInTheDocument();
    expect(screen.getByText(/3 messages/i)).toBeInTheDocument();
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument();
  });

  it('warns when the bridge has no hub support', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ enabled: false }), { status: 200 }),
    ));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/hub is disabled/i)).toBeInTheDocument());
  });

  it('shows the unreachable hint on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/hub unreachable/i)).toBeInTheDocument());
  });

  it('flags a token-less hub', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      enabled: true, version: '0.1.0', uptime_s: 60, token_required: false,
      devices: [], buffer: { count: 0, oldest_ts: null, newest_ts: null },
    }), { status: 200 })));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/no token/i)).toBeInTheDocument());
    expect(screen.getByText(/no device connected/i)).toBeInTheDocument();
  });
});
