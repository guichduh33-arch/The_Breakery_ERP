// apps/pos/src/features/kds/__tests__/PrepTimer.smoke.test.tsx
// Session 13 / Phase 4.B — RTL smoke for the prep-timer MM:SS display.
//
// P2 finding — thresholds now come from `useKdsConfig()` instead of the old
// hardcoded FIVE_MIN_MS/TEN_MIN_MS constants, so the same ticket's border
// (KdsOrderCard) and prep timer escalate together. Mocked here to isolate
// the component from `@tanstack/react-query` (no QueryClientProvider in
// this file) and to prove the colour class actually reacts to config, not
// to the old baked-in 5/10 min values.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PrepTimer } from '../components/PrepTimer';

let mockConfig = { warningMs: 300_000, urgentMs: 600_000, archiveMs: 300_000 };
vi.mock('../hooks/useKdsConfig', () => ({
  useKdsConfig: () => mockConfig,
}));

describe('PrepTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
    mockConfig = { warningMs: 300_000, urgentMs: 600_000, archiveMs: 300_000 };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders --:-- when prepStartedAt is null', () => {
    render(<PrepTimer prepStartedAt={null} />);
    expect(screen.getByLabelText(/prep timer not started/i).textContent).toBe('--:--');
  });

  it('renders MM:SS elapsed since prepStartedAt', () => {
    // 2 min 35 sec ago
    const started = new Date('2026-05-14T11:57:25.000Z').toISOString();
    render(<PrepTimer prepStartedAt={started} />);
    // The component reads now() at first render — should be 02:35.
    expect(screen.getByLabelText(/Prep elapsed/i).textContent).toBe('02:35');
  });

  it('clamps negative elapsed to 00:00', () => {
    // Future timestamp — guard against clock drift.
    const future = new Date('2026-05-14T12:05:00.000Z').toISOString();
    render(<PrepTimer prepStartedAt={future} />);
    expect(screen.getByLabelText(/Prep elapsed/i).textContent).toBe('00:00');
  });

  it('escalates colour at the useKdsConfig warning/urgent thresholds, not the old hardcoded 5/10 min', () => {
    // Custom, deliberately NOT 5min/10min — proves the value is read from
    // config, not from a constant baked into PrepTimer.
    mockConfig = { warningMs: 60_000, urgentMs: 120_000, archiveMs: 300_000 };

    const twoMinAgo = new Date('2026-05-14T11:58:00.000Z').toISOString();
    render(<PrepTimer prepStartedAt={twoMinAgo} />);
    const timer = screen.getByLabelText(/Prep elapsed/i);
    expect(timer.textContent).toBe('02:00');
    expect(timer.className).toMatch(/text-red-as-text/);
  });

  it('stays neutral under a custom warning threshold that the old 5min default would have escalated past', () => {
    mockConfig = { warningMs: 600_000, urgentMs: 900_000, archiveMs: 300_000 };

    // 6 minutes ago — would be "warning" under the old hardcoded 5min
    // constant, but must stay neutral once the config threshold is 10min.
    const sixMinAgo = new Date('2026-05-14T11:54:00.000Z').toISOString();
    render(<PrepTimer prepStartedAt={sixMinAgo} />);
    const timer = screen.getByLabelText(/Prep elapsed/i);
    expect(timer.textContent).toBe('06:00');
    expect(timer.className).toMatch(/text-text-secondary/);
    expect(timer.className).not.toMatch(/text-amber-warn/);
    expect(timer.className).not.toMatch(/text-red-as-text/);
  });
});
