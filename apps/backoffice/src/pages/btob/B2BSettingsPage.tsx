// apps/backoffice/src/pages/btob/B2BSettingsPage.tsx
//
// Session 39 / Wave C2 — B2B Settings page wired to b2b_settings RPC.
//
// Mirrors docs/Design/backoffice/BtoB setting.jpg:
//   - Default Payment Terms (select)
//   - Available Payment Terms (chip list + add)
//   - Critical Overdue Threshold (number input, days)
//   - Aging Report Buckets (Current / Overdue / Critical, with day range
//     editors + add bucket)
//
// Data is fetched via get_b2b_settings_v1 and persisted via
// update_b2b_settings_v1(p_patch JSONB). Draft pattern: 4 local states
// are kept in sync with server data; a dirty flag gates the Save bar.
// Buckets carry a local `id` for React keys but the payload strips it.

import { useState, useEffect, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Clock,
  FileText,
  List,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card, SectionLabel } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useB2bSettings } from '@/features/btob/hooks/useB2bSettings.js';
import { useUpdateB2bSettings } from '@/features/btob/hooks/useUpdateB2bSettings.js';
import type { AgingBucket } from '@/features/btob/hooks/useB2bSettings.js';

const DEFAULT_TERM_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'cod',    label: 'Cash on delivery (COD)' },
  { value: 'net_7',  label: 'Net 7' },
  { value: 'net_14', label: 'Net 14' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_60', label: 'Net 60' },
];

// Local bucket keeps an `id` for React key stability across edits.
interface LocalBucket extends AgingBucket { id: string }

function serverBucketsToLocal(buckets: AgingBucket[]): LocalBucket[] {
  return buckets.map((b, i) => ({ ...b, id: `bucket-${i}` }));
}

function localBucketsToPayload(buckets: LocalBucket[]): AgingBucket[] {
  return buckets.map(({ label, min, max }) => ({ label, min, max }));
}

