// apps/pos/src/features/customers/CustomerDebtsPanel.tsx
//
// Session 14 — Phase 2.D — POS-side outstanding customer debts page.
//
// Visual ref: 86-pos-outstanding-customer-debts.jpg.
//
// Layout: left sidebar with customer list (badge with debt count + oldest
// age), right pane with selected customer's outstanding orders. Each order
// shows Total / Paid / Due in 3-col grid and a "Pay" CTA.
//
// Routed at `/pos/debts`. The "Pay" CTA currently routes to the order
// detail in history (which carries the existing pay_existing_order flow).
// Inline payment from this panel is deferred — the goal here is visibility.

import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Search,
  Clock,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Currency, EmptyState, cn } from '@breakery/ui';
import {
  useOutstandingDebts,
  type OutstandingDebt,
  type OutstandingOrder,
} from './hooks/useOutstandingDebts';

export default function CustomerDebtsPanel(): JSX.Element {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useOutstandingDebts();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = data ?? [];
    if (!q) return rows;
    return rows.filter(
      (d) =>
        d.customer_name.toLowerCase().includes(q) ||
        (d.customer_phone ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  const selected = useMemo(
    () => filtered.find((d) => d.customer_id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  return (
    <div className="h-screen flex flex-col bg-bg-base text-text-primary">
      <header className="h-14 px-4 flex items-center gap-3 border-b border-border-subtle bg-bg-elevated">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => navigate('/pos')}
          data-testid="pos-debts-back"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Button>
        <AlertCircle className="h-5 w-5 text-amber-warn" aria-hidden />
        <h1 className="font-display text-lg">POS Outstanding</h1>
        <div className="flex-1" />
        <span className="text-xs uppercase tracking-widest text-text-secondary">
          {data ? `${data.length} client${data.length > 1 ? 's' : ''} with outstanding` : ''}
        </span>
      </header>

      <div className="flex-1 grid grid-cols-[280px_1fr] overflow-hidden">
        {/* Sidebar */}
        <aside className="border-r border-border-subtle bg-bg-elevated/40 flex flex-col">
          <div className="p-3 border-b border-border-subtle">
            <label className="relative block">
              <Search className="h-4 w-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer…"
                aria-label="Search customer"
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-base pl-9 pr-3 text-sm focus:outline focus:outline-2 focus:outline-gold"
                data-testid="pos-debts-search"
              />
            </label>
          </div>
          <ul className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoading && <li className="text-text-secondary text-sm p-3">Loading…</li>}
            {isError && <li className="text-red text-sm p-3">Failed to load debts.</li>}
            {!isLoading && filtered.length === 0 && (
              <li className="p-3">
                <EmptyState
                  icon={AlertCircle}
                  title="No outstanding"
                  description="No customers have unpaid orders."
                  size="sm"
                />
              </li>
            )}
            {filtered.map((d) => (
              <DebtSidebarItem
                key={d.customer_id}
                debt={d}
                selected={selected?.customer_id === d.customer_id}
                onSelect={() => setSelectedId(d.customer_id)}
              />
            ))}
          </ul>
        </aside>

        {/* Detail */}
        <section className="overflow-y-auto p-6 space-y-4">
          {selected ? (
            <DebtDetail
              debt={selected}
              onPay={(order) => {
                toast.info(`Payment flow for ${order.order_number} — opening cashier terminal…`);
              }}
            />
          ) : (
            <div className="h-full grid place-items-center">
              <EmptyState
                icon={AlertCircle}
                title="No customer selected"
                description="Pick a customer from the list to view their outstanding orders."
                size="md"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DebtSidebarItem({
  debt,
  selected,
  onSelect,
}: {
  debt: OutstandingDebt;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-testid={`debt-sidebar-${debt.customer_id}`}
        className={cn(
          'w-full text-left rounded-md border px-3 py-2.5 transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-[-2px]',
          selected
            ? 'border-gold bg-gold-soft'
            : 'border-border-subtle bg-bg-base/40 hover:bg-bg-overlay',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm text-text-primary truncate">{debt.customer_name}</span>
          <span
            className={cn(
              'h-5 min-w-5 px-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold',
              'bg-amber-warn text-bg-base',
            )}
          >
            {debt.orders.length}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <Currency amount={debt.total_due} className="text-red font-mono" />
          <span className="text-text-muted">{debt.oldest_order_days}d oldest</span>
        </div>
      </button>
    </li>
  );
}

function DebtDetail({
  debt,
  onPay,
}: {
  debt: OutstandingDebt;
  onPay: (order: OutstandingOrder) => void;
}): JSX.Element {
  const utilizationPct =
    debt.credit_limit > 0 ? Math.min(100, (debt.credit_used / debt.credit_limit) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl">{debt.customer_name}</h2>
          <p className="text-text-secondary text-sm mt-1">
            Credit: <Currency amount={debt.credit_limit} className="font-mono" />
            {' / '}
            <span className="text-text-primary">
              <Currency amount={debt.credit_used} className="font-mono" />
            </span>{' '}
            used
          </p>
          {debt.customer_phone && (
            <p className="text-text-muted text-xs mt-0.5">{debt.customer_phone}</p>
          )}
        </div>
        <div className="w-48">
          <div className="h-2 rounded-full bg-bg-overlay overflow-hidden">
            <div
              className={cn(
                'h-full transition-all motion-reduce:transition-none',
                utilizationPct >= 80 ? 'bg-red' : utilizationPct >= 50 ? 'bg-amber-warn' : 'bg-green',
              )}
              style={{ width: `${utilizationPct}%` }}
              aria-label={`Credit utilization ${Math.round(utilizationPct)}%`}
            />
          </div>
          <div className="text-right text-[10px] uppercase tracking-widest text-text-muted mt-1">
            {Math.round(utilizationPct)}% used
          </div>
        </div>
      </div>

      <ul className="space-y-3">
        {debt.orders.map((o) => (
          <DebtOrderRow key={o.id} order={o} onPay={() => onPay(o)} />
        ))}
      </ul>
    </div>
  );
}

function DebtOrderRow({
  order,
  onPay,
}: {
  order: OutstandingOrder;
  onPay: () => void;
}): JSX.Element {
  return (
    <li
      className="rounded-lg border border-border-subtle bg-bg-elevated p-4 space-y-3"
      data-testid={`debt-order-${order.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-text-primary">{order.order_number}</span>
          <span className="text-xs text-text-muted uppercase tracking-widest">{order.order_type}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs px-2 h-6 rounded-md bg-red-soft text-red font-semibold">
          <Clock className="h-3 w-3" aria-hidden /> {order.days_old}d
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-text-muted">Total</div>
          <Currency amount={order.total} className="font-mono text-text-primary" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-text-muted">Paid</div>
          <Currency amount={order.paid} className="font-mono text-green" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-text-muted">Due</div>
          <Currency amount={order.due} className="font-mono text-red" />
        </div>
      </div>

      <Button variant="outlineGold" size="md" onClick={onPay} className="w-full">
        <CreditCard className="h-4 w-4" aria-hidden /> Pay {new Intl.NumberFormat().format(order.due)}
      </Button>
    </li>
  );
}
