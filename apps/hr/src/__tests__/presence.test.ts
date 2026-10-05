import { describe, expect, it } from 'vitest';
import { demoPresence } from '../features/presence';
import { employees, initialRequests } from '../model';
import { sampleWeek } from '../features/demoRules';
describe('demo presence', () => {
  it('follows confirmed clock and break events without counting offline punches', () => {
    const events = ['Masuk', 'Mulai istirahat', 'Selesai istirahat', 'Pulang'].map(label => ({ label, time: '06:30', synced: true }));
    expect(demoPresence(employees, sampleWeek, [], [])[0]?.status).toBe('Not clocked in');
    for (const [count, status] of [[1, 'On work'], [2, 'On break'], [3, 'On work'], [4, 'Clocked out']] as const)
      expect(demoPresence(employees, sampleWeek, [], events.slice(0, count))[0]?.status).toBe(status);
    const offline = demoPresence(employees, sampleWeek, [], [events[0]!, { ...events[1]!, synced: false }])[0];
    expect(offline?.status).toBe('On work'); expect(offline?.pending).toBe(1);
  });
  it('uses the schedule and only approved leave for the demo day', () => {
    const off = { ...sampleWeek, '001': ['OFF'] };
    expect(demoPresence(employees, off, [], [])[0]?.status).toBe('Day off');
    const leave = { ...initialRequests[0]!, date: '2026-10-05', status: 'approved' as const };
    expect(demoPresence(employees, sampleWeek, [leave], [])[0]?.status).toBe('On leave');
    expect(demoPresence(employees, sampleWeek, initialRequests, [])[0]?.status).toBe('Not clocked in');
    expect(demoPresence(employees, {}, [], [])[0]?.status).toBe('No schedule');
  });
});
