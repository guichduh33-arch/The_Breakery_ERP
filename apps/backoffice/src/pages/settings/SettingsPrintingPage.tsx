// apps/backoffice/src/pages/settings/SettingsPrintingPage.tsx
//
// S73 Lot 2 — org-level payment automation flags (business_config via
// get_settings_by_category_v1('printing') / set_setting_v1).
// The print-server URL itself stays per-terminal (POS Settings, localStorage).
import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

const FIELDS = [
  { key: 'pos_auto_print_receipt', label: 'Auto-print receipt on payment',
    helper: 'Automatically send the receipt to the print server once a payment completes.' },
  { key: 'pos_auto_open_drawer', label: 'Auto-open cash drawer (cash)',
    helper: 'Automatically kick the cash drawer open on cash payments.' },
] as const;

export default function SettingsPrintingPage() {
  const canUpdate = useAuthStore((s) => s.hasPermission('settings.update'));
  const { data, isLoading, error } = useSettings('printing');
  const setSetting = useSetSetting();
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({
      pos_auto_print_receipt: Boolean(data.settings.pos_auto_print_receipt ?? false),
      pos_auto_open_drawer: Boolean(data.settings.pos_auto_open_drawer ?? false),
    });
  }, [data]);

  const dirty = FIELDS.filter((f) => draft[f.key] !== Boolean(data?.settings[f.key] ?? false));

  async function handleSave() {
    setServerError(null);
    try {
      for (const f of dirty) {
        await setSetting.mutateAsync({ key: f.key, value: draft[f.key] ?? false, category: 'printing' });
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
                  checked={draft[f.key] ?? false}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))} />
                {f.label}
              </label>
              <p className="text-xs text-text-secondary">{f.helper}</p>
            </div>
          ))}
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
