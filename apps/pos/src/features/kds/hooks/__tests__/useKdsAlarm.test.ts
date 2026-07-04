// apps/pos/src/features/kds/hooks/__tests__/useKdsAlarm.test.ts
//
// Session 59 (fiche 04 D1.3) — useKdsAlarm beeps (WebAudio) exactly once per
// newly-arrived order_id, never for tickets already on screen at mount, and
// stays silent while `kdsStore.alarmMuted` is true.
//
// Session 59 review (finding 2) — also covers the suspended→resume autoplay
// path: a freshly-loaded KDS starts its AudioContext `suspended` (no prior
// user gesture), so `.start()` alone would be a silent no-op.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { KdsItemRow } from '../useKdsOrders';

let mockAlarmMuted = false;

vi.mock('@/stores/kdsStore', () => ({
  useKdsStore: <T,>(selector: (s: { alarmMuted: boolean }) => T) =>
    selector({ alarmMuted: mockAlarmMuted }),
}));

import { useKdsAlarm } from '../useKdsAlarm';

function makeItem(overrides: Partial<KdsItemRow> = {}): KdsItemRow {
  return {
    id: 'oi-1',
    order_id: 'ord-1',
    product_id: 'prod-1',
    product_name: 'Americano',
    quantity: 1,
    unit_price: 35000,
    modifiers: [],
    modifiers_total: 0,
    kitchen_status: 'pending',
    dispatch_station: 'kitchen',
    dispatch_stations: null,
    sent_to_kitchen_at: new Date().toISOString(),
    ready_at: null,
    prep_started_at: null,
    order_number: '#A-001',
    order_status: 'pending_payment',
    order_notes: null,
    is_cancelled: false,
    cancelled_at: null,
    cancelled_reason: null,
    ...overrides,
  };
}

// Minimal WebAudio double — we only assert start()/oscillator wiring was
// invoked, not real audio output (jsdom has no audio backend).
class FakeOscillator {
  type = '';
  frequency = { value: 0 };
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeGain {
  gain = { value: 0 };
  connect = vi.fn();
}
class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  createOscillator = vi.fn(() => new FakeOscillator());
  createGain = vi.fn(() => new FakeGain());
  close = vi.fn().mockResolvedValue(undefined);
  resume = vi.fn().mockResolvedValue(undefined);
}

describe('useKdsAlarm', () => {
  let createOscillatorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAlarmMuted = false;
    createOscillatorSpy = vi.fn(() => new FakeOscillator());
    (window as unknown as { AudioContext: unknown }).AudioContext = vi
      .fn()
      .mockImplementation(() => {
        const ctx = new FakeAudioContext();
        ctx.createOscillator = createOscillatorSpy;
        return ctx;
      });
  });

  it('does not beep on the initial render (tickets already on screen at mount)', () => {
    const { rerender } = renderHook(({ items }) => useKdsAlarm(items), {
      initialProps: { items: [makeItem({ order_id: 'ord-1' })] },
    });

    expect(createOscillatorSpy).not.toHaveBeenCalled();

    // Same order, same render — still no beep.
    rerender({ items: [makeItem({ order_id: 'ord-1' })] });
    expect(createOscillatorSpy).not.toHaveBeenCalled();
  });

  it('beeps once when a brand-new order_id arrives', () => {
    const { rerender } = renderHook(({ items }) => useKdsAlarm(items), {
      initialProps: { items: [makeItem({ order_id: 'ord-1' })] },
    });

    rerender({
      items: [
        makeItem({ order_id: 'ord-1' }),
        makeItem({ id: 'oi-2', order_id: 'ord-2', order_number: '#A-002' }),
      ],
    });

    expect(createOscillatorSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-beep for the same order on a later refetch/poll (dedup)', () => {
    const { rerender } = renderHook(({ items }) => useKdsAlarm(items), {
      initialProps: { items: [makeItem({ order_id: 'ord-1' })] },
    });

    rerender({
      items: [
        makeItem({ order_id: 'ord-1' }),
        makeItem({ id: 'oi-2', order_id: 'ord-2', order_number: '#A-002' }),
      ],
    });
    expect(createOscillatorSpy).toHaveBeenCalledTimes(1);

    // Poll refetch returns the exact same 2 orders — no additional beep.
    rerender({
      items: [
        makeItem({ order_id: 'ord-1' }),
        makeItem({ id: 'oi-2', order_id: 'ord-2', order_number: '#A-002' }),
      ],
    });
    expect(createOscillatorSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent while alarmMuted is true, but still marks the order as seen', () => {
    mockAlarmMuted = true;
    const { rerender } = renderHook(({ items }) => useKdsAlarm(items), {
      initialProps: { items: [makeItem({ order_id: 'ord-1' })] },
    });

    rerender({
      items: [
        makeItem({ order_id: 'ord-1' }),
        makeItem({ id: 'oi-2', order_id: 'ord-2', order_number: '#A-002' }),
      ],
    });
    expect(createOscillatorSpy).not.toHaveBeenCalled();
  });

  // Session 59 review (finding 2) — suspended→resume autoplay path.
  it('resumes a suspended AudioContext before emitting the tone', async () => {
    const resumeMock = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { AudioContext: unknown }).AudioContext = vi
      .fn()
      .mockImplementation(() => {
        const ctx = new FakeAudioContext();
        ctx.state = 'suspended';
        ctx.resume = resumeMock;
        ctx.createOscillator = createOscillatorSpy;
        return ctx;
      });

    const { rerender } = renderHook(({ items }) => useKdsAlarm(items), {
      initialProps: { items: [makeItem({ order_id: 'ord-1' })] },
    });

    rerender({
      items: [
        makeItem({ order_id: 'ord-1' }),
        makeItem({ id: 'oi-2', order_id: 'ord-2', order_number: '#A-002' }),
      ],
    });

    expect(resumeMock).toHaveBeenCalledTimes(1);
    // The tone is deferred behind the resume() promise, not emitted synchronously.
    expect(createOscillatorSpy).not.toHaveBeenCalled();

    await waitFor(() => expect(createOscillatorSpy).toHaveBeenCalledTimes(1));
  });

  it('logs a single console.warn when resume() rejects, and never throws', async () => {
    // Isolated module instance so the internal "warned once" flag starts fresh
    // regardless of test order in this file.
    vi.resetModules();
    const { useKdsAlarm: freshUseKdsAlarm } = await import('../useKdsAlarm');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const resumeMock = vi.fn().mockRejectedValue(new Error('autoplay blocked'));
    (window as unknown as { AudioContext: unknown }).AudioContext = vi
      .fn()
      .mockImplementation(() => {
        const ctx = new FakeAudioContext();
        ctx.state = 'suspended';
        ctx.resume = resumeMock;
        ctx.createOscillator = createOscillatorSpy;
        return ctx;
      });

    const { rerender } = renderHook(({ items }) => freshUseKdsAlarm(items), {
      initialProps: { items: [makeItem({ order_id: 'ord-1' })] },
    });

    rerender({
      items: [
        makeItem({ order_id: 'ord-1' }),
        makeItem({ id: 'oi-2', order_id: 'ord-2', order_number: '#A-002' }),
      ],
    });

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1));
    expect(createOscillatorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
