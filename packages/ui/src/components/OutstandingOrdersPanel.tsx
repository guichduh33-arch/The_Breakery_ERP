import { useEffect, useRef, useState } from 'react';
import type { PaymentMethod } from '@breakery/domain';
import { Button } from '../primitives/Button.js';
import { Currency } from './Currency.js';

export interface OutstandingRow {
  order_id: string; order_number: string; customer_name: string; created_at: string;
  total: number; paid: number; due: number; total_count: number;
}
export interface OutstandingPaymentRequest {
  orderId: string; orderNumber: string; method: PaymentMethod; amount: number;
  idempotencyKey: string; sessionId: string | null;
  expectedPaid?: number;
}
const METHODS: PaymentMethod[] = ['cash', 'edc', 'qris', 'transfer'];
function readSaved(key: string): OutstandingPaymentRequest | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const p = JSON.parse(raw) as OutstandingPaymentRequest;
  if (!p.orderId || !p.orderNumber || !p.idempotencyKey || !METHODS.includes(p.method)
    || !Number.isFinite(p.amount) || p.amount <= 0 || (p.sessionId !== null && typeof p.sessionId !== 'string')
    || (p.expectedPaid !== undefined && (!Number.isFinite(p.expectedPaid) || p.expectedPaid < 0))) {
    throw new Error('Saved payment is unreadable. Keep browser data and contact a manager.');
  }
  return p;
}
export interface OutstandingOrdersPanelProps {
  rows: OutstandingRow[]; loading: boolean; loadError?: string;
  search: string; onSearch: (value: string) => void;
  page: number; onPage: (page: number) => void;
  canSettle: boolean; disabledReason?: string; sessionId: string | null; storageKey: string;
  onSettle: (request: OutstandingPaymentRequest) => Promise<void>;
}

