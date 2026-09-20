import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { todayIsoDate } from '@breakery/utils';
import { getProducts, kitchenError, resolveSubmission, submitProduction } from './api.js';
import { draftError, emptyDraft, readDraft, requestFor, writeDraft, type KitchenDraft, type KitchenRow } from './drafts.js';
import { kitchenButton, kitchenControl, FOCUS_RING } from './controls.js';
import { KitchenEntryRow } from './KitchenEntryRow.js';

function load(userId: string, sectionId: string) {
  try { return { draft: readDraft(userId, sectionId), failed: false }; }
  catch { return { draft: emptyDraft(userId, sectionId), failed: true }; }
}

export function KitchenEntry({ userId, sectionId, online, today }: {
  userId: string; sectionId: string; online: boolean; today: string;
}) {
  const qc = useQueryClient();
  const [initial] = useState(() => load(userId, sectionId));
  const [draft, setDraft] = useState(initial.draft);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const inFlight = useRef(false);
  const products = useQuery({ queryKey: ['kitchen', userId, 'products', sectionId],
    queryFn: () => getProducts(sectionId), enabled: online, retry: false });
  const locked = busy || draft.pending !== null;
  const stale = draft.rows.length > 0 && draft.day !== today;

  function persist(next: KitchenDraft): boolean {
    setDraft(next);
    try { writeDraft(next); setStorageFailed(false); return true; }
    catch { setStorageFailed(true); return false; }
  }
  function edit(rows: KitchenRow[]) {
    if (locked) return;
    setSaved(null);
    setError(null);
    persist({ ...draft, day: draft.rows.length ? draft.day : todayIsoDate(), rows });
  }
  function patchRow(index: number, patch: Partial<KitchenRow>) {
    edit(draft.rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  async function submit() {
    if (inFlight.current || !online) return;
    const validation = draft.pending ? null : draftError(draft);
    if (validation) { setError(validation); return; }
    const pending = draft.pending ?? requestFor(draft, crypto.randomUUID());
    const frozen = { ...draft, pending };
    if (!persist(frozen)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSaved(null);
    let writeStarted = false;
    try {
      // Vérifie d'abord un éventuel commit dont la réponse aurait été perdue.
      let receipt = await resolveSubmission(pending.idempotency_key);
      if (!receipt) {
        writeStarted = true;
        receipt = await submitProduction(pending);
      }
      persist(emptyDraft(userId, sectionId));
      setSaved(`Production recorded: ${receipt.batch_number}.`);
      await qc.invalidateQueries({ queryKey: ['kitchen', userId, 'history'] });
    } catch (failure: unknown) {
      const code = failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : '';
      // Une erreur SQL déterministe a annulé la transaction. Un échec réseau
      // conserve la requête figée jusqu'à résolution avec la même clé.
      if (writeStarted && !draft.pending && /^(P000[123]|22\w{3}|23\w{3})$/.test(code)) persist({ ...frozen, pending: null });
      setError(kitchenError(failure));
    } finally { inFlight.current = false; setBusy(false); }
  }

  if (initial.failed) return <section role="alert" className="space-y-3 border border-danger p-4">
    <h2 className="text-lg font-semibold">Saved draft unavailable</h2>
    <p>The saved draft could not be read. Keep this browser’s data and ask an administrator for help before entering production again.</p>
  </section>;

  return <section aria-labelledby="kitchen-entry-title" className="space-y-5">
    <div className="space-y-1">
      <h2 id="kitchen-entry-title" className="text-xl font-semibold">Record production</h2>
      <p className="text-text-secondary">Enter what your station produced today. Stock updates when you record it.</p>
    </div>
    {saved && <p role="status" className="text-success">{saved}</p>}
    {storageFailed && <div role="alert" className="space-y-2 text-danger">
      <p>This tablet could not save your draft. Keep this page open and free browser storage before continuing.</p>
      <button className={kitchenButton} type="button" onClick={() => persist(draft)}>Retry saving draft</button>
    </div>}
    {stale && <div role="alert" className="space-y-3 border border-warning p-4">
      <p>This draft is from {draft.day}. Ask an administrator to record it for the correct date.</p>
      {!locked && <button className={kitchenButton} type="button" onClick={() => {
        if (window.confirm('Has an administrator handled this draft? Clearing it does not record any production.')) persist(emptyDraft(userId, sectionId));
      }}>Clear handled draft</button>}
    </div>}
    {draft.pending && <p role="status" className="text-warning">Confirmation is pending. Check this submission before changing any quantities.</p>}
    {!stale && <div className="space-y-3">
      <label className="block space-y-1">
        <span className="font-medium">Find a product</span>
        <input className={`${kitchenControl} w-full placeholder:text-text-muted ${FOCUS_RING}`} type="search" value={search}
          onChange={e => setSearch(e.target.value)} placeholder="Search your station’s products" disabled={locked} />
      </label>
      {products.isLoading && <p role="status">Loading products…</p>}
      {products.isError && <div role="alert" className="space-y-2">
        <p>{kitchenError(products.error)}</p>
        <button className={kitchenButton} type="button" disabled={!online || products.isFetching} onClick={() => void products.refetch()}>Reload products</button>
      </div>}
      {products.data?.length === 0 && <p>No products with an active recipe are assigned to this station. Ask an administrator to check the product setup.</p>}
      <div className="flex flex-wrap gap-2" aria-label="Available products">
        {(products.data ?? []).filter(p => p.name.toLowerCase().includes(search.toLowerCase())).map(p =>
          <button key={p.id} className={kitchenButton} type="button" disabled={locked || draft.rows.some(r => r.productId === p.id)}
            onClick={() => { edit([...draft.rows, { productId: p.id, name: p.name, unit: p.unit, quantity: '', waste: '0', wasteReason: '', note: '' }]); setSearch(''); }}>
            {p.name}
          </button>)}
      </div>
    </div>}
    <div className="space-y-4">
      {draft.rows.map((row, index) => <KitchenEntryRow key={row.productId} row={row}
        units={products.data?.find(p => p.id === row.productId)?.units ?? [{ code: row.unit, factor: 1 }]}
        locked={locked || stale} onChange={patch => patchRow(index, patch)}
        onRemove={() => edit(draft.rows.filter((_, i) => i !== index))} />)}
    </div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <div className="sticky bottom-0 border-t border-border-subtle bg-bg-base py-4 space-y-2">
      <button type="button" className={`${kitchenButton} w-full sm:w-auto`} onClick={() => void submit()}
        disabled={busy || !online || storageFailed || (!draft.pending && (stale || !draft.rows.length))}>
        {busy ? 'Checking production…' : draft.pending ? 'Check submission' : 'Record production'}
      </button>
      <p className="text-sm text-text-secondary">{!online ? 'Offline — your draft stays on this tablet. Submit when connected.' : 'Drafts are saved on this tablet for your account.'}</p>
    </div>
  </section>;
}
