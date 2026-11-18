import { describe, expect, it } from 'vitest';
import { STALE_SESSION_THRESHOLD_MS, isSessionStale } from '../sessionAge';

const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function openedHoursAgo(hours: number): string {
  return new Date(NOW - hours * HOUR).toISOString();
}

describe('isSessionStale', () => {
  it('is true for a session open 25h', () => {
    expect(isSessionStale(openedHoursAgo(25), NOW)).toBe(true);
  });

  it('is false for a session open 23h', () => {
    expect(isSessionStale(openedHoursAgo(23), NOW)).toBe(false);
  });

  it('is false at exactly 24h (strictly greater)', () => {
    expect(isSessionStale(openedHoursAgo(24), NOW)).toBe(false);
  });

  it('is true one millisecond past 24h', () => {
    expect(isSessionStale(new Date(NOW - STALE_SESSION_THRESHOLD_MS - 1).toISOString(), NOW)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(isSessionStale(openedHoursAgo(3), NOW, 2 * HOUR)).toBe(true);
  });

  it('is false for an unparseable date', () => {
    expect(isSessionStale('not-a-date', NOW)).toBe(false);
  });
});
