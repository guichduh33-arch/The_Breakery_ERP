import { useAuthStore } from '@/stores/authStore.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import type { DuplicateExpenseSeed } from '../components/ExpenseForm.js';

// L'historique ne reçoit qu'un identifiant opaque ; aucune description ni montant.
export interface ExpenseDraftNavigationState {expenseDraftTicket: string}
let entry: {ticket: string; seed: DuplicateExpenseSeed | undefined; current: () => boolean} | null = null;
let unsubscribe: (() => void) | undefined;
export function clearExpenseDraftNavigation(ticket: string): void {
  if (entry?.ticket !== ticket) return;
  entry = null; unsubscribe?.(); unsubscribe = undefined;
}
export function prepareExpenseDraftNavigation(seed?: DuplicateExpenseSeed): ExpenseDraftNavigationState {
  const session = captureFinancialSession();
  if (!session.current()) throw new Error('Sign in before creating an expense.');
  unsubscribe?.();
  const ticket = crypto.randomUUID();
  entry = {ticket, seed, current: session.current};
  unsubscribe = useAuthStore.subscribe(() => {
    if (entry?.ticket === ticket && !session.current()) clearExpenseDraftNavigation(ticket);
  });
  return {expenseDraftTicket: ticket};
}
export function readExpenseDraftSeed(ticket: string | undefined): DuplicateExpenseSeed | undefined {
  if (!ticket || entry?.ticket !== ticket) return undefined;
  if (!entry.current()) {clearExpenseDraftNavigation(ticket); return undefined;}
  return entry.seed;
}
