// apps/pos/src/features/kds/__tests__/PrepTimer.smoke.test.tsx
// Session 13 / Phase 4.B — RTL smoke for the prep-timer MM:SS display.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PrepTimer } from '../components/PrepTimer';

describe('PrepTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
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
});
