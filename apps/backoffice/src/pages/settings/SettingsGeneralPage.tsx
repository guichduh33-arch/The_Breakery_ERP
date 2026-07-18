// apps/backoffice/src/pages/settings/SettingsGeneralPage.tsx
//
// Session 13 / Phase 5.C — General settings page. Surfaces the four
// symbolic categories of business_config (business / localization / tax / pos)
// in a single flat form. Each "Save" calls set_setting_v4 per dirty key so the
// audit trail captures one row per field change.
//
// S73 B4 — currency/timezone become ISO-4217/IANA <select> pickers, tax_rate
// and the two `_pct` thresholds render as percent inputs (DB stays decimal
// [0,1] — only the display multiplies/divides by 100), and fields split into
// an Identity/Cash section layout.

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { BrandLogoUploader } from '@/features/settings/components/BrandLogoUploader.js';
import { useSettings, type SettingsCategory } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

type FieldType = 'text' | 'number' | 'boolean' | 'select' | 'percent' | 'logo';

interface FieldSpec {
  key:       string;
  label:     string;
  type:      FieldType;
  category:  SettingsCategory;
  section:   'identity' | 'cash';
  nullable?: boolean;
  helper?:   string;
  options?:  readonly string[];
}

const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'AUD', 'JPY', 'CNY', 'GBP'] as const;
const TIMEZONES: readonly string[] =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Asia/Makassar', 'Asia/Jakarta', 'UTC'];

const SECTIONS = [
  ['identity', 'Identity & locale'],
  ['cash', 'Caisse — shift controls'],
] as const;

const FIELDS: FieldSpec[] = [
  { key: 'name',           label: 'Business name',  type: 'text',    category: 'business',     section: 'identity' },
  { key: 'fiscal_address', label: 'Fiscal address', type: 'text',    category: 'business',     section: 'identity', nullable: true },
  // 2026-07-16 (Settings §6.A) — identity rendered on documents: NPWP + phone
  // on the POS receipt header and PDF headers, logo embedded in PDFs/emails.
  { key: 'npwp',           label: 'NPWP (tax ID)',  type: 'text',    category: 'business',     section: 'identity', nullable: true, helper: 'The bakery’s own NPWP — printed on receipts and B2B invoices when set' },
  { key: 'phone',          label: 'Business phone', type: 'text',    category: 'business',     section: 'identity', nullable: true, helper: 'Printed on the POS receipt header when set' },
  { key: 'logo_url',       label: 'Brand logo',     type: 'logo',    category: 'business',     section: 'identity', nullable: true, helper: 'PNG or JPEG, 1 MB max — embedded in PDF headers and emails' },
  { key: 'currency',       label: 'Currency code',  type: 'select',  category: 'localization', section: 'identity', options: CURRENCIES, helper: 'ISO-4217 (e.g. IDR, USD)' },
  { key: 'timezone',       label: 'Timezone',       type: 'select',  category: 'localization', section: 'identity', options: TIMEZONES, helper: 'IANA zone (e.g. Asia/Makassar)' },
  { key: 'tax_rate',       label: 'Tax rate',       type: 'percent', category: 'tax',          section: 'identity', helper: 'Percent — e.g. 10 for 10%' },
  { key: 'tax_inclusive',  label: 'Tax inclusive',  type: 'boolean', category: 'tax',          section: 'identity', helper: 'When true, listed prices include tax' },
  { key: 'shift_variance_threshold_pct', label: 'Shift variance % threshold', type: 'percent', category: 'pos', section: 'cash', helper: 'Percent — e.g. 0.5 for 0.5%' },
  { key: 'shift_variance_threshold_abs', label: 'Shift variance abs threshold', type: 'number', category: 'pos', section: 'cash', helper: 'IDR' },
  // S66 (12 D2.1) — above these (higher) thresholds, close_shift_v5 also
  // requires a designated manager + 6-digit PIN on top of the variance note.
  { key: 'shift_variance_pin_threshold_pct', label: 'Manager-PIN variance % threshold', type: 'percent', category: 'pos', section: 'cash', helper: 'Percent — e.g. 2 for 2% — large variances need a manager PIN at close' },
  { key: 'shift_variance_pin_threshold_abs', label: 'Manager-PIN variance abs threshold', type: 'number', category: 'pos', section: 'cash', helper: 'IDR — large variances need a manager PIN at close' },
  // S67 (12 D2.3) — when true the POS forces the cash count (open & close)
  // through the IDR denomination grid; close_shift_v5 enforces it server-side.
  { key: 'shift_denomination_count_enabled', label: 'Denomination count required', type: 'boolean', category: 'pos', section: 'cash', helper: 'When on, opening/closing cash must be counted note-by-note (grid)' },
];

type DraftValue = string | number | boolean | null;

function valueFromAny(v: unknown): DraftValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string')  return v;
  if (typeof v === 'number')  return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object')  return JSON.stringify(v);
  // Unreachable for JSONB-sourced settings (only bigint/symbol/function left).
  return null;
}

