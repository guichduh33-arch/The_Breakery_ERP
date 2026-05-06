// packages/domain/src/promotions/selectBestPromotion.ts
import type { Promotion } from './types.js';

export interface PromotionCandidate {
  promo: Promotion & { created_at?: string };
  discount: number;
}

export function selectBestPromotion(candidates: PromotionCandidate[]): PromotionCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (b.discount !== a.discount) return b.discount - a.discount;
    if (b.promo.priority !== a.promo.priority) return b.promo.priority - a.promo.priority;
    const ca = a.promo.created_at ?? '';
    const cb = b.promo.created_at ?? '';
    return ca.localeCompare(cb);
  });
  return sorted[0] ?? null;
}
