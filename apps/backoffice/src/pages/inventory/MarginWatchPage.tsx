// apps/backoffice/src/pages/inventory/MarginWatchPage.tsx
//
// Session 15 / Phase 5.A — Margin Watch.
//
// Lists margin alerts opened by the daily pg_cron job
// `recompute-recipe-margins-daily`. Managers (inventory.production.create+)
// can acknowledge an alert with an optional note. Read access is gated by
// `reports.inventory.read` at the route level.

import { useMemo, useState, type JSX } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useMarginAlerts,
  useAcknowledgeMarginAlert,
  type MarginAlertFilter,
  type MarginAlertRow,
} from '@/features/inventory-production/hooks/useMarginAlerts.js';

const FILTERS: { value: MarginAlertFilter; label: string }[] = [
  { value: 'open',  label: 'Open' },
  { value: 'acked', label: 'Acknowledged' },
  { value: 'all',   label: 'All' },
];

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function deltaToneClass(delta: number): string {
  if (delta <= -10) return 'text-red font-semibold';
  if (delta <= -5)  return 'text-amber-400';
  return 'text-text-secondary';
}

export default function MarginWatchPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission('reports.inventory.read');
  const canAck  = hasPermission('inventory.production.create');

  const [filter, setFilter] = useState<MarginAlertFilter>('open');
  const [ackTarget, setAckTarget] = useState<MarginAlertRow | null>(null);
  const [ackNotes, setAckNotes]   = useState<string>('');
  const [error, setError]         = useState<string | null>(null);

  const q   = useMarginAlerts(filter);
  const ack = useAcknowledgeMarginAlert();

  const rows = useMemo<MarginAlertRow[]>(() => q.data ?? [], [q.data]);

  if (!canRead) {
    return (
      <div className="text-text-secondary">
        You do not have permission to view margin alerts.
      </div>
    );
  }

  function openAckModal(row: MarginAlertRow): void {
    setAckTarget(row);
    setAckNotes('');
    setError(null);
  }

  function closeAckModal(): void {
    setAckTarget(null);
    setAckNotes('');
  }

  async function submitAck(): Promise<void> {
    if (ackTarget === null) return;
    setError(null);
    try {
      await ack.mutateAsync({
        id:    ackTarget.id,
        notes: ackNotes.trim().length > 0 ? ackNotes.trim() : null,
      });
      closeAckModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to acknowledge.');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl">Margin Watch</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Recipe-built products whose expected gross margin has slipped
            below the per-product target. Recomputed daily at 02:00 UTC.
          </p>
        </div>
        <div role="tablist" className="flex items-center gap-1 rounded-md border border-border-subtle p-1 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded px-3 py-1 ${filter === f.value ? 'bg-bg-overlay text-text-primary' : 'text-text-secondary'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {error !== null && (
        <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
          {error}
        </div>
      )}

      <section data-testid="margin-watch-table" className="rounded-md border border-border-subtle bg-bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-[11px] uppercase tracking-widest text-text-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-right">Target</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Delta</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-left">Computed</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={9} className="px-3 py-3 text-text-secondary">Loading…</td></tr>
              )}
              {!q.isLoading && rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-3 text-text-secondary">
                  {filter === 'open' ? 'No open margin alerts. Everything is on target.' : 'No alerts match this filter.'}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} data-testid={`margin-alert-row-${r.id}`} className="border-t border-border-subtle">
                  <td className="px-3 py-2">{r.productName ?? r.productId}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.targetMarginPct)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.expectedMarginPct)}</td>
                  <td className={`px-3 py-2 text-right ${deltaToneClass(r.deltaPct)}`}>
                    {r.deltaPct > 0 ? '+' : ''}{fmtPct(r.deltaPct)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.costPerUnit)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmtMoney(r.sellingPrice)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{fmtDateTime(r.computedAt)}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.acknowledgedAt === null ? (
                      <span className="text-amber-400">Open</span>
                    ) : (
                      <span className="text-text-secondary">Acked {fmtDateTime(r.acknowledgedAt)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.acknowledgedAt === null && canAck && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => openAckModal(r)}
                        aria-label={`Acknowledge alert for ${r.productName ?? r.productId}`}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Ack modal — Radix-backed Dialog from @breakery/ui (S22/1.A.2 :
          replaced raw `fixed inset-0` overlay div with focus-trapped Dialog). */}
      <Dialog
        open={ackTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeAckModal();
        }}
      >
        <DialogContent
          aria-label="Acknowledge margin alert"
          data-testid="ack-modal"
          className="max-w-md"
        >
          <DialogHeader>
            <DialogTitle>Acknowledge alert</DialogTitle>
            {ackTarget !== null && (
              <DialogDescription>
                {ackTarget.productName ?? ackTarget.productId} — expected {fmtPct(ackTarget.expectedMarginPct)} vs target {fmtPct(ackTarget.targetMarginPct)} ({fmtPct(ackTarget.deltaPct)}).
              </DialogDescription>
            )}
          </DialogHeader>
          <label className="block text-xs">
            <span className="block text-text-secondary">Notes (optional)</span>
            <textarea
              value={ackNotes}
              onChange={(e) => setAckNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm"
              placeholder="Reason / corrective action"
              aria-label="Acknowledgement notes"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeAckModal}>Cancel</Button>
            <Button
              type="button"
              onClick={() => { void submitAck(); }}
              disabled={ack.isPending}
              aria-label="Confirm acknowledge"
            >
              {ack.isPending ? 'Saving…' : 'Acknowledge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
