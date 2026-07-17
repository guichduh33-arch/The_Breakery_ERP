// apps/backoffice/src/pages/settings/SettingsKdsConfigPage.tsx
//
// S75 Task 8 — org-level KDS ticket-age thresholds (business_config via
// get_settings_by_category_v2('kds') / set_setting_v3, migration
// 20260712000163). Warning/urgent color-band minutes + auto-archive delay
// for served/bumped tickets, read by every kitchen display terminal.
//
// Anti-P0001 save order: set_setting_v3 validates warning < urgent against
// the OTHER key's CURRENTLY STORED value on each call, so saving both keys
// in the wrong order 22023s (e.g. old 5/10 -> new 11/15: saving warning=11
// first compares against the still-stored urgent=10 and fails). We save
// whichever of warning/urgent moves away from the other first: urgent first
// when it's increasing, warning first otherwise. Archive is independent and
// always saved last.
import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

const WARNING_KEY = 'kds_warning_threshold_minutes';
const URGENT_KEY = 'kds_urgent_threshold_minutes';
const ARCHIVE_KEY = 'kds_auto_archive_minutes';

const FIELDS = [
  {
    key: WARNING_KEY,
    label: 'Warning threshold (minutes)',
    helper: 'Tickets older than this turn amber on the kitchen display. Applied to all KDS screens within ~1 min.',
  },
  {
    key: URGENT_KEY,
    label: 'Urgent threshold (minutes)',
    helper: 'Tickets older than this turn red on the kitchen display. Applied to all KDS screens within ~1 min.',
  },
  {
    key: ARCHIVE_KEY,
    label: 'Ready auto-archive (minutes)',
    helper: 'Served/bumped tickets drop off the board after this many minutes. Applied to all KDS screens within ~1 min.',
  },
] as const;

// jsonb numeric settings decode as `unknown` — narrow before rendering
// (avoids "NaN"/[object Object] footguns on malformed rows).
function asNumberString(v: unknown): string {
  return typeof v === 'number' ? String(v) : '';
}

export default function SettingsKdsConfigPage() {
  const canUpdate = useAuthStore((s) => s.hasPermission('settings.update'));
  const { data, isLoading, error } = useSettings('kds');
  const setSetting = useSetSetting();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({
      [WARNING_KEY]: asNumberString(data.settings[WARNING_KEY]),
      [URGENT_KEY]: asNumberString(data.settings[URGENT_KEY]),
      [ARCHIVE_KEY]: asNumberString(data.settings[ARCHIVE_KEY]),
    });
  }, [data]);

  const dirty = FIELDS.filter((f) => draft[f.key] !== asNumberString(data?.settings[f.key]));

  const rangeInvalidField = FIELDS.find((f) => {
    if (draft[f.key] === undefined || draft[f.key] === '') return false;
    const n = Number(draft[f.key]);
    return !Number.isInteger(n) || n < 1 || n > 120;
  });
  const warningNum = Number(draft[WARNING_KEY]);
  const urgentNum = Number(draft[URGENT_KEY]);
  const clientError = rangeInvalidField
    ? `${rangeInvalidField.label} must be a whole number between 1 and 120.`
    : draft[WARNING_KEY] && draft[URGENT_KEY] && warningNum >= urgentNum
      ? 'Warning threshold must be less than urgent threshold.'
      : null;

  async function handleSave() {
    setServerError(null);
    try {
      const dirtyKeys = dirty.map((f) => f.key);
      const bothWarningUrgentDirty = dirtyKeys.includes(WARNING_KEY) && dirtyKeys.includes(URGENT_KEY);

      let order: string[];
      if (bothWarningUrgentDirty) {
        const oldUrgent = Number(data?.settings[URGENT_KEY]);
        const newUrgent = Number(draft[URGENT_KEY]);
        order = newUrgent > oldUrgent ? [URGENT_KEY, WARNING_KEY] : [WARNING_KEY, URGENT_KEY];
      } else {
        order = dirtyKeys.filter((k) => k !== ARCHIVE_KEY);
      }
      if (dirtyKeys.includes(ARCHIVE_KEY)) order.push(ARCHIVE_KEY);

      for (const key of order) {
        await setSetting.mutateAsync({ key, value: Number(draft[key]), category: 'kds' });
      }
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-serif text-3xl">KDS Configuration</h1>
        <p className="text-text-secondary text-sm mt-1">
          Ticket-age warning/urgent color bands + ready auto-archive delay, shared by every kitchen display terminal. Audited on change.
        </p>
      </div>
      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {error && <div className="text-red">Failed to load: {error.message}</div>}
      {!isLoading && !error && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label htmlFor={f.key} className="text-sm font-medium">{f.label}</label>
              <input
                id={f.key}
                type="number"
                min={1}
                max={120}
                disabled={!canUpdate}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50"
              />
              <p className="text-xs text-text-secondary">{f.helper}</p>
            </div>
          ))}
          {clientError && <p className="text-red text-sm" role="alert">{clientError}</p>}
          {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
          {canUpdate && (
            <Button
              type="submit"
              variant="primary"
              disabled={dirty.length === 0 || Boolean(clientError) || setSetting.isPending}
            >
              {setSetting.isPending ? 'Saving…' : dirty.length === 0 ? 'No changes' : `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
