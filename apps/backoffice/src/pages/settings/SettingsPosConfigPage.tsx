// apps/backoffice/src/pages/settings/SettingsPosConfigPage.tsx
//
// S73 Lot 3 (audit 1.2.4) — the BO becomes the org editor for the POS presets
// the terminals consume (same RPC pair + keys as apps/pos usePOSPresets; the
// POS Settings General tab keeps its own editor). No parallel schema.
import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

interface DiscountPreset { value: number; name: string }

function asNumberArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && x > 0) : [];
}
function asDiscountArray(v: unknown): DiscountPreset[] {
  return Array.isArray(v)
    ? v.filter((x): x is DiscountPreset =>
        !!x && typeof x === 'object'
        && typeof (x as DiscountPreset).value === 'number'
        && typeof (x as DiscountPreset).name === 'string')
    : [];
}

function NumberListEditor({ title, helper, values, canEdit, isPending, onSave }: {
  title: string; helper: string; values: number[]; canEdit: boolean;
  isPending: boolean; onSave: (next: number[]) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-text-secondary">{helper}</p>
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 h-8 text-sm font-mono tabular-nums">
              {v.toLocaleString('id-ID')}
              {canEdit && (
                <button type="button" aria-label={`Remove ${v}`} disabled={isPending}
                  onClick={() => { const next = values.filter((_, j) => j !== i); if (next.length > 0) onSave(next); }}
                  className="text-red/80 hover:text-red disabled:opacity-30 p-0.5">
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <input type="number" inputMode="numeric" placeholder="e.g. 50000" value={draft}
              onChange={(e) => setDraft(e.target.value)} aria-label={`New ${title} value`}
              className="h-9 w-40 rounded-md border border-border-subtle bg-bg-input px-3 text-sm" />
            <Button variant="secondary" size="sm" disabled={isPending || draft.trim() === ''}
              onClick={() => {
                const n = Number(draft);
                if (Number.isFinite(n) && n > 0 && !values.includes(n)) { onSave([...values, n]); setDraft(''); }
              }}>
              <Plus className="h-4 w-4" aria-hidden /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPosConfigPage() {
  const canEdit = useAuthStore((s) => s.hasPermission('settings.update'));
  const { data, isLoading, error } = useSettings('pos_presets');
  const setSetting = useSetSetting();
  const [discountDraft, setDiscountDraft] = useState<{ name: string; pct: string }>({ name: '', pct: '' });

  const quick    = asNumberArray(data?.settings['pos_quick_payment_amounts']);
  const opening  = asNumberArray(data?.settings['pos_opening_cash_presets']);
  const discounts = asDiscountArray(data?.settings['pos_discount_presets']);

  const save = (key: string, value: unknown) =>
    setSetting.mutate({ key, value, category: 'pos_presets' });

  if (isLoading) return <div className="text-text-secondary">Loading…</div>;
  if (error) return <div className="text-red">Failed to load: {error.message}</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl">POS Configuration</h1>
        <p className="text-text-secondary text-sm mt-1">
          Org-wide presets consumed by every POS terminal. Audited on change.
        </p>
      </div>
      <NumberListEditor title="Quick payment amounts" helper="Cash entry buttons in the payment terminal."
        values={quick} canEdit={canEdit} isPending={setSetting.isPending}
        onSave={(next) => save('pos_quick_payment_amounts', next)} />
      <NumberListEditor title="Shift opening cash presets" helper="Tap-to-fill amounts when opening a shift."
        values={opening} canEdit={canEdit} isPending={setSetting.isPending}
        onSave={(next) => save('pos_opening_cash_presets', next)} />
      <Card>
        <CardHeader><CardTitle className="text-base">Quick discount presets</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-text-secondary">One-tap presets in the POS discount modal (cart & line).</p>
          <ul className="space-y-1">
            {discounts.map((d, i) => (
              <li key={`${d.name}-${i}`} className="flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2 text-sm">
                <span className="font-mono w-12 tabular-nums">{d.value}%</span>
                <span className="text-text-secondary">{d.name}</span>
                <span className="flex-1" />
                {canEdit && (
                  <button type="button" aria-label={`Remove ${d.name}`} disabled={setSetting.isPending}
                    onClick={() => { const next = discounts.filter((_, j) => j !== i); if (next.length > 0) save('pos_discount_presets', next); }}
                    className="text-red/80 hover:text-red disabled:opacity-30 p-1">
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="flex items-center gap-2">
              <input type="text" placeholder="Name (e.g. Staff Meal)" value={discountDraft.name}
                onChange={(e) => setDiscountDraft((d) => ({ ...d, name: e.target.value }))}
                aria-label="New discount preset name"
                className="h-9 flex-1 max-w-xs rounded-md border border-border-subtle bg-bg-input px-3 text-sm" />
              <input type="number" inputMode="numeric" placeholder="%" value={discountDraft.pct}
                onChange={(e) => setDiscountDraft((d) => ({ ...d, pct: e.target.value }))}
                aria-label="New discount preset percent"
                className="h-9 w-24 rounded-md border border-border-subtle bg-bg-input px-3 text-sm" />
              <Button variant="secondary" size="sm" disabled={setSetting.isPending || discountDraft.pct.trim() === ''}
                onClick={() => {
                  const value = Number(discountDraft.pct);
                  if (!Number.isFinite(value) || value < 0 || value > 100) return;
                  const name = discountDraft.name.trim() || `${value}%`;
                  if (discounts.some((d) => d.name === name)) return;
                  save('pos_discount_presets', [...discounts, { value, name }]);
                  setDiscountDraft({ name: '', pct: '' });
                }}>
                <Plus className="h-4 w-4" aria-hidden /> Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
