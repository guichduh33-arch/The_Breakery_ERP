// Fixtures dev : deux acteurs distincts, droits temporaires et produit dédié.
import { createClient } from '@supabase/supabase-js';
import { jwtClient, loginAs, SERVICE_KEY, SUPABASE_URL } from './auth';
import { ensureTestProduct } from './fixtures';

export interface StockDeclaration { declaration_id: string; status: string; idempotent_replay: boolean }
export interface StockApproval extends StockDeclaration {
  movement_id?: string;
  new_current_stock: number;
}

export async function stockDeclarationFixture(sku: string) {
  if (new URL(SUPABASE_URL).hostname !== 'ikcyvlovptebroadgtvd.supabase.co') {
    throw new Error('Stock declaration tests require V3 dev');
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const actor = await admin.from('user_profiles').select('id').eq('employee_code', 'EMP003').single();
  if (actor.error || !actor.data) throw new Error('Stock test declarant missing');
  const codes = ['inventory.adjust', 'inventory.waste'];
  const original = await admin.from('user_permission_overrides').select('*')
    .eq('user_profile_id', actor.data.id).in('permission_code', codes);
  if (original.error) throw new Error('Stock test permission snapshot failed');
  async function restorePermissions() {
    for (const code of codes) {
      const previous = original.data?.find(row => row.permission_code === code);
      const restored = previous ? await admin.from('user_permission_overrides').upsert(previous)
        : await admin.from('user_permission_overrides').delete().eq('user_profile_id', actor.data!.id).eq('permission_code', code);
      if (restored.error) throw new Error('Stock test permission restore failed');
    }
  }
  const granted = await admin.from('user_permission_overrides').upsert(codes.map(code => ({
    user_profile_id: actor.data.id, permission_code: code, is_granted: true,
    reason: 'Live dev stock declaration fixture', expires_at: null,
  })));
  if (granted.error) throw new Error('Stock test permission setup failed');
  try {
    const owner = jwtClient(await loginAs('EMP000'));
    const declarant = jwtClient(await loginAs('EMP003'));
    const productId = await ensureTestProduct(admin, { sku, name: '[TEST] ' + sku, current_stock: 100, cost_price: 0 });
    const marked = await admin.from('products').update({ is_test: true }).eq('id', productId);
    if (marked.error) throw new Error('Stock test product marker failed');
    async function resolvePending() {
      const pending = await admin.from('stock_declarations').select('id').eq('product_id', productId).eq('status', 'pending');
      if (pending.error) throw new Error('Stock test pending lookup failed');
      for (const declaration of pending.data ?? []) {
        const rejected = await owner.rpc('reject_stock_declaration_v1', { p_declaration_id: declaration.id, p_reason: 'Live dev test cleanup' });
        if (rejected.error) throw new Error('Stock test rejection failed');
      }
    }
    async function reset(quantity = 100) {
      await resolvePending();
      const updated = await admin.from('products').update({ current_stock: quantity }).eq('id', productId);
      if (updated.error) throw new Error('Stock test fixture reset failed');
    }
    async function cleanup() {
      try {
        await resolvePending();
        if (await currentStock() !== 0) {
          const submitted = await declarant.rpc('adjust_stock_v4', {
            p_product_id: productId, p_new_qty: 0, p_reason: 'Live dev test compensation',
            p_idempotency_key: crypto.randomUUID(),
          });
          if (submitted.error) throw new Error('Stock test compensation declaration failed');
          const approved = await owner.rpc('approve_stock_declaration_v3', {
            p_declaration_id: (submitted.data as StockDeclaration).declaration_id,
          });
          if (approved.error) throw new Error('Stock test compensation approval failed');
        }
      }
      finally { await restorePermissions(); }
      const archived = await admin.from('products').update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', productId).eq('is_test', true);
      if (archived.error) throw new Error('Stock test fixture archival failed');
    }
    async function currentStock() {
      const product = await admin.from('products').select('current_stock').eq('id', productId).single();
      if (product.error) throw new Error('Stock test fixture lookup failed');
      return Number(product.data!.current_stock);
    }
    return { admin, owner, declarant, productId, reset, cleanup, currentStock };
  } catch (error) {
    await restorePermissions();
    throw error;
  }
}
