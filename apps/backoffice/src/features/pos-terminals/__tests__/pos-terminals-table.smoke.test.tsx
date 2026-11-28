// apps/backoffice/src/features/pos-terminals/__tests__/pos-terminals-table.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

interface Device {
  id: string; device_token: string; label: string; kind: string; is_registered: boolean;
  registered_at: string | null; first_seen_at: string; last_seen_at: string; is_active: boolean;
}
const till: Device = {
  id: 'dev-till', device_token: 'pd_75b45abcdef', label: 'Unregistered pd_75b45', kind: 'unknown',
  is_registered: false, registered_at: null, first_seen_at: hoursAgo(700), last_seen_at: hoursAgo(1), is_active: true,
};
const tablet: Device = {
  id: 'dev-tab', device_token: 'pd_d88a6abcdef', label: 'Tab A8', kind: 'tablet',
  is_registered: true, registered_at: hoursAgo(2), first_seen_at: hoursAgo(500), last_seen_at: hoursAgo(3), is_active: true,
};
const ghost: Device = {
  id: 'dev-ghost', device_token: 'pd_f4930abcdef', label: 'Unregistered pd_f4930', kind: 'unknown',
  is_registered: false, registered_at: null, first_seen_at: hoursAgo(1300), last_seen_at: hoursAgo(1200), is_active: true,
};

// Dernier acteur par terminal (ce que renverrait l'index device_seq desc).
const lastActor: Record<string, string> = { 'dev-till': 'u-bambang' };
interface EventQuery { deviceId?: string; order?: [string, unknown]; not?: unknown[]; limit?: number }

