// apps/backoffice/src/pages/settings/SettingsPrintingPage.tsx
//
// S73 Lot 2 — org-level payment automation flags (business_config via
// get_settings_by_category_v5('printing') / set_setting_v7).
// Chantier KOT copies (2026-07-18) — + copies du ticket cuisine papier par
// station à l'envoi (0 = pas de papier, le KDS écran reçoit toujours).
// The print-server URL itself stays per-terminal (POS Settings, localStorage).
import { useEffect, useState } from 'react';
import { Button, Input } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

const FIELDS = [
  { key: 'pos_auto_print_receipt', label: 'Auto-print receipt on payment',
    helper: 'Automatically send the receipt to the print server once a payment completes.' },
  { key: 'pos_auto_open_drawer', label: 'Auto-open cash drawer (cash)',
    helper: 'Automatically kick the cash drawer open on cash payments.' },
] as const;

// Copies du KOT papier par station prep, [0, 5] (validation set_setting_v7).
const KOT_FIELDS = [
  { key: 'kot_copies_kitchen', label: 'Kitchen' },
  { key: 'kot_copies_barista', label: 'Barista' },
  { key: 'kot_copies_display', label: 'Display (vitrine)' },
] as const;

type DraftValue = boolean | number;

function clampCopies(raw: number): number {
  if (Number.isNaN(raw)) return 0;
  return Math.min(5, Math.max(0, Math.trunc(raw)));
}

export default function SettingsPrintingPage() {
  const canUpdate = useAuthStore((s) => s.hasPermission('settings.update'));
  const { data, isLoading, error } = useSettings('printing');
  const setSetting = useSetSetting();
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({
      // DB columns are NOT NULL DEFAULT true and the POS falls back to true —
      // mirror that here so a missing key never renders as OFF while POS runs ON.
      pos_auto_print_receipt: Boolean(data.settings.pos_auto_print_receipt ?? true),
      pos_auto_open_drawer: Boolean(data.settings.pos_auto_open_drawer ?? true),
      // KOT copies: NOT NULL DEFAULT 1, POS falls back to 1 — same mirror.
      kot_copies_kitchen: Number(data.settings.kot_copies_kitchen ?? 1),
      kot_copies_barista: Number(data.settings.kot_copies_barista ?? 1),
      kot_copies_display: Number(data.settings.kot_copies_display ?? 1),
    });
  }, [data]);

  const dirtyToggles = FIELDS.filter(
    (f) => draft[f.key] !== Boolean(data?.settings[f.key] ?? true),
  );
  const dirtyCopies = KOT_FIELDS.filter(
    (f) => draft[f.key] !== Number(data?.settings[f.key] ?? 1),
  );
  const dirty = [...dirtyToggles, ...dirtyCopies];

  async function handleSave() {
    setServerError(null);
    try {
      for (const f of dirtyToggles) {
        await setSetting.mutateAsync({ key: f.key, value: Boolean(draft[f.key]), category: 'printing' });
      }
      for (const f of dirtyCopies) {
        await setSetting.mutateAsync({ key: f.key, value: Number(draft[f.key] ?? 1), category: 'printing' });
      }
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-serif text-3xl">Printing</h1>
        <p className="text-text-secondary text-sm mt-1">
          Org-wide payment automation. The print-server URL stays per-terminal (POS Settings).
        </p>
      </div>
      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {error && <div className="text-red">Failed to load: {error.message}</div>}
      {!isLoading && !error && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label htmlFor={f.key} className="flex items-center gap-3 text-sm font-medium">
                <input id={f.key} type="checkbox" disabled={!canUpdate}
                  checked={Boolean(draft[f.key] ?? true)}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))} />
                {f.label}
              </label>
              <p className="text-xs text-text-secondary">{f.helper}</p>
            </div>
          ))}

          <div className="space-y-3 pt-2 border-t border-border-subtle">
            <div>
              <h2 className="text-sm font-medium">Kitchen tickets (KOT)</h2>
              <p className="text-xs text-text-secondary">
                Paper copies printed per prep station on every Send to Kitchen.
                0 = no paper for that station — the KDS screen still receives the order.
              </p>
            </div>
            {KOT_FIELDS.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <label htmlFor={f.key} className="text-sm font-medium w-40">{f.label}</label>
                <Input id={f.key} type="number" min={0} max={5} step={1}
                  className="w-24" disabled={!canUpdate}
                  value={String(draft[f.key] ?? 1)}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: clampCopies(e.target.valueAsNumber) }))} />
                <span className="text-xs text-text-muted">copies (0–5)</span>
              </div>
            ))}
          </div>

          {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
          {canUpdate && (
            <Button type="submit" variant="primary" disabled={dirty.length === 0 || setSetting.isPending}>
              {setSetting.isPending ? 'Saving…' : dirty.length === 0 ? 'No changes' : `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
