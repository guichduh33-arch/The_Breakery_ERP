// apps/backoffice/src/pages/settings/SettingsBusinessHoursPage.tsx
// ADR-006 déc. 9 — horaires d'ouverture par jour de semaine. Écrit
// business_config.business_hours via set_setting_v8 (audité old/new) :
// { "mon": {"open":"07:00","close":"22:00"}, ..., "sun": null }.
// null = jour fermé ; clé absente = jour jamais configuré (le rapport
// Off-Hours Sales ne marque alors rien pour ce jour). Le premier Save
// écrit les 7 jours explicitement.

import { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const;
type DayKey = (typeof DAYS)[number]['key'];

interface DayDraft {
  open:   boolean; // false = fermé (null côté serveur)
  from:   string;  // HH:MM
  until:  string;  // HH:MM
}
type Draft = Record<DayKey, DayDraft>;

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// Serveur → draft. Jour absent ou null → fermé (times par défaut pour le
// jour où l'opérateur l'ouvre).
function parseHours(raw: unknown): Draft {
  const cfg = (raw !== null && typeof raw === 'object' && !Array.isArray(raw))
    ? (raw as Record<string, unknown>)
    : {};
  const out = {} as Draft;
  for (const { key } of DAYS) {
    const day = cfg[key];
    if (day !== null && typeof day === 'object' && !Array.isArray(day)) {
      const d = day as Record<string, unknown>;
      out[key] = {
        open: true,
        from:  typeof d.open  === 'string' ? d.open  : '07:00',
        until: typeof d.close === 'string' ? d.close : '22:00',
      };
    } else {
      out[key] = { open: false, from: '07:00', until: '22:00' };
    }
  }
  return out;
}

// Draft → valeur persistée : les 7 jours explicites, null = fermé.
function hoursFromDraft(draft: Draft): Record<DayKey, { open: string; close: string } | null> {
  return Object.fromEntries(
    DAYS.map(({ key }) => [
      key,
      draft[key].open ? { open: draft[key].from, close: draft[key].until } : null,
    ]),
  ) as Record<DayKey, { open: string; close: string } | null>;
}

function sameHours(a: Draft, b: Draft): boolean {
  return DAYS.every(({ key }) =>
    a[key].open === b[key].open
    && (!a[key].open || (a[key].from === b[key].from && a[key].until === b[key].until)));
}

export default function SettingsBusinessHoursPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const business   = useSettings('business');
  const setSetting = useSetSetting();

  const [draft, setDraft]   = useState<Draft | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [savedAt, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!business.data) return;
    setDraft(parseHours(business.data.settings.business_hours));
  }, [business.data]);

  if (!canRead) {
    return <div className="text-text-secondary">Accès refusé aux réglages.</div>;
  }

  const original = business.data ? parseHours(business.data.settings.business_hours) : null;
  const invalid = draft !== null && DAYS.some(({ key }) => {
    const d = draft[key];
    return d.open && (!HHMM.test(d.from) || !HHMM.test(d.until) || d.from >= d.until);
  });
  const dirty = draft !== null && original !== null && !invalid && !sameHours(draft, original);

  function patchDay(key: DayKey, patch: Partial<DayDraft>) {
    setDraft((prev) => (prev === null ? prev : { ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function handleSave() {
    if (draft === null || !dirty) return;
    setError(null);
    setSaved(null);
    setSetting.mutate(
      { key: 'business_hours', value: hoursFromDraft(draft), category: 'business' },
      {
        onSuccess: () => { setSaved(new Date().toLocaleTimeString()); },
        onError:   (e) => { setError(e.message); },
      },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Hours"
        subtitle="Opening window per weekday — sales taken outside it are flagged in the Off-Hours Sales report."
      />
      <Card>
        <CardHeader>
          <CardTitle>Weekly schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {business.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
          {business.error !== null && (
            <p className="text-sm text-danger" role="alert">Failed to load settings.</p>
          )}
          {draft !== null && (
            <div className="space-y-2">
              {DAYS.map(({ key, label }) => {
                const d = draft[key];
                const rowInvalid = d.open && (!HHMM.test(d.from) || !HHMM.test(d.until) || d.from >= d.until);
                return (
                  <div key={key} className="flex flex-wrap items-center gap-4 border-b border-border-subtle py-2 last:border-b-0">
                    <label className="flex w-40 items-center gap-3">
                      <input
                        type="checkbox"
                        data-testid={`bh-open-${key}`}
                        checked={d.open}
                        disabled={!canUpdate}
                        onChange={(e) => patchDay(key, { open: e.target.checked })}
                        className="h-4 w-4 accent-gold"
                      />
                      <span className="text-sm font-medium">{label}</span>
                    </label>
                    {d.open ? (
                      <div className="flex items-center gap-2 text-sm">
                        <input
                          type="time"
                          data-testid={`bh-from-${key}`}
                          value={d.from}
                          disabled={!canUpdate}
                          onChange={(e) => patchDay(key, { from: e.target.value })}
                          className="rounded-md border border-border-subtle bg-bg-input px-2 py-1"
                        />
                        <span className="text-text-secondary">to</span>
                        <input
                          type="time"
                          data-testid={`bh-until-${key}`}
                          value={d.until}
                          disabled={!canUpdate}
                          onChange={(e) => patchDay(key, { until: e.target.value })}
                          className="rounded-md border border-border-subtle bg-bg-input px-2 py-1"
                        />
                        {rowInvalid && (
                          <span className="text-xs text-danger">Opening must precede closing.</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm uppercase tracking-widest text-text-muted">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button
              variant="gold"
              onClick={handleSave}
              disabled={!canUpdate || !dirty || setSetting.isPending}
              data-testid="bh-save"
            >
              {setSetting.isPending ? 'Saving…' : dirty ? 'Save business hours' : 'No changes'}
            </Button>
            {invalid && <span className="text-sm text-danger">Fix the invalid time windows first.</span>}
            {error !== null && <span className="text-sm text-danger" role="alert">{error}</span>}
            {savedAt !== null && <span className="text-sm text-text-secondary">Saved at {savedAt}.</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
