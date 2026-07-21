// apps/backoffice/src/pages/settings/SettingsCustomerDisplayPage.tsx
//
// S73 Lot 2 — org-level customer display copy (business_config via
// get_settings_by_category_v4('customer_display') / set_setting_v5).
// The POS display reads the same keys; '' = built-in default.
import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

const FIELDS = [
  { key: 'display_footer_message', label: 'Idle footer message', max: 120,
    helper: "Shown when no order is active. Blank = built-in default (Open daily · 07:00 — 21:00)." },
  { key: 'display_slogan', label: 'Brand slogan', max: 80,
    helper: 'Shown under the logo. Blank = built-in default (French Bakery & Pastry).' },
] as const;

// jsonb text settings decode as `unknown` — narrow instead of String()'ing
// arbitrary values (avoids [object Object] footguns on malformed rows).
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export default function SettingsCustomerDisplayPage() {
  const canUpdate = useAuthStore((s) => s.hasPermission('settings.update'));
  const { data, isLoading, error } = useSettings('customer_display');
  const setSetting = useSetSetting();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({
      display_footer_message: asString(data.settings.display_footer_message),
      display_slogan: asString(data.settings.display_slogan),
    });
  }, [data]);

  const dirty = FIELDS.filter((f) => draft[f.key] !== asString(data?.settings[f.key]));

  async function handleSave() {
    setServerError(null);
    try {
      for (const f of dirty) {
        await setSetting.mutateAsync({ key: f.key, value: draft[f.key] ?? '', category: 'customer_display' });
      }
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-serif text-3xl">Customer Display</h1>
        <p className="text-text-secondary text-sm mt-1">
          Copy shown on every customer-facing display (all terminals). Audited on change.
        </p>
      </div>
      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {error && <div className="text-red">Failed to load: {error.message}</div>}
      {!isLoading && !error && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label htmlFor={f.key} className="text-sm font-medium">{f.label}</label>
              <input id={f.key} type="text" maxLength={f.max} disabled={!canUpdate}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
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