/** Le stockage précède le règlement ; après perte réseau, la même clé est reprise. */
export function OutstandingOrdersPanel(p: OutstandingOrdersPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [recovery] = useState(() => {
    try { return { request: readSaved(p.storageKey), error: '' }; }
    catch (e) { return { request: null, error: e instanceof Error ? e.message : 'Saved payment unavailable' }; }
  });
  const [pending, setPending] = useState(recovery.request);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const row = p.rows.find((r) => r.order_id === selected);
  const count = p.rows[0]?.total_count ?? 0;
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key !== p.storageKey) return;
      try { setPending(readSaved(p.storageKey)); } catch { setError('Saved payment unavailable — contact a manager'); }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [p.storageKey]);

  async function submit(request: Omit<OutstandingPaymentRequest, 'idempotencyKey'> & { idempotencyKey?: string }) {
    if (sending.current || recovery.error) return;
    sending.current = true; setBusy(true); setError('');
    try {
      if (!navigator.locks?.request) throw new Error('Secure payment locking unavailable — use a supported terminal');
      await navigator.locks.request(p.storageKey, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('A payment is being confirmed in another tab');
        const saved = readSaved(p.storageKey);
        if (saved && saved.idempotencyKey !== request.idempotencyKey) {
          setPending(saved); throw new Error('Resume the saved payment before recording another receipt');
        }
        const active: OutstandingPaymentRequest = saved ?? { ...request, idempotencyKey: request.idempotencyKey ?? crypto.randomUUID() };
        const clear = () => {
          if (readSaved(p.storageKey)?.idempotencyKey === active.idempotencyKey) {
            localStorage.removeItem(p.storageKey); setPending(null);
          }
        };
        const value = JSON.stringify(active);
        localStorage.setItem(p.storageKey, value);
        if (localStorage.getItem(p.storageKey) !== value) throw new Error('Payment could not be saved safely');
        setPending(active);
        try {
          await p.onSettle(active);
          clear(); setSelected(null); setAmount('');
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code && ['23514', 'P0001', 'P0003'].includes(code)) clear();
          throw e;
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment confirmation unavailable');
    } finally { sending.current = false; setBusy(false); }
  }

  return <section className="space-y-4">
    <label className="block text-sm">Search customer or ticket
      <input value={p.search} onChange={(e) => p.onSearch(e.target.value)} data-vkp="qwerty"
        className="block w-full min-h-11 rounded-md border border-border-subtle bg-bg-input p-3 mt-1"
        placeholder="Customer or order number" />
    </label>
    {(error || recovery.error || p.loadError) && <p role="alert" className="text-danger">{recovery.error || error || p.loadError}</p>}
    {pending && <div role="status" className="rounded-md border border-gold bg-gold-soft p-4 space-y-2">
      <p>Payment to confirm: {pending.orderNumber} · {pending.method.toUpperCase()} · <Currency amount={pending.amount} /></p>
      <p className="text-sm">Resume this saved payment before recording another receipt.</p>
      <Button disabled={busy} onClick={() => { void submit(pending); }}>{busy ? 'Confirming…' : 'Resume saved payment'}</Button>
    </div>}
    {p.loading ? <p role="status">Loading outstanding orders…</p> : <>
      <p className="text-sm text-text-secondary">{count} outstanding orders · only actual collections enter the shift report.</p>
      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full text-sm text-left">
          <thead><tr className="border-b border-border-subtle">
            {['Ticket', 'Customer', 'Total', 'Paid', 'Due', ''].map((h, i) => <th key={i} className="p-3">{h}</th>)}
          </tr></thead>
          <tbody>{p.rows.map((r) => <tr key={r.order_id} className="border-b border-border-subtle">
            <td className="p-3">{r.order_number}<small className="block text-text-secondary">{new Date(r.created_at).toLocaleDateString('en-GB')}</small></td>
            <td className="p-3">{r.customer_name}</td>
            <td className="p-3"><Currency amount={r.total} /></td>
            <td className="p-3"><Currency amount={r.paid} /></td>
            <td className="p-3 font-semibold"><Currency amount={r.due} /></td>
            <td className="p-3"><Button disabled={!p.canSettle || busy || !!pending || !!recovery.error}
              onClick={() => { setSelected(r.order_id); setAmount(String(r.due)); }}>Settle {r.order_number}</Button></td>
          </tr>)}</tbody>
        </table>
        {p.rows.length === 0 && <p className="p-4">No outstanding orders.</p>}
      </div>
    </>}
    {!p.canSettle && p.disabledReason && <p role="status">{p.disabledReason}</p>}
    {row && !pending && <form className="rounded-md border border-border-subtle p-4 space-y-3" onSubmit={(e) => {
      e.preventDefault(); const value = Number(amount);
      if (!p.canSettle || !Number.isFinite(value) || value <= 0 || value > row.due) return;
      void submit({ orderId: row.order_id, orderNumber: row.order_number, method, amount: value,
        expectedPaid: row.paid, sessionId: p.sessionId });
    }}>
      <h2 className="font-semibold">Settle {row.order_number} · {row.customer_name}</h2>
      <label className="block">Payment method
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="block w-full min-h-11 rounded-md bg-bg-input border border-border-subtle p-2">
          {METHODS.map((m) => <option key={m} value={m}>{m === 'cash' ? 'Cash' : m === 'transfer' ? 'Transfer' : m.toUpperCase()}</option>)}
        </select>
      </label>
      <label className="block">Amount received
        <input aria-label="Amount received" value={amount} onChange={(e) => setAmount(e.target.value)} type="number"
          min="0.01" max={row.due} step="0.01" required data-vkp="numeric"
          className="block w-full min-h-11 rounded-md bg-bg-input border border-border-subtle p-2" />
      </label>
      <p className="text-sm text-text-secondary">Partial payments are allowed. Enter the amount applied to this ticket, after giving any cash change.</p>
      <Button type="submit" disabled={busy || !p.canSettle || Number(amount) <= 0 || Number(amount) > row.due}>Record payment</Button>
      <Button type="button" variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
    </form>}
    <div className="flex gap-3 items-center">
      <Button variant="secondary" disabled={p.page === 0 || p.loading} onClick={() => p.onPage(p.page - 1)}>Previous</Button>
      <span>Page {p.page + 1}</span>
      <Button variant="secondary" disabled={p.loading || (p.page + 1) * 50 >= count} onClick={() => p.onPage(p.page + 1)}>Next</Button>
    </div>
  </section>;
}
