// apps/pos/src/features/kds/hooks/__tests__/useKdsAlarm.test.ts
//
// Session 59 (fiche 04 D1.3) — useKdsAlarm beeps (WebAudio) exactly once per
// newly-arrived order_id, never for tickets already on screen at mount, and
// stays silent while `kdsStore.alarmMuted` is true.
//
// Session 59 review (finding 2) — also covers the suspended→resume autoplay
// path: a freshly-loaded KDS starts its AudioContext `suspended` (no prior
// user gesture), so `.start()` alone would be a silent no-op.
//
// Design Wave C (2026-07-07) — the new-order beep is now a TWO-note motif
// (2 oscillators) and a separate periodic TRIPLE-note re-bip nags while an
// urgent unbumped order lingers. Tone counts below reflect the motif lengths.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import type { KdsItemRow } from '../useKdsOrders';

/** New-order motif = 2 tones; urgent re-bip = 3 tones (see useKdsAlarm.ts). */
const NEW_ORDER_TONES = 2;
const URGENT_TONES = 3;
const REBEEP_INTERVAL_MS = 25 * 1_000;

let mockAlarmMuted = false;

vi.mock('@/stores/kdsStore', () => ({
  useKdsStore: <T,>(selector: (s: { alarmMuted: boolean }) => T) =>
    selector({ alarmMuted: mockAlarmMuted }),
}));

// S75 (task 6) — useKdsAlarm now reads urgentMs via useKdsConfig() (a
// useQuery hook, which would otherwise need a QueryClientProvider wrapper
// here). Mocked to the same 600s default the old URGENT_THRESHOLD_MS
// constant used, so URGENT_SENT (12min ago) below stays past the band.
vi.mock('../useKdsConfig', () => ({
  useKdsConfig: () => ({ warningMs: 300_000, urgentMs: 600_000, archiveMs: 300_000 }),
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
    kds_station: null,
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

  it('plays the new-order motif once when a brand-new order_id arrives', () => {
    const { rerender } = renderHook(({ items }) => useKdsAlarm(items), {
      initialProps: { items: [makeItem({ order_id: 'ord-1' })] },
    });

    rerender({
      items: [
        makeItem({ order_id: 'ord-1' }),
        makeItem({ id: 'oi-2', order_id: 'ord-2', order_number: '#A-002' }),
      ],
    });

    expect(createOscillatorSpy).toHaveBeenCalledTimes(NEW_ORDER_TONES);
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
    expect(createOscillatorSpy).toHaveBeenCalledTimes(NEW_ORDER_TONES);

    // Poll refetch returns the exact same 2 orders — no additional beep.
    rerender({
      items: [
        makeItem({ order_id: 'ord-1' }),
        makeItem({ id: 'oi-2', order_id: 'ord-2', order_number: '#A-002' }),
      ],
    });
    expect(createOscillatorSpy).toHaveBeenCalledTimes(NEW_ORDER_TONES);
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

    await waitFor(() => expect(createOscillatorSpy).toHaveBeenCalledTimes(NEW_ORDER_TONES));
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

  // Design Wave C — periodic urgent re-bip.
  describe('urgent re-bip', () => {
    const NOW = new Date('2026-07-07T10:00:00Z');
    // 12 minutes old → past the 600 s urgent band.
    const URGENT_SENT = new Date('2026-07-07T09:48:00Z').toISOString();

    it('re-bips every interval while an urgent unbumped order lingers, and stops once bumped', () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);

      const urgent = makeItem({
        order_id: 'ord-1',
        kitchen_status: 'preparing',
        sent_to_kitchen_at: URGENT_SENT,
      });
      const { rerender, unmount } = renderHook(({ items }) => useKdsAlarm(items), {
        initialProps: { items: [urgent] },
      });

      // Seeding the board must not fire the new-order motif.
      expect(createOscillatorSpy).not.toHaveBeenCalled();

      // One interval → one urgent triple.
      act(() => {
        vi.advanceTimersByTime(REBEEP_INTERVAL_MS);
      });
      expect(createOscillatorSpy).toHaveBeenCalledTimes(URGENT_TONES);

      // Another interval → another triple (it keeps nagging).
      act(() => {
        vi.advanceTimersByTime(REBEEP_INTERVAL_MS);
      });
      expect(createOscillatorSpy).toHaveBeenCalledTimes(URGENT_TONES * 2);

      // Order is bumped (all items ready) → the re-bip goes quiet.
      rerender({ items: [makeItem({ order_id: 'ord-1', kitchen_status: 'ready' })] });
      act(() => {
        vi.advanceTimersByTime(REBEEP_INTERVAL_MS);
      });
      expect(createOscillatorSpy).toHaveBeenCalledTimes(URGENT_TONES * 2);

      unmount();
      vi.useRealTimers();
    });

    it('stays silent when muted, even for an urgent order', () => {
      mockAlarmMuted = true;
      vi.useFakeTimers();
      vi.setSystemTime(NOW);

      renderHook(() =>
        useKdsAlarm([
          makeItem({
            order_id: 'ord-1',
            kitchen_status: 'preparing',
            sent_to_kitchen_at: URGENT_SENT,
          }),
        ]),
      );

      act(() => {
        vi.advanceTimersByTime(REBEEP_INTERVAL_MS * 3);
      });
      expect(createOscillatorSpy).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('does not re-bip for a fresh order below the urgent band', () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);

      renderHook(() =>
        useKdsAlarm([
          makeItem({
            order_id: 'ord-1',
            kitchen_status: 'preparing',
            sent_to_kitchen_at: NOW.toISOString(),
          }),
        ]),
      );

      act(() => {
        vi.advanceTimersByTime(REBEEP_INTERVAL_MS * 3);
      });
      expect(createOscillatorSpy).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
