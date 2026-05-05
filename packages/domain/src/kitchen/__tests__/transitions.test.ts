// packages/domain/src/kitchen/__tests__/transitions.test.ts
import { describe, it, expect } from 'vitest';
import { canTransition, nextStatus } from '../transitions';
import { KITCHEN_STATUSES, KDS_STATIONS } from '../types';

describe('canTransition', () => {
  it('allows pending → preparing', () => {
    expect(canTransition('pending', 'preparing')).toBe(true);
  });
  it('allows preparing → ready', () => {
    expect(canTransition('preparing', 'ready')).toBe(true);
  });
  it('allows ready → served', () => {
    expect(canTransition('ready', 'served')).toBe(true);
  });
  it('forbids ready → preparing', () => {
    expect(canTransition('ready', 'preparing')).toBe(false);
  });
  it('forbids ready → pending', () => {
    expect(canTransition('ready', 'pending')).toBe(false);
  });
  it('forbids pending → ready (must go through preparing)', () => {
    expect(canTransition('pending', 'ready')).toBe(false);
  });
  it('forbids pending → served (must go through intermediate statuses)', () => {
    expect(canTransition('pending', 'served')).toBe(false);
  });
  it('forbids served → ready (terminal)', () => {
    expect(canTransition('served', 'ready')).toBe(false);
  });
  it('forbids served → preparing (terminal)', () => {
    expect(canTransition('served', 'preparing')).toBe(false);
  });
  it('forbids served → pending (terminal)', () => {
    expect(canTransition('served', 'pending')).toBe(false);
  });
  it('forbids identity transitions', () => {
    for (const s of KITCHEN_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});

describe('nextStatus', () => {
  it('advances pending → preparing', () => {
    expect(nextStatus('pending')).toBe('preparing');
  });
  it('advances preparing → ready', () => {
    expect(nextStatus('preparing')).toBe('ready');
  });
  it('advances ready → served', () => {
    expect(nextStatus('ready')).toBe('served');
  });
  it('returns null when served (terminal)', () => {
    expect(nextStatus('served')).toBeNull();
  });
});

describe('KDS_STATIONS', () => {
  it('exposes the three real stations', () => {
    expect(KDS_STATIONS).toEqual(['kitchen', 'barista', 'bakery']);
  });
});
