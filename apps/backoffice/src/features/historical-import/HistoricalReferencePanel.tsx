import { useEffect, useRef, useState } from 'react';
import { Input } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/BackofficeUi.js';
import { supabase, supabaseUrl } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import { historicalProductPayload, parseReferencePackage } from './referencePackage.js';
import type { ProductReference, ReferencePackage, SupplierReference } from './referencePackage.js';

const project = new URL(supabaseUrl).hostname.split('.')[0] ?? '';
export function HistoricalReferencePanel() {
  const [pack, setPack] = useState<ReferencePackage | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load(file: File | undefined) {
    if (!file || running.current) return;
    running.current = true; setBusy(true); setPack(null); setResults([]); setConfirmed(false); setError('');
    try {
      if (file.size > 200_000) throw new Error('The reference file exceeds 200 KB.');
      const parsed = parseReferencePackage(await file.text(), project);
      if (mounted.current) setPack(parsed);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Cannot read references.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function create() {
    if (!pack || !confirmed || running.current) return;
    const session = useAuthStore.getState();
    const actor = session.user?.id, token = session.sessionToken;
    const guard = () => {
      const current = useAuthStore.getState();
      if (!mounted.current || !current.isAuthenticated || !token || current.sessionToken !== token
        || current.user?.id !== actor || current.user?.role_code !== 'SUPER_ADMIN'
        || (pack.products.length > 0 && !current.hasPermission('products.create'))
        || (pack.suppliers.length > 0 && !current.hasPermission('suppliers.create'))) throw new Error('The operator session or required permissions changed.');
    };
    const productLookup = async (ref: ProductReference) => {
      guard();
      const q = await supabase.from('products').select('id,name,unit,category_id,product_type,deleted_at,is_active,visible_on_pos,available_for_sale,track_inventory,deduct_stock,is_display_item,current_stock,retail_price,cost_price').eq('sku', ref.sku).maybeSingle();
      guard(); if (q.error) throw new Error(q.error.message);
      if (q.data && (q.data.deleted_at !== null || q.data.name !== ref.name || q.data.unit !== ref.unit
        || q.data.category_id !== ref.category_id || q.data.product_type !== ref.product_type)) throw new Error(`Existing SKU ${ref.sku} does not match this reference.`);
      return q.data;
    };
    const supplierLookup = async (ref: SupplierReference) => {
      guard();
      const q = await supabase.from('suppliers').select('id,code,name,is_active,deleted_at').or(`code.eq.${ref.code},name.ilike.${ref.name}`);
      guard(); if (q.error) throw new Error(q.error.message);
      if (q.data.length > 1 || q.data.some((s) => s.name.toLowerCase() !== ref.name.toLowerCase() || s.deleted_at !== null || !s.is_active)) throw new Error(`Existing supplier ${ref.name} is ambiguous or inactive.`);
      return q.data[0];
    };
    running.current = true; setBusy(true); setError(''); setResults([]);
    try {
      guard();
      const done: string[] = [];
      for (const ref of pack.products) {
        let record = await productLookup(ref);
        if (!record) {
          guard(); const q = await supabase.rpc('create_product_v3', { p_payload: historicalProductPayload(ref) });
          if (q.error && q.error.code !== '23505') throw new Error(q.error.message);
          if (!q.error && q.data && typeof q.data === 'object' && !Array.isArray(q.data)
            && Array.isArray(q.data.ignored_fields) && q.data.ignored_fields.length > 0) throw new Error(`Some reference fields were ignored for ${ref.sku}.`);
          record = await productLookup(ref);
          if (!record) throw new Error(`The result for ${ref.sku} is uncertain. Retry the same reference file.`);
          if (!q.error && (record.is_active || record.visible_on_pos || record.available_for_sale || record.track_inventory
            || record.deduct_stock || record.is_display_item || record.current_stock !== 0 || record.retail_price !== 0 || record.cost_price !== 0)) {
            throw new Error(`New reference ${ref.sku} does not match the required inactive, zero-stock configuration.`);
          }
        }
        done.push(`${ref.sku} · ${ref.name} · ${record.id}`); if (mounted.current) setResults([...done]);
      }
      for (const ref of pack.suppliers) {
        let record = await supplierLookup(ref);
        if (!record) {
          guard(); const q = await supabase.from('suppliers').insert({ code: ref.code, name: ref.name, is_active: true,
            notes: 'Historical import reference. Payment terms are not evidenced by the source; the application default is not a verified contractual term.' });
          if (q.error && q.error.code !== '23505') throw new Error(q.error.message);
          record = await supplierLookup(ref);
          if (!record) throw new Error(`The result for ${ref.name} is uncertain. Retry the same reference file.`);
        }
        done.push(`${record.code} · ${ref.name} · ${record.id}`); if (mounted.current) setResults([...done]);
      }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Reference creation stopped.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  return <Card><CardHeader><CardTitle>Missing historical references</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-text-secondary">Create approved references before preparing transaction batches. New products remain inactive and hidden from the POS, with zero stock. Existing records are checked and reused without changing them.</p>
    <label className="block space-y-1 text-sm"><span>Reference package (.json)</span><Input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { void load(e.target.files?.[0]); }} /></label>
    {pack && <>
      <ul className="space-y-1 text-sm text-text-primary">{pack.products.map((p) => <li key={p.sku}>{p.sku} · {p.name} · inactive</li>)}{pack.suppliers.map((s) => <li key={s.code}>{s.code} · {s.name} · supplier</li>)}</ul>
      <label className="flex items-start gap-2 text-sm"><input className={FOCUS_RING} type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /><span>I authorize these references. Product prices and costs stay at zero until configured; current stock is unchanged.</span></label>
      <Button disabled={busy || !confirmed} onClick={() => { void create(); }}>{busy ? 'Creating references…' : 'Create or verify references'}</Button>
    </>}
    {results.length > 0 && <ul aria-label="Verified references" className="space-y-1 break-words font-data text-xs text-text-secondary">{results.map((result) => <li key={result}>{result}</li>)}</ul>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </CardContent></Card>;
}
