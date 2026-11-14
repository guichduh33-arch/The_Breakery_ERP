import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFinancialAttempts, FinancialAttemptError } from '@breakery/utils';
import type { FinancialAttemptSlot } from '@breakery/utils';
import type { Json } from '@breakery/supabase';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { isDisplayQuantity } from '../quantity';
import { isValidWasteNote, isWasteReason, MIN_WASTE_NOTE, type WasteReason } from '../wasteReasons';

/** S1-18 — une ligne porte un motif de la liste fermée et une note facultative. */
export interface DisplayDayItem {
  product_id: string;
  remaining_qty: number;
  waste_qty: number;
  waste_reason: WasteReason | null;
  waste_note: string | null;
}
/**
 * Forme d'avant la liste fermée : motif en texte libre, sans note. Une caisse
 * mise à jour peut encore garder une tentative en attente sous cette forme ;
 * elle reste lisible pour ne jamais perdre en silence un comptage non confirmé.
 */
interface LegacyDisplayDayItem {
  product_id: string;
  remaining_qty: number;
  waste_qty: number;
  waste_reason: string | null;
}
/** Ligne d'un comptage enregistré : `waste_reason` y est un TEXTE (note, sinon code, sinon ancien texte libre). */
export interface RecordedDisplayDayItem {
  product_id: string;
  remaining_qty: number;
  waste_qty: number;
  waste_reason: string | null;
  product_name: string;
  unit: string;
  waste_status: string | null;
}
export interface DisplayDayRecord {
  closing_id: string;
  business_day: string;
  revision: number;
  recorded_by: string;
  recorded_at: string;
  items: RecordedDisplayDayItem[];
  history: { revision: number; recorded_at: string; correction_reason: string | null }[];
}
export interface ClosingAttempt {
  businessDay: string;
  items: DisplayDayItem[];
  closingId: string | null;
  correctionReason: string;
}
/** Tentative telle que relue du stockage : nouvelle forme, ou ancienne forme encore en attente. */
interface StoredClosingAttempt extends Omit<ClosingAttempt, 'items'> {
  items: (DisplayDayItem | LegacyDisplayDayItem)[];
}
interface Operations { 'display-day-count': StoredClosingAttempt }
const operation = 'display-day-count' as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
type ItemCheck = (item: Record<string, unknown>, correction: boolean) => boolean;
function baseItem(item: Record<string, unknown>): boolean {
  return typeof item.product_id === 'string' && uuid.test(item.product_id)
    && typeof item.remaining_qty === 'number' && isDisplayQuantity(item.remaining_qty)
    && typeof item.waste_qty === 'number' && isDisplayQuantity(item.waste_qty);
}
const own = (item: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(item, key);
/** Nouvelle forme, mêmes règles que le serveur. Une correction ne renvoie que les restes : ses motifs sont vides. */
const currentItem: ItemCheck = (item, correction) => {
  if (!baseItem(item) || !own(item, 'waste_note')) return false;
  const reason = item.waste_reason;
  const note = item.waste_note;
  if ((reason !== null && !isWasteReason(reason)) || (note !== null && typeof note !== 'string')) return false;
  if (correction || item.waste_qty === 0) return reason === null && note === null;
  return reason !== null && isValidWasteNote(reason, note ?? '');
};
/** Ancienne forme : texte libre d'au moins 3 caractères pour une perte, aucune note. */
const legacyItem: ItemCheck = (item) => baseItem(item) && !own(item, 'waste_note')
  && (item.waste_reason === null || typeof item.waste_reason === 'string')
  && (item.waste_qty === 0 || (typeof item.waste_reason === 'string' && item.waste_reason.trim().length >= MIN_WASTE_NOTE));
function validAttempt(target: string, value: unknown, check: ItemCheck): boolean {
  if (!record(value) || value.businessDay !== target || !/^\d{4}-\d{2}-\d{2}$/.test(target)
    || !Array.isArray(value.items) || value.items.length === 0 || value.items.length > 500
    || typeof value.correctionReason !== 'string'
    || (value.closingId !== null && (typeof value.closingId !== 'string' || !uuid.test(value.closingId)
      || value.correctionReason.trim().length < 3))) return false;
  const correction = value.closingId !== null;
  const ids = new Set<string>();
  return value.items.every((item: unknown) => {
    if (!record(item) || !check(item, correction) || ids.has(item.product_id as string)) return false;
    ids.add(item.product_id as string);
    return true;
  });
}
/** Une tentative NEUVE n'est acceptée que sous la nouvelle forme. */
function validPayload(target: string, value: unknown): value is ClosingAttempt {
  return validAttempt(target, value, currentItem);
}
/** Une tentative RELUE en attente peut être sous l'une ou l'autre forme, sans mélange. */
function validStoredPayload(target: string, value: unknown): value is StoredClosingAttempt {
  return validPayload(target, value) || validAttempt(target, value, legacyItem);
}
function isLegacyItem(item: DisplayDayItem | LegacyDisplayDayItem): item is LegacyDisplayDayItem {
  return !Object.prototype.hasOwnProperty.call(item, 'waste_note');
}
/**
 * Ancienne ligne relue : un texte égal à un code reprend ce code ; tout autre
 * texte devient le motif `other` avec ce texte en note. Rien n'est perdu, et la
 * reprise respecte la règle du serveur (`other` exige une note de 3 caractères).
 */
function upgradeItem(item: DisplayDayItem | LegacyDisplayDayItem): DisplayDayItem {
  if (!isLegacyItem(item)) return item;
  const base = { product_id: item.product_id, remaining_qty: item.remaining_qty, waste_qty: item.waste_qty };
  const text = item.waste_reason?.trim() ?? '';
  if (item.waste_qty === 0 || text === '') return { ...base, waste_reason: null, waste_note: null };
  if (isWasteReason(text)) return { ...base, waste_reason: text, waste_note: null };
  return { ...base, waste_reason: 'other', waste_note: text };
}
export function upgradeAttempt(saved: StoredClosingAttempt): ClosingAttempt {
  return { ...saved, items: saved.items.map(upgradeItem) };
}
const attempts = createFinancialAttempts<Operations>({
  validPayload: (_operation, target, value) => validPayload(target, value),
  validSlot: (value, scope) => record(value) && value.version === 1
    && value.operation === scope.operation && value.target === scope.target
    && typeof value.revision === 'string' && uuid.test(value.revision)
    && (value.status === 'resolved' || (value.status === 'pending'
      && typeof value.idempotencyKey === 'string' && uuid.test(value.idempotencyKey)
      && validStoredPayload(scope.target, value.payload))),
});

export function displayDayError(message: string): string {
  if (message.includes('display_day_already_submitted')) return 'A count has already been recorded for this day. Reload it to review or correct the remaining quantities.';
  if (message.includes('display_count_changed_reload')) return 'This count changed. Reload it before recording a correction.';
  if (message.includes('insufficient_display_stock')) return 'The waste quantity could not be recorded. Check the product and quantity.';
  if (message.includes('invalid_display_quantity_or_reason')) return 'Each waste needs a reason from the list, and "Other" needs a note of at least 3 characters. Check the quantities, reasons and notes.';
  if (message.includes('idempotency_conflict')) return 'This count was already recorded with different details. Ask a manager to review the recorded count for this day.';
  if (message.includes('business_day') || message.includes('invalid_display_day')) return 'Choose today or the previous business day.';
  if (message.includes('permission_denied') || message.includes('count_author_required')) return 'You do not have permission to record this count.';
  return message;
}

export function useDisplayDayClosing(businessDay: string) {
  const qc = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.sessionToken);
  const canCount = useAuthStore((state) => state.hasPermission('display.count'));
  const scope = useMemo(() => ({ environment: supabaseUrl, profileId: user?.id ?? '', operation, target: businessDay }), [user?.id, businessDay]);
  const [slot, setSlot] = useState<FinancialAttemptSlot<StoredClosingAttempt, typeof operation> | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const refreshSlot = useCallback(() => {
    try { setSlot(attempts.readFinancialSlot(scope)); setStorageError(null); }
    catch (error) { setStorageError(error instanceof Error ? error.message : 'Recovery storage is unavailable.'); }
  }, [scope]);
  useEffect(() => {
    refreshSlot();
    const listener = () => refreshSlot();
    window.addEventListener('storage', listener);
    window.addEventListener('financial-attempt-change', listener);
    return () => {
      window.removeEventListener('storage', listener);
      window.removeEventListener('financial-attempt-change', listener);
    };
  }, [refreshSlot]);
  const query = useQuery({
    queryKey: ['display-day-closing', user?.id, businessDay],
    enabled: !!user && canCount && /^\d{4}-\d{2}-\d{2}$/.test(businessDay),
    queryFn: async (): Promise<DisplayDayRecord | null> => {
      const { data, error } = await supabase.rpc('get_display_day_closing_v1', { p_business_day: businessDay });
      if (error) throw new Error(displayDayError(error.message));
      if (data === null) return null;
      if (!record(data) || data.business_day !== businessDay || typeof data.closing_id !== 'string'
        || !Array.isArray(data.items) || !Array.isArray(data.history)) throw new Error('The recorded count response was invalid.');
      return data as unknown as DisplayDayRecord;
    },
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (payload: ClosingAttempt) => {
      if (!canCount || !user || storageError) throw new FinancialAttemptError('This count cannot be submitted. Check your session and recovery storage.');
      const current = () => {
        const auth = useAuthStore.getState();
        return auth.user?.id === user.id && auth.sessionToken === token && auth.isAuthenticated && !auth.isLocked;
      };
      return attempts.runFinancialAttempt({ scope, expectedRevision: slot?.revision ?? null, payload, current,
        send: async (saved, key) => {
          // Une tentative relue sous l'ancienne forme part sous la nouvelle, avec la même clé.
          const attempt = upgradeAttempt(saved);
          const response = attempt.closingId === null
            ? await supabase.rpc('submit_display_day_closing_v2', { p_business_day: attempt.businessDay,
              p_items: attempt.items as unknown as Json, p_idempotency_key: key })
            : await supabase.rpc('correct_display_day_count_v1', { p_closing_id: attempt.closingId,
              p_counts: attempt.items.map((item) => ({ product_id: item.product_id, remaining_qty: item.remaining_qty })),
              p_reason: attempt.correctionReason, p_idempotency_key: key });
          if (!current()) throw new FinancialAttemptError('Your session changed. Reopen the count.');
          if (response.error) throw new FinancialAttemptError(displayDayError(response.error.message),
            ['22023', 'P0002', 'P0003', '23505'].includes(response.error.code));
          const result = response.data;
          if (!record(result) || typeof result.closing_id !== 'string' || !uuid.test(result.closing_id)
            || result.business_day !== attempt.businessDay || typeof result.revision !== 'number'
            || typeof result.idempotent_replay !== 'boolean') throw new FinancialAttemptError('The result is unconfirmed. Retry this same count.');
          return result;
        },
      });
    },
    onSettled: async () => {
      refreshSlot();
      await qc.invalidateQueries({ queryKey: ['display-day-closing', user?.id, businessDay] });
      await qc.invalidateQueries({ queryKey: ['pos-stock-products'] });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const pending = useMemo(() => slot?.status === 'pending' ? upgradeAttempt(slot.payload) : null, [slot]);
  return { query, mutation, canCount, storageError, pending };
}
