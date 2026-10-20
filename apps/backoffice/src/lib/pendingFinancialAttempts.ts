import { createFinancialAttempts } from '@breakery/utils';
import { validPayload, validSlot, type FinancialPayloads } from './pendingFinancialAttemptSchema.js';
export { FinancialAttemptError, PENDING_MESSAGE, financialStorageKey, subscribeFinancialAttempts } from '@breakery/utils';
export type { FinancialOperation, FinancialPayloads, FinancialScope, FinancialSlot } from './pendingFinancialAttemptSchema.js';

export const { readFinancialSlot, pendingFinancialTargets, runFinancialAttempt } =
  createFinancialAttempts<FinancialPayloads>({ validPayload, validSlot });
