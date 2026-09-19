import { todayIsoDate } from '@breakery/utils';
import { isWasteReason } from '@/features/inventory-production/wasteReasons.js';
import type { KitchenRequest, KitchenWasteReason } from './api.js';

export interface KitchenRow {
  productId: string; name: string; unit: string; quantity: string; waste: string;
  wasteReason: KitchenWasteReason | ''; note: string;
}
export interface KitchenDraft {
  version: 1; userId: string; sectionId: string; day: string; rows: KitchenRow[]; pending: KitchenRequest | null;
}
const keyFor = (userId: string, sectionId: string) => `breakery:kitchen:draft:1:${userId}:${sectionId}`;
export function emptyDraft(userId: string, sectionId: string): KitchenDraft {
  return { version: 1, userId, sectionId, day: todayIsoDate(), rows: [], pending: null };
}
function isRow(value: unknown): value is KitchenRow {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return ['productId','name','unit','quantity','waste','note'].every(k => typeof r[k] === 'string')
    && (r.wasteReason === '' || (typeof r.wasteReason === 'string' && isWasteReason(r.wasteReason)));
}
export function requestFor(draft: KitchenDraft, key: string): KitchenRequest {
  return {
    idempotency_key: key, section_id: draft.sectionId, day: draft.day,
    items: draft.rows.map(r => ({ product_id: r.productId, unit: r.unit, quantity_produced: Number(r.quantity),
      quantity_waste: Number(r.waste), waste_reason: r.wasteReason, note: r.note })),
  };
}
export function readDraft(userId: string, sectionId: string): KitchenDraft {
  const raw = localStorage.getItem(keyFor(userId, sectionId));
  if (!raw) return emptyDraft(userId, sectionId);
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved draft');
  const d = value as KitchenDraft;
  if (d.version !== 1 || d.userId !== userId || d.sectionId !== sectionId || typeof d.day !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(d.day) || !Array.isArray(d.rows) || !d.rows.every(isRow)
    || (d.pending !== null && (!d.pending || typeof d.pending.idempotency_key !== 'string'
      || JSON.stringify(d.pending) !== JSON.stringify(requestFor(d, d.pending.idempotency_key))))) {
    throw new Error('Invalid saved draft');
  }
  return d;
}
export function writeDraft(draft: KitchenDraft): void {
  localStorage.setItem(keyFor(draft.userId, draft.sectionId), JSON.stringify(draft));
}
export function draftError(draft: KitchenDraft): string | null {
  if (draft.day !== todayIsoDate()) return 'This draft is from another day. Ask an administrator to record it for the correct date.';
  if (!draft.rows.length) return 'Add a product to record production.';
  for (const r of draft.rows) {
    if (!r.quantity.trim() || !r.waste.trim() || !Number.isFinite(Number(r.quantity)) || Number(r.quantity) <= 0
      || !Number.isFinite(Number(r.waste)) || Number(r.waste) < 0) return 'Enter valid quantities for every product.';
    if (Number(r.waste) > 0 && !isWasteReason(r.wasteReason)) return 'Choose a reason for every wasted quantity.';
  }
  return null;
}
