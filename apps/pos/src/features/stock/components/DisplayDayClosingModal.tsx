import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, FullScreenModal, Input, Select } from '@breakery/ui';
import { todayIsoDate } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore';
import { usePOSStockProducts } from '../hooks/usePOSStockProducts';
import { useDisplayDayClosing, type DisplayDayItem } from '../hooks/useDisplayDayClosing';
import { isDisplayQuantity } from '../quantity';
import {
  isValidWasteNote,
  isWasteReason,
  MAX_WASTE_NOTE,
  MIN_WASTE_NOTE,
  NOTE_REQUIRED_REASON,
  WASTE_REASON_LABELS,
  WASTE_REASON_OPTIONS,
  recordedWasteReasonLabel,
  type WasteReason,
} from '../wasteReasons';

interface CountRow {
  id: string;
  name: string;
  unit: string;
  remaining: string;
  waste: string;
  /** S1-18 — motif de la liste fermée et note facultative, saisis pour une perte. */
  reason: WasteReason | '';
  note: string;
  /** Motif d'un comptage déjà enregistré : texte serveur, affiché en lecture seule. */
  recordedReason: string | null;
  wasteStatus: string | null;
}

export function DisplayDayClosingModal({ onClose }: { onClose: () => void }) {
  const [day, setDay] = useState(todayIsoDate);
  const [rows, setRows] = useState<CountRow[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const products = usePOSStockProducts();
  const closing = useDisplayDayClosing(day);
  const user = useAuthStore((state) => state.user);
  const initialized = useRef('');
  const saved = closing.query.data;
  const pending = closing.pending;
  const locked = closing.mutation.isPending || pending !== null;
  const readOnly = saved !== null && saved !== undefined && !correcting && pending === null;

  useEffect(() => {
    if (closing.query.isPending || products.isPending) return;
    const identity = `${day}:${saved?.closing_id ?? 'new'}:${pending === null ? 'ready' : 'pending'}`;
    if (initialized.current === identity) return;
    initialized.current = identity;
    const catalogue = products.data ?? [];
    const fresh = { reason: '' as const, note: '', recordedReason: null };
    const recordedOf = (id: string) => saved?.items.find((candidate) => candidate.product_id === id);
    const recordedLabel = (item?: { waste_reason: string | null; waste_reason_code?: WasteReason | null }) =>
      item ? recordedWasteReasonLabel(item.waste_reason_code, item.waste_reason) : null;
    const row = (item: { product_id: string; remaining_qty: number; waste_qty: number }) => {
      const product = catalogue.find((candidate) => candidate.id === item.product_id);
      const recorded = recordedOf(item.product_id);
      return { id: item.product_id, name: recorded?.product_name ?? product?.name ?? 'Display product',
        unit: recorded?.unit ?? product?.unit ?? 'pcs', remaining: String(item.remaining_qty),
        waste: String(item.waste_qty), wasteStatus: recorded?.waste_status ?? null };
    };
    // Une tentative de comptage neuf garde son motif et sa note ; une correction
    // et un comptage enregistré montrent le motif tel que le serveur l'a gardé.
    setRows(pending?.closingId === null
      ? pending.items.map((item) => ({ ...row(item), reason: item.waste_reason ?? '', note: item.waste_note ?? '',
        recordedReason: null }))
      : pending
        ? pending.items.map((item) => ({ ...row(item), ...fresh,
          recordedReason: recordedLabel(recordedOf(item.product_id)) }))
        : saved
          ? saved.items.map((item) => ({ ...row(item), ...fresh, recordedReason: recordedLabel(item) }))
          : catalogue.map((product) => ({ id: product.id, name: product.name, unit: product.unit,
            remaining: '', waste: '0', wasteStatus: null, ...fresh })));
    setCorrecting(pending?.closingId !== null && pending?.closingId !== undefined);
    setCorrectionReason(pending?.correctionReason ?? '');
    setConfirmation(null);
  }, [day, saved, pending, products.data, products.isPending, closing.query.isPending]);

  function update(id: string, patch: Partial<Pick<CountRow, 'remaining' | 'waste' | 'reason' | 'note'>>) {
    setRows((previous) => previous.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  // Une correction ne renvoie que les restes : les motifs déjà enregistrés ne se ressaisissent pas.
  const validRows = rows.length > 0 && rows.every((row) => row.remaining !== ''
    && isDisplayQuantity(Number(row.remaining)) && row.waste !== '' && isDisplayQuantity(Number(row.waste))
    && (correcting || Number(row.waste) === 0 || (row.reason !== '' && isValidWasteNote(row.reason, row.note))));
  const canSubmit = closing.canCount && validRows && !closing.storageError
    && !closing.query.isError && !products.isError && !closing.query.isPending && !products.isPending
    && (!correcting || correctionReason.trim().length >= 3);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit && pending === null) return;
    const items: DisplayDayItem[] = rows.map((row) => {
      const reason = correcting || Number(row.waste) <= 0 || row.reason === '' ? null : row.reason;
      return { product_id: row.id, remaining_qty: Number(row.remaining), waste_qty: Number(row.waste),
        waste_reason: reason, waste_note: reason === null ? null : row.note.trim() || null };
    });
    try {
      await closing.mutation.mutateAsync(pending ?? { businessDay: day, items,
        closingId: correcting ? saved?.closing_id ?? null : null, correctionReason });
      setCorrecting(false);
      setConfirmation(correcting ? 'Count correction recorded.' : 'End-of-day count recorded. Waste awaits owner approval.');
    } catch {
      // La tentative durable garde les mêmes quantités et la même clé en cas de résultat incertain.
    }
  }
  const canCorrect = saved && (saved.recorded_by === user?.id || user?.role_code === 'SUPER_ADMIN');
  const errorMessage = closing.storageError ?? closing.mutation.error?.message ?? closing.query.error?.message ?? products.error?.message;

  return (
    <FullScreenModal open onOpenChange={(open) => { if (!open && !closing.mutation.isPending) onClose(); }}
      accessibleTitle="End-of-day display count">
      <form onSubmit={(event) => { void submit(event); }} className="m-auto flex max-h-[94dvh] w-full max-w-4xl flex-col rounded-xl bg-bg-overlay shadow-modal">
        <header className="space-y-3 border-b border-border-subtle p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold">End-of-day display count</h2>
            <Button type="button" variant="secondary" onClick={onClose} disabled={closing.mutation.isPending}>Close</Button>
          </div>
          <p className="text-sm text-text-secondary">Count the products still present after removing waste. Remaining quantities are recorded for review. Global stock changes for waste require owner approval.</p>
          <label className="block max-w-xs text-sm">Business day
            <Input type="date" value={day} max={todayIsoDate()} disabled={locked}
              onChange={(event) => { setDay(event.target.value); setCorrecting(false); closing.mutation.reset(); }} />
          </label>
          {pending && <p role="status" className="text-sm text-text-secondary">The previous result is unconfirmed. Retry the same count to check it.</p>}
          {saved && !pending && <p role="status" className="text-sm text-text-secondary">Recorded · revision {saved.revision}</p>}
          {confirmation && <p role="status">{confirmation}</p>}
          {errorMessage && <p role="alert" className="text-sm text-danger">{errorMessage}</p>}
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {(closing.query.isPending || products.isPending) && <p role="status">Loading display products…</p>}
          {rows.map((row) => (
            <section key={row.id} className="grid gap-3 rounded-md border border-border-subtle p-4 sm:grid-cols-2">
              <h3 className="font-semibold sm:col-span-2">{row.name} <span className="text-sm font-normal text-text-secondary">({row.unit})</span></h3>
              <label className="space-y-1 text-sm">Remaining — {row.name}
                <Input type="number" inputMode="decimal" data-vkp="numeric" min="0" step="0.001" required
                  value={row.remaining} disabled={locked || readOnly}
                  onChange={(event) => update(row.id, { remaining: event.target.value })} />
              </label>
              <label className="space-y-1 text-sm">Waste — {row.name}
                <Input type="number" inputMode="decimal" data-vkp="numeric" min="0" step="0.001" required
                  value={row.waste} disabled={locked || readOnly || correcting}
                  onChange={(event) => update(row.id, { waste: event.target.value })} />
              </label>
              {Number(row.waste) > 0 && row.recordedReason !== null
                && <p className="text-sm sm:col-span-2">Waste reason — <span className="text-text-secondary">{row.recordedReason}</span></p>}
              {Number(row.waste) > 0 && row.recordedReason === null && <>
                <label className="space-y-1 text-sm">Waste reason — {row.name}
                  <Select value={row.reason} required disabled={locked || readOnly || correcting}
                    onChange={(event) => update(row.id, { reason: isWasteReason(event.target.value) ? event.target.value : '' })}>
                    <option value="">Select a reason</option>
                    {WASTE_REASON_OPTIONS.map((code) => <option key={code} value={code}>{WASTE_REASON_LABELS[code]}</option>)}
                  </Select>
                </label>
                <label className="space-y-1 text-sm">{row.reason === NOTE_REQUIRED_REASON ? 'Note (required)' : 'Note (optional)'} — {row.name}
                  <Input value={row.note} maxLength={MAX_WASTE_NOTE} required={row.reason === NOTE_REQUIRED_REASON}
                    minLength={MIN_WASTE_NOTE} disabled={locked || readOnly || correcting}
                    aria-invalid={row.reason !== '' && !isValidWasteNote(row.reason, row.note)}
                    onChange={(event) => update(row.id, { note: event.target.value })} />
                </label>
              </>}
              {row.wasteStatus && <p className="text-sm text-text-secondary sm:col-span-2">Waste approval · {row.wasteStatus}</p>}
            </section>
          ))}
          {correcting && <label className="block space-y-1 text-sm">Correction reason
            <Input value={correctionReason} minLength={3} maxLength={500} required disabled={locked}
              onChange={(event) => setCorrectionReason(event.target.value)} />
          </label>}
        </div>
        <footer className="flex justify-end gap-3 border-t border-border-subtle p-5">
          {readOnly && canCorrect && <Button type="button" variant="secondary" onClick={() => setCorrecting(true)}>Correct remaining counts</Button>}
          {!readOnly && <Button type="submit" variant="primary" disabled={closing.mutation.isPending || (!canSubmit && pending === null)}>
            {closing.mutation.isPending ? 'Recording…' : pending ? 'Retry same count' : correcting ? 'Record correction' : 'Record end-of-day count'}
          </Button>}
        </footer>
      </form>
    </FullScreenModal>
  );
}
