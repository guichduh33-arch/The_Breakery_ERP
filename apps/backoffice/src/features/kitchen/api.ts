import { supabase } from '@/lib/supabase.js';
import type { Database, Json } from '@breakery/supabase';

export type KitchenWasteReason = Database['public']['Enums']['waste_reason'];
export interface KitchenStation { id: string; name: string }
export interface KitchenProduct { id: string; name: string; unit: string; units: { code: string; factor: number }[] }
export interface KitchenItem {
  product_id: string; unit: string; quantity_produced: number; quantity_waste: number;
  waste_reason: KitchenWasteReason | ''; note: string;
}
export interface KitchenRequest { idempotency_key: string; section_id: string; day: string; items: KitchenItem[] }
export interface KitchenReceipt { batch_id: string; batch_number: string; idempotent_replay: boolean }
export interface KitchenRecord {
  id: string; production_date: string; production_number: string; product_name: string; unit: string;
  quantity_produced: number; quantity_waste: number; waste_reason: KitchenWasteReason | null;
  notes: string | null; reverted_at: string | null; author: string | null;
}
export interface KitchenAccess { enabled: boolean; sections: (KitchenStation & { assigned: boolean })[] }

export async function getStations(): Promise<KitchenStation[]> {
  const { data, error } = await supabase.rpc('get_kitchen_stations_v1');
  if (error) throw error;
  return data as unknown as KitchenStation[];
}
export async function getProducts(sectionId: string): Promise<KitchenProduct[]> {
  const { data, error } = await supabase.rpc('get_kitchen_products_v1', { p_section_id: sectionId });
  if (error) throw error;
  return data as unknown as KitchenProduct[];
}
export async function getHistory(sectionId: string, day: string, cursor: KitchenRecord | null): Promise<KitchenRecord[]> {
  const { data, error } = await supabase.rpc('get_kitchen_history_v1', {
    p_section_id: sectionId, p_day: day,
    ...(cursor ? { p_before_time: cursor.production_date, p_before_id: cursor.id } : {}),
  });
  if (error) throw error;
  return data as unknown as KitchenRecord[];
}
export async function submitProduction(request: KitchenRequest): Promise<KitchenReceipt> {
  const { data, error } = await supabase.rpc('record_kitchen_production_v1', { p_request: request as unknown as Json });
  if (error) throw error;
  return data as unknown as KitchenReceipt;
}
export async function resolveSubmission(key: string): Promise<KitchenReceipt | null> {
  const { data, error } = await supabase.rpc('get_kitchen_submission_v1', { p_idempotency_key: key });
  if (error) throw error;
  return data as unknown as KitchenReceipt | null;
}
export async function getAccess(userId: string): Promise<KitchenAccess> {
  const { data, error } = await supabase.rpc('get_user_kitchen_access_v1', { p_user_profile_id: userId });
  if (error) throw error;
  return data as unknown as KitchenAccess;
}
export async function saveAccess(userId: string, enabled: boolean, sectionIds: string[], reason: string): Promise<void> {
  const { error } = await supabase.rpc('set_user_kitchen_access_v1', {
    p_user_profile_id: userId, p_enabled: enabled, p_section_ids: sectionIds, p_reason: reason,
  });
  if (error) throw error;
}
export function kitchenError(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (message.includes('insufficient_stock')) return 'Not enough ingredients in stock. Ask an administrator to check the stock, then try again.';
  if (message.includes('today_only')) return 'This draft is from another day. Ask an administrator to record it for the correct date.';
  if (message.includes('forbidden')) return 'Your access or station assignment has changed. Ask a super admin to check your access.';
  if (message.includes('waste_reason')) return 'Choose a reason for every wasted quantity.';
  if (message.includes('recipe')) return 'A recipe is missing or cannot be used. Ask an administrator to check it.';
  if (message.includes('unit')) return 'A product unit has changed. Reload the products and check the quantities.';
  if (message.includes('quantity')) return 'Enter a positive produced quantity and a non-negative wasted quantity.';
  if (message.includes('idempotency')) return 'This submission does not match its saved request. Keep the draft and contact an administrator.';
  return 'Could not complete the request. Check your connection and try again.';
}
