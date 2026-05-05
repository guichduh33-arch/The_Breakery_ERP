// packages/domain/src/kitchen/transitions.ts
//
// Kitchen status state machine. v1 is forward-only; once `ready` an item is
// terminal until session 4 introduces "served".
//
// Allowed transitions:
//   pending   → preparing
//   preparing → ready
//   ready     → (none — terminal in v1)

import type { KitchenStatus } from './types.js';

const ALLOWED: Record<KitchenStatus, readonly KitchenStatus[]> = {
  pending: ['preparing'],
  preparing: ['ready'],
  ready: [],
};

/**
 * Returns true when transitioning `from` → `to` is permitted.
 * Identity transitions (`from === to`) are NOT considered transitions and
 * therefore return false.
 */
export function canTransition(from: KitchenStatus, to: KitchenStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Returns the natural next status, or `null` when the input is terminal.
 * Useful for the KDS "Bump" button which advances forward.
 */
export function nextStatus(from: KitchenStatus): KitchenStatus | null {
  return ALLOWED[from][0] ?? null;
}
