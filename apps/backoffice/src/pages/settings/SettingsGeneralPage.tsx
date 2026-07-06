// apps/backoffice/src/pages/settings/SettingsGeneralPage.tsx
//
// Session 13 / Phase 5.C — General settings page. Surfaces the four
// symbolic categories of business_config (business / localization / tax / pos)
// in a single flat form. Each "Save" calls set_setting_v1 per dirty key so the
// audit trail captures one row per field change.

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings, type SettingsCategory } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

type FieldType = 'text' | 'number' | 'boolean';

interface FieldSpec {
  key:       string;
  label:     string;
  type:      FieldType;
  category:  SettingsCategory;
  nullable?: boolean;
  helper?:   string;
}

const FIELDS: FieldSpec[] = [
  { key: 'name',           label: 'Business name',  type: 'text',    category: 'business'     },
  { key: 'fiscal_address', label: 'Fiscal address', type: 'text',    category: 'business', nullable: true },
  { key: 'currency',       label: 'Currency code',  type: 'text',    category: 'localization', helper: 'ISO-4217 (e.g. IDR, USD)' },
  { key: 'timezone',       label: 'Timezone',       type: 'text',    category: 'localization', helper: 'IANA zone (e.g. Asia/Makassar)' },
  { key: 'tax_rate',       label: 'Tax rate',       type: 'number',  category: 'tax', helper: 'Decimal 0..1 (0.10 = 10%)' },
  { key: 'tax_inclusive',  label: 'Tax inclusive',  type: 'boolean', category: 'tax', helper: 'When true, listed prices include tax' },
  { key: 'shift_variance_threshold_pct', label: 'Shift variance % threshold', type: 'number', category: 'pos', helper: 'Decimal 0..1 (0.005 = 0.5%)' },
  { key: 'shift_variance_threshold_abs', label: 'Shift variance abs threshold', type: 'number', category: 'pos', helper: 'IDR' },
  // S66 (12 D2.1) — above these (higher) thresholds, close_shift_v4 also
  // requires a designated manager + 6-digit PIN on top of the variance note.
  { key: 'shift_variance_pin_threshold_pct', label: 'Manager-PIN variance % threshold', type: 'number', category: 'pos', helper: 'Decimal 0..1 (0.02 = 2%) — large variances need a manager PIN at close' },
  { key: 'shift_variance_pin_threshold_abs', label: 'Manager-PIN variance abs threshold', type: 'number', category: 'pos', helper: 'IDR — large variances need a manager PIN at close' },
];

type DraftValue = string | number | boolean | null;

function valueFromAny(v: unknown): DraftValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string')  return v;
  if (typeof v === 'number')  return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object')  return JSON.stringify(v);
  return String(v);
}

export default function SettingsGeneralPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const business     = useSettings('business');
  const localization = useSettings('localization');
  const tax          = useSettings('tax');
  const pos          = useSettings('pos');

  const setSetting = useSetSetting();

  const [draft, setDraft]             = useState<Record<string, DraftValue>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt]         = useState<string | null>(null);

  // Hydrate the draft once all four categories load.
  useEffect(() => {
    if (!business.data || !localization.data || !tax.data || !pos.data) return;
    const next: Record<string, DraftValue> = {};
    for (const f of FIELDS) {
      const cat =
        f.category === 'business'     ? business.data :
        f.category === 'localization' ? localization.data :
        f.category === 'tax'          ? tax.data :
        pos.data;
      next[f.key] = valueFromAny(cat.settings[f.key]);
    }
    setDraft(next);
  }, [business.data, localization.data, tax.data, pos.data]);

  const original = useMemo<Record<string, DraftValue>>(() => {
    const next: Record<string, DraftValue> = {};
    for (const f of FIELDS) {
      const cat =
        f.category === 'business'     ? business.data :
        f.category === 'localization' ? localization.data :
        f.category === 'tax'          ? tax.data :
        pos.data;
      next[f.key] = cat ? valueFromAny(cat.settings[f.key]) : null;
    }
    return next;
  }, [business.data, localization.data, tax.data, pos.data]);

  const isLoading = business.isLoading || localization.isLoading || tax.isLoading || pos.isLoading;
  const loadError = business.error || localization.error || tax.error || pos.error;

  const dirtyKeys = useMemo(() => {
    const keys: string[] = [];
    for (const f of FIELDS) {
      if (draft[f.key] !== original[f.key]) keys.push(f.key);
    }
    return keys;
  }, [draft, original]);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view settings.</div>;
  }

  async function handleSave() {
    setServerError(null);
    try {
      for (const k of dirtyKeys) {
        const f = FIELDS.find((x) => x.key === k);
        if (!f) continue;
        const v = draft[k];
        // Coerce per field type to match the RPC's strict jsonb_typeof checks.
        let payload: unknown;
        if (f.type === 'number') {
          if (v === '' || v === null) {
            setServerError(`${f.label} cannot be empty`);
            return;
          }
          const n = typeof v === 'number' ? v : Number(v);
          if (!Number.isFinite(n)) {
            setServerError(`${f.label} must be a number`);
            return;
          }
          payload = n;
        } else if (f.type === 'boolean') {
          payload = Boolean(v);
        } else {
          // text
          if (v === null || v === '') {
            if (f.nullable === true) {
              payload = null;
            } else {
              setServerError(`${f.label} is required`);
              return;
            }
          } else {
            payload = String(v);
          }
        }
        await setSetting.mutateAsync({ key: k, value: payload, category: f.category });
      }
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to save settings');
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl">General settings</h1>
        <p className="text-text-secondary text-sm mt-1">
          Business identity, localisation, tax, and shift controls. Every change writes an audit log entry.
        </p>
      </div>

      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {loadError && <div className="text-red">Failed to load: {loadError.message}</div>}

      {!isLoading && !loadError && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          {FIELDS.map((f) => {
            const v = draft[f.key];
            const inputId = `setting-${f.key}`;
            return (
              <div key={f.key} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                <label htmlFor={inputId} className="text-sm font-medium pt-2">
                  {f.label}
                </label>
                <div className="md:col-span-2 space-y-1">
                  {f.type === 'boolean' ? (
                    <label className="inline-flex items-center gap-2 text-sm pt-2">
                      <input id={inputId} type="checkbox" checked={Boolean(v)} disabled={!canUpdate}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))} />
                      <span>{Boolean(v) ? 'Yes' : 'No'}</span>
                    </label>
                  ) : f.type === 'number' ? (
                    <input id={inputId} type="number" step="any" disabled={!canUpdate}
                      value={v === null ? '' : String(v)}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
                  ) : (
                    <input id={inputId} type="text" disabled={!canUpdate} maxLength={500}
                      value={v === null ? '' : String(v)}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
                  )}
                  {f.helper && <p className="text-xs text-text-secondary">{f.helper}</p>}
                </div>
              </div>
            );
          })}

          {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
          {savedAt && dirtyKeys.length === 0 && (
            <p className="text-emerald-700 text-xs" role="status">Saved at {savedAt}</p>
          )}

          {canUpdate && (
            <Button type="submit" variant="primary" disabled={dirtyKeys.length === 0 || setSetting.isPending}>
              {setSetting.isPending
                ? 'Saving…'
                : dirtyKeys.length === 0
                  ? 'No changes'
                  : `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