export default function B2BSettingsPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const { data: serverData, isLoading } = useB2bSettings();
  const updateMut = useUpdateB2bSettings();

  const [defaultTerm,    setDefaultTerm   ] = useState<string>('net_30');
  const [availableTerms, setAvailableTerms] = useState<string[]>([]);
  const [newTerm,        setNewTerm       ] = useState<string>('');
  const [threshold,      setThreshold     ] = useState<number>(30);
  const [buckets,        setBuckets       ] = useState<LocalBucket[]>([]);
  const [saveError,      setSaveError     ] = useState<string | null>(null);

  // Track which server snapshot is loaded so we don't clobber user edits on
  // background refetches — only re-sync when the server data object reference
  // changes (i.e. a new fetch result arrived).
  const [loadedData, setLoadedData] = useState(serverData);
  useEffect(() => {
    if (serverData !== undefined && serverData !== loadedData) {
      setLoadedData(serverData);
      setDefaultTerm(serverData.default_payment_terms);
      setAvailableTerms([...serverData.available_payment_terms]);
      setThreshold(serverData.critical_overdue_days);
      setBuckets(serverBucketsToLocal(serverData.aging_buckets));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverData]);

  if (!canRead) {
    return <div className="text-text-secondary">No access to settings.</div>;
  }

  // Dirty flag: compare draft vs server
  const isDirty = serverData !== undefined && (
    defaultTerm !== serverData.default_payment_terms ||
    JSON.stringify(availableTerms) !== JSON.stringify(serverData.available_payment_terms) ||
    threshold !== serverData.critical_overdue_days ||
    JSON.stringify(localBucketsToPayload(buckets)) !== JSON.stringify(serverData.aging_buckets)
  );

  function addTerm(): void {
    const trimmed = newTerm.trim();
    if (trimmed === '' || availableTerms.includes(trimmed)) return;
    setAvailableTerms((prev) => [...prev, trimmed]);
    setNewTerm('');
  }

  function removeTerm(term: string): void {
    setAvailableTerms((prev) => prev.filter((t) => t !== term));
  }

  function updateBucket(id: string, patch: Partial<LocalBucket>): void {
    setBuckets((prev) => prev.map((b) => b.id === id ? { ...b, ...patch } : b));
  }

  function addBucket(): void {
    const id = `bucket-${buckets.length + 1}-${Date.now()}`;
    setBuckets((prev) => [...prev, { id, label: 'New bucket', min: 0, max: null }]);
  }

  function removeBucket(id: string): void {
    setBuckets((prev) => prev.filter((b) => b.id !== id));
  }

  async function handleSave(): Promise<void> {
    setSaveError(null);
    const patch = {
      default_payment_terms:   defaultTerm,
      available_payment_terms: availableTerms,
      critical_overdue_days:   threshold,
      aging_buckets:           localBucketsToPayload(buckets),
    };
    try {
      await updateMut.mutateAsync(patch);
      toast.success('B2B settings saved.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSaveError(message);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="sm" aria-label="Back to B2B dashboard">
            <Link to="/backoffice/b2b">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <div>
            <h1 className="font-serif text-3xl text-text-primary inline-flex items-center gap-2">
              <FileText className="h-6 w-6 text-gold" aria-hidden /> B2B Settings
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Payment terms, overdue thresholds, and aging report configuration.
            </p>
          </div>
        </div>
      </header>

      {isLoading && (
        <div role="status" aria-label="Loading settings" className="rounded-md border border-border-subtle bg-bg-overlay p-3 text-xs text-text-secondary">
          Loading settings…
        </div>
      )}

      <Card variant="default" padding="md" className="space-y-3">
        <SectionLabel as="div" size="xs">
          <span className="inline-flex items-center gap-2"><Clock className="h-3.5 w-3.5" aria-hidden /> Default payment terms</span>
        </SectionLabel>
        <p className="text-xs text-text-secondary">Default terms applied to new B2B orders.</p>
        <label className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-base px-3">
          <select
            value={defaultTerm}
            onChange={(e) => setDefaultTerm(e.target.value)}
            className="h-9 w-full bg-transparent text-sm text-text-primary outline-none"
            aria-label="Default payment terms"
          >
            {DEFAULT_TERM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden />
        </label>
      </Card>

      <Card variant="default" padding="md" className="space-y-3">
        <SectionLabel as="div" size="xs">
          <span className="inline-flex items-center gap-2"><List className="h-3.5 w-3.5" aria-hidden /> Available payment terms</span>
        </SectionLabel>
        <p className="text-xs text-text-secondary">Terms selectable when creating B2B orders.</p>
        <div className="flex flex-wrap items-center gap-2">
          {availableTerms.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-base px-2 py-1 font-mono text-xs text-text-primary"
            >
              {t}
              <button
                type="button"
                onClick={() => removeTerm(t)}
                aria-label={`Remove ${t}`}
                className="text-text-muted transition-colors duration-fast hover:text-danger"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="e.g. net45"
            maxLength={32}
            aria-label="New payment term"
            className="h-9 flex-1 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary outline-none"
          />
          <Button variant="ghost" size="sm" onClick={addTerm} disabled={newTerm.trim() === ''}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add
          </Button>
        </div>
      </Card>

      <Card variant="default" padding="md" className="space-y-3">
        <SectionLabel as="div" size="xs">
          <span className="inline-flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Critical overdue threshold</span>
        </SectionLabel>
        <p className="text-xs text-text-secondary">Days past due before an invoice is flagged as critical.</p>
        <label className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-base px-3">
          <span className="text-xs text-text-secondary">Threshold</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              min={0}
              max={365}
              className="h-9 w-20 rounded-md bg-transparent px-2 text-right font-mono text-sm text-text-primary outline-none"
              aria-label="Critical overdue threshold (days)"
            />
            <span className="text-xs text-text-muted">days</span>
          </div>
        </label>
      </Card>

      <Card variant="default" padding="md" className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel as="div" size="xs">
            <span className="inline-flex items-center gap-2"><List className="h-3.5 w-3.5" aria-hidden /> Aging report buckets</span>
          </SectionLabel>
          <Button variant="ghost" size="sm" onClick={addBucket}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add bucket
          </Button>
        </div>
        <p className="text-xs text-text-secondary">Date ranges for the accounts receivable aging report.</p>
        <ul className="space-y-2">
          {buckets.map((b) => (
            <li key={b.id} className="grid grid-cols-1 items-center gap-2 rounded-md border border-border-subtle bg-bg-base p-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
              <input
                value={b.label}
                onChange={(e) => updateBucket(b.id, { label: e.target.value })}
                aria-label={`${b.id} label`}
                className="h-9 rounded-md bg-transparent px-2 text-sm text-text-primary outline-none"
              />
              <input
                type="number"
                value={b.min}
                onChange={(e) => updateBucket(b.id, { min: Number(e.target.value) })}
                aria-label={`${b.id} min days`}
                className="h-9 w-20 rounded-md bg-bg-input px-2 text-right font-mono text-sm text-text-primary outline-none"
              />
              <span className="text-xs text-text-muted">→</span>
              <input
                type="number"
                value={b.max ?? ''}
                onChange={(e) => updateBucket(b.id, { max: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="Max"
                aria-label={`${b.id} max days`}
                className="h-9 w-20 rounded-md bg-bg-input px-2 text-right font-mono text-sm text-text-primary outline-none"
              />
              <button
                type="button"
                onClick={() => removeBucket(b.id)}
                aria-label={`Remove ${b.label}`}
                className="text-text-muted transition-colors duration-fast hover:text-danger"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* Save bar — visible only when canUpdate */}
      {canUpdate && (
        <div className="sticky bottom-0 flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-surface px-4 py-3 shadow-sm">
          {saveError !== null && (
            <p role="alert" className="text-xs text-danger">{saveError}</p>
          )}
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="primary"
              size="sm"
              disabled={!isDirty || updateMut.isPending}
              onClick={() => { void handleSave(); }}
            >
              {updateMut.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