// `percent` fields are stored in the DB as a [0,1] decimal but displayed as
// a [0,100] percent — this is the ONLY place the conversion happens on read.
function hydrateValue(f: FieldSpec, raw: unknown): DraftValue {
  const v = valueFromAny(raw);
  if (f.type !== 'percent' || v === null) return v;
  const n = typeof v === 'number' ? v : Number(v);
  // Round to avoid float artifacts like 10.000000000000002.
  return Math.round(n * 100 * 10000) / 10000;
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
  // Lot 6b — the tax-mode switch is a money-path decision: it changes how
  // retail_price is interpreted (tax-inclusive vs tax-exclusive) WITHOUT
  // converting any price, and the server (set_setting_v4) refuses it while
  // open orders exist. Saving a changed `tax_inclusive` goes through an
  // explicit confirmation dialog first.
  const [taxSwitchConfirmOpen, setTaxSwitchConfirmOpen] = useState(false);

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
      next[f.key] = hydrateValue(f, cat.settings[f.key]);
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
      next[f.key] = cat ? hydrateValue(f, cat.settings[f.key]) : null;
    }
    return next;
  }, [business.data, localization.data, tax.data, pos.data]);

  const isLoading = business.isLoading || localization.isLoading || tax.isLoading || pos.isLoading;
  const loadError = business.error ?? localization.error ?? tax.error ?? pos.error;

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

  function handleSave() {
    // Intercept a changed tax mode: confirm before writing anything.
    if (dirtyKeys.includes('tax_inclusive')) {
      setTaxSwitchConfirmOpen(true);
      return;
    }
    void performSave();
  }

  async function performSave() {
    setServerError(null);
    try {
      for (const k of dirtyKeys) {
        const f = FIELDS.find((x) => x.key === k);
        if (!f) continue;
        const v = draft[k];
        // Coerce per field type to match the RPC's strict jsonb_typeof checks.
        let payload: unknown;
        if (f.type === 'number' || f.type === 'percent') {
          if (v === '' || v === null) {
            setServerError(`${f.label} cannot be empty`);
            return;
          }
          const n = typeof v === 'number' ? v : Number(v);
          if (!Number.isFinite(n)) {
            setServerError(`${f.label} must be a number`);
            return;
          }
          if (f.type === 'percent') {
            if (n < 0 || n > 100) {
              setServerError(`${f.label} must be between 0 and 100`);
              return;
            }
            // Display is percent [0,100] — the RPC/DB stay decimal [0,1].
            payload = n / 100;
          } else {
            payload = n;
          }
        } else if (f.type === 'boolean') {
          payload = Boolean(v);
        } else {
          // text / select
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
      // useSetSetting rethrows the PostgrestError as-is — read `message`
      // structurally rather than via instanceof Error.
      const msg = (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string')
        ? e.message
        : 'Failed to save settings';
      // set_setting_v4 (Lot 6b) refuses the tax-mode switch while open orders
      // exist — surface an actionable message instead of the raw error code.
      setServerError(msg === 'tax_mode_switch_blocked'
        ? 'Tax mode switch refused — some orders are still open (draft or pending payment). Settle or void them, then save again.'
        : msg);
    }
  }

  const taxSwitchTargetInclusive = Boolean(draft.tax_inclusive);

  return (
    <div className="space-y-6 max-w-3xl">
      <Dialog open={taxSwitchConfirmOpen} onOpenChange={setTaxSwitchConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch the tax mode?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  You are switching the shop to{' '}
                  <strong>
                    {taxSwitchTargetInclusive
                      ? 'tax-inclusive prices (PB1 embedded in listed prices)'
                      : 'tax-exclusive prices (PB1 added on top at checkout)'}
                  </strong>.
                </p>
                <p>
                  Listed prices are <strong>not converted</strong> — this setting only changes
                  how every price is interpreted. A product listed at Rp 35,000 will charge the
                  customer {taxSwitchTargetInclusive ? 'Rp 35,000 (tax included)' : 'Rp 35,000 + PB1'}.
                </p>
                <p>
                  The switch is refused while open orders exist (draft or pending payment) —
                  settle or void them first.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTaxSwitchConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setTaxSwitchConfirmOpen(false);
                void performSave();
              }}
            >
              Switch tax mode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <h1 className="font-serif text-3xl">General settings</h1>
        <p className="text-text-secondary text-sm mt-1">
          Business identity, localisation, tax, and shift controls. Every change writes an audit log entry.
        </p>
      </div>

      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {loadError && <div className="text-red">Failed to load: {loadError.message}</div>}

      {!isLoading && !loadError && (
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          {SECTIONS.map(([section, sectionLabel]) => (
            <div key={section} className="space-y-5">
              <h2 className="font-serif text-xl pt-2">{sectionLabel}</h2>
              {FIELDS.filter((f) => f.section === section).map((f) => {
                const v = draft[f.key];
                const inputId = `setting-${f.key}`;
                return (
                  <div key={f.key} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                    <label htmlFor={inputId} className="text-sm font-medium pt-2">
                      {f.label}
                    </label>
                    <div className="md:col-span-2 space-y-1">
                      {f.type === 'logo' ? (
                        <BrandLogoUploader
                          logoUrl={v === null ? null : String(v)}
                          readOnly={!canUpdate}
                          onChange={(url) => setDraft((d) => ({ ...d, [f.key]: url }))}
                        />
                      ) : f.type === 'boolean' ? (
                        <label className="inline-flex items-center gap-2 text-sm pt-2">
                          <input id={inputId} type="checkbox" checked={Boolean(v)} disabled={!canUpdate}
                            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))} />
                          <span>{Boolean(v) ? 'Yes' : 'No'}</span>
                        </label>
                      ) : f.type === 'select' ? (
                        <select id={inputId} disabled={!canUpdate}
                          value={v === null ? '' : String(v)}
                          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                          className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50">
                          {(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'percent' ? (
                        <div className="flex items-center gap-2">
                          <input id={inputId} type="number" min={0} max={100} step="any" disabled={!canUpdate}
                            value={v === null ? '' : String(v)}
                            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
                          <span className="text-sm text-text-secondary">%</span>
                        </div>
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
            </div>
          ))}

          {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
          {savedAt && dirtyKeys.length === 0 && (
            <p className="text-success text-xs" role="status">Saved at {savedAt}</p>
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
