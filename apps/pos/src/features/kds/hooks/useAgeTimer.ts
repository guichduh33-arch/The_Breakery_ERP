// apps/pos/src/features/kds/hooks/useAgeTimer.ts
//
// Shared tick-every-`periodMs` hook so age timers stay fresh without every
// consumer owning its own `setInterval`.
//
// Before this refactor each call site created its own `setInterval` even
// though the comment already promised a shared tick: a KdsOrderCard PLUS
// its PrepTimer per line item both called `useAgeTimer()` independently, so
// a rush of ~10 tickets with a few items each meant ~30-45 live intervals
// all doing the identical `setNow(Date.now())` every second. Consumers that
// ask for the SAME `periodMs` (the default 1s tick used by KdsOrderCard and
// PrepTimer, or KdsBoard's own 15s archive tick) now share ONE underlying
// interval, ref-counted per period: the first mount at a given period starts
// it, the last unmount at that period stops it. Visible behaviour (MM:SS
// advancing every second) is unchanged.
//
// Deliberately plain `useState`/`useEffect`, NOT `useSyncExternalStore`: an
// earlier version used `useSyncExternalStore`, which passed every mocked
// unit test but caused a real infinite render loop ("Maximum update depth
// exceeded") once exercised inside the full, unmocked KDS tree
// (`src/__tests__/kds.smoke.test.tsx`, `kds-served.smoke.test.tsx`) — React's
// post-commit snapshot-consistency recheck (`updateStoreInstance` /
// `forceStoreRerender`) kept re-firing. Plain local state, fed by the shared
// interval via a normal `setState` call, sidesteps that mechanism entirely.

import { useEffect, useState } from 'react';

interface ClockEntry {
  now: number;
  intervalId: number | null;
  listeners: Set<(now: number) => void>;
}

// Module-scoped on purpose: this is the shared clock. One entry per distinct
// `periodMs` in use, not one per component instance.
const clocks = new Map<number, ClockEntry>();

function ensureEntry(periodMs: number): ClockEntry {
  let entry = clocks.get(periodMs);
  if (!entry) {
    entry = { now: Date.now(), intervalId: null, listeners: new Set() };
    clocks.set(periodMs, entry);
  }
  return entry;
}

function subscribe(periodMs: number, listener: (now: number) => void): () => void {
  const entry = ensureEntry(periodMs);
  entry.listeners.add(listener);
  if (entry.intervalId === null) {
    entry.intervalId = window.setInterval(() => {
      entry.now = Date.now();
      entry.listeners.forEach((l) => l(entry.now));
    }, periodMs);
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.intervalId !== null) {
      window.clearInterval(entry.intervalId);
      clocks.delete(periodMs);
    }
  };
}

export function useAgeTimer(periodMs = 1_000): number {
  const [now, setNow] = useState(() => ensureEntry(periodMs).now);

  useEffect(() => {
    // The shared clock may have ticked between this component's first
    // render and this effect running (or the entry may already exist with
    // a newer value from another consumer) — resync once on mount/period
    // change, then follow the shared tick.
    setNow(ensureEntry(periodMs).now);
    return subscribe(periodMs, setNow);
  }, [periodMs]);

  return now;
}