let devices: Device[] = [];
let deviceFetches = 0;
let eventQueries: EventQuery[] = [];
let inFlight = 0;
let maxInFlight = 0;
let failEvents = false;
let rpcError: { code: string; message: string } | null = null;
const rpcCalls: { fn: string; args: unknown }[] = [];

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pos_devices') {
        return { select: () => ({ order: () => { deviceFetches += 1; return Promise.resolve({ data: devices, error: null }); } }) };
      }
      if (table === 'pos_events') {
        const q: EventQuery = {};
        eventQueries.push(q);
        const chain = {
          select: () => chain,
          eq: (_c: string, v: string) => { q.deviceId = v; return chain; },
          not: (...args: unknown[]) => { q.not = args; return chain; },
          order: (col: string, opts: unknown) => { q.order = [col, opts]; return chain; },
          limit: (n: number) => {
            q.limit = n;
            inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
            return new Promise((resolve) => setTimeout(() => {
              inFlight -= 1;
              const actor = q.deviceId !== undefined ? lastActor[q.deviceId] : undefined;
              resolve(failEvents
                ? { data: null, error: { message: 'denied' } }
                : { data: actor !== undefined ? [{ actor_id: actor }] : [], error: null });
            }, 0));
          },
        };
        return chain;
      }
      if (table === 'user_profiles') {
        return { select: () => ({ in: () => Promise.resolve({ data: [{ id: 'u-bambang', full_name: 'Bambang' }], error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: rpcError === null ? 'id' : null, error: rpcError });
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PosTerminalsTable } from '../components/PosTerminalsTable.js';

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PosTerminalsTable /></QueryClientProvider>);
}

beforeEach(() => {
  devices = [till, tablet, ghost];
  deviceFetches = 0; eventQueries = []; inFlight = 0; maxInFlight = 0;
  failEvents = false; rpcError = null; rpcCalls.length = 0;
});

describe('PosTerminalsTable — liste', () => {
  it('affiche statut, type, ID court et dernier utilisateur', async () => {
    renderTable();
    const tillRow = (await screen.findByText('Unregistered pd_75b45')).closest('tr')!;
    expect(within(tillRow).getByText('Not named')).toBeInTheDocument();
    expect(within(tillRow).getByText('pd_75b45')).toBeInTheDocument();
    await waitFor(() => expect(within(tillRow).getByText('Bambang')).toBeInTheDocument());
    const tabRow = screen.getByText('Tab A8').closest('tr')!;
    expect(within(tabRow).getByText('Named')).toBeInTheDocument();
    expect(within(tabRow).getByText('Tablet')).toBeInTheDocument();
  });

  it('lit le dernier événement par terminal via device_seq décroissant, limit 1', async () => {
    renderTable();
    await screen.findByText('Bambang');
    const tillQuery = eventQueries.find((q) => q.deviceId === 'dev-till')!;
    expect(tillQuery.order).toEqual(['device_seq', { ascending: false }]);
    expect(tillQuery.not).toEqual(['device_seq', 'is', null]);
    expect(tillQuery.limit).toBe(1);
  });

  it('masque les terminaux non vus depuis 30 jours, et « Show all » les rend', async () => {
    renderTable();
    await screen.findByText('Unregistered pd_75b45');
    expect(screen.queryByText('Unregistered pd_f4930')).toBeNull();
    expect(screen.getByText('Showing 2 of 3 terminals seen in the last 30 days.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('Unregistered pd_f4930')).toBeInTheDocument();
  });

  it('garde la liste si le repère du dernier utilisateur échoue', async () => {
    failEvents = true;
    renderTable();
    const tillRow = (await screen.findByText('Unregistered pd_75b45')).closest('tr')!;
    await waitFor(() => expect(eventQueries.length).toBeGreaterThan(0));
    expect(within(tillRow).queryByText('Bambang')).toBeNull();
  });

  it('ne cherche le repère que pour les 20 plus récents, 4 lectures à la fois', async () => {
    devices = Array.from({ length: 25 }, (_, i) => ({
      ...till, id: `dev-${i}`, device_token: `pd_${String(i).padStart(5, '0')}xyz`, label: `Unregistered ${i}`,
    }));
    renderTable();
    await screen.findByText('Unregistered 24');
    expect(eventQueries.map((q) => q.deviceId)).toEqual(Array.from({ length: 20 }, (_, i) => `dev-${i}`));
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});

describe('PosTerminalsTable — renommage', () => {
  it('nomme un terminal inconnu après le choix d’un type, puis recharge la liste', async () => {
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename pd_75b45' }));
    const input = screen.getByRole('textbox', { name: 'Name for pd_75b45' });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Main till' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name for pd_75b45' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a type.');
    expect(rpcCalls).toEqual([]);

    fireEvent.change(screen.getByRole('combobox', { name: 'Type for pd_75b45' }), { target: { value: 'counter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name for pd_75b45' }));
    await waitFor(() => expect(rpcCalls).toHaveLength(1));
    expect(rpcCalls[0]).toEqual({
      fn: 'register_pos_device_v1',
      args: { p_device_token: 'pd_75b45abcdef', p_label: 'Main till', p_kind: 'counter' },
    });
    await waitFor(() => expect(deviceFetches).toBe(2));
    expect(await screen.findByRole('button', { name: 'Rename pd_75b45' })).toBeInTheDocument();
  });

  it('préremplit le nom et le type d’un terminal déjà nommé', async () => {
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename pd_d88a6' }));
    expect(screen.getByRole('textbox', { name: 'Name for pd_d88a6' })).toHaveValue('Tab A8');
    expect(screen.getByRole('combobox', { name: 'Type for pd_d88a6' })).toHaveValue('tablet');
  });

  it('refuse un nom vide sans appeler le serveur', async () => {
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename pd_d88a6' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name for pd_d88a6' }), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name for pd_d88a6' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.');
    expect(screen.getByRole('textbox', { name: 'Name for pd_d88a6' })).toHaveAttribute('aria-invalid', 'true');
    expect(rpcCalls).toEqual([]);
  });

  it('affiche le refus serveur et garde l’édition ouverte', async () => {
    rpcError = { code: '42501', message: 'permission denied' };
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename pd_d88a6' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save name for pd_d88a6' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to rename terminals.');
    expect(screen.getByRole('textbox', { name: 'Name for pd_d88a6' })).toBeInTheDocument();
    expect(deviceFetches).toBe(1);
  });

  it('Cancel referme l’édition sans appel et rend le focus au bouton', async () => {
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename pd_d88a6' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel renaming pd_d88a6' }));
    const renameBtn = screen.getByRole('button', { name: 'Rename pd_d88a6' });
    expect(renameBtn).toHaveFocus();
    expect(rpcCalls).toEqual([]);
  });
});
