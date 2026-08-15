// apps/backoffice/src/features/reports/components/PeriodControl.tsx
//
// Lot B (campagne Reports 2026-08-15) — le contrôle de période de l'archétype
// Report (maquette 4c) : le PREMIER bouton d'action du bandeau, pas une ligne
// de filtres. Un bouton 32 px « calendar » ouvre un panneau flottant (presets +
// plage libre) ; le bouton « Compare » est à côté, état porté par
// `aria-pressed`. Remplace DateRangePicker, DateRangePickerWithCompare et les
// deux checkbox maison du module.

import type { JSX } from 'react';
import { Calendar, ChevronDown, GitCompareArrows } from 'lucide-react';
import { Input, cn, selectClassName } from '@breakery/ui';
import { toLocalDateStr } from '@breakery/domain';
import { TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import {
  PRESET_LABELS, monthRange, presetRange,
  type PeriodPreset, type ReportPeriod,
} from '../hooks/useReportPeriod.js';
import { useDismissablePanel } from './useDismissablePanel.js';

/** « 5 Aug » — la date métier est un YYYY-MM-DD : on formate en UTC pour ne
 *  pas la décaler d'un jour sous un fuseau navigateur négatif. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Mois et année portés par une borne métier. */
function partsOf(iso: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m !== null
    ? { year: Number(m[1]), month: Number(m[2]) }
    : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
}

function buttonLabel(period: ReportPeriod, variant: PeriodVariant): string {
  if (variant === 'month') {
    const { year, month } = partsOf(period.start);
    return `${MONTH_NAMES[month - 1] ?? String(month)} ${year}`;
  }
  if (variant === 'as-of') return `As of ${shortDate(period.end)}`;
  if (period.preset !== 'custom') return PRESET_LABELS[period.preset];
  if (period.start === period.end) return shortDate(period.start);
  return `${shortDate(period.start)} – ${shortDate(period.end)}`;
}

const PRESET_ORDER = Object.keys(PRESET_LABELS) as Exclude<PeriodPreset, 'custom'>[];

const PANEL_ITEM = cn(
  'w-full rounded-sm px-2 py-1.5 text-left text-sm',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
);

/**
 * Extension lot E — trois formes de période, une seule ossature.
 *
 *  · `range`  — la plage (défaut), inchangée ;
 *  · `month`  — le rapport n'existe qu'au mois (PB1) : sélecteur mois + année,
 *    les presets journaliers n'auraient aucun sens ;
 *  · `as-of`  — une PHOTO d'état (bilan) : une seule date. Afficher « From /
 *    To » sur un instantané laisserait croire à une fenêtre cumulée.
 */
export type PeriodVariant = 'range' | 'month' | 'as-of';

export interface PeriodControlProps {
  period: ReportPeriod;
  /** Affiche le bouton « Compare » (période précédente symétrique). */
  showCompare?: boolean;
  variant?: PeriodVariant;
}

export function PeriodControl({
  period, showCompare = false, variant = 'range',
}: PeriodControlProps): JSX.Element {
  const { open, setOpen, rootRef, triggerRef } = useDismissablePanel<HTMLDivElement>();
  const { year, month } = partsOf(period.start);

  /** Referme et rend le focus au déclencheur — un panneau qui se ferme sans
   *  rendre le focus abandonne l'utilisateur au clavier en haut du document. */
  const closeAndFocus = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const setMonth = (y: number, m: number): void => {
    const r = monthRange(y, m);
    period.setRange(r.start, r.end);
  };

  return (
    <div className="flex items-center gap-2">
      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          className={TOOLBAR_BTN_SECONDARY}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="period-control"
          onClick={() => setOpen(!open)}
        >
          <Calendar className={TOOLBAR_ICON} aria-hidden />
          {buttonLabel(period, variant)}
          <ChevronDown className="h-3 w-3 text-text-inert" aria-hidden />
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Report period"
            data-testid="period-panel"
            className="absolute right-0 z-40 mt-1.5 w-64 rounded-xl border border-border-subtle bg-surface-3 p-3 shadow-xl"
          >
            {variant === 'month' ? (
              <>
                <ul className="space-y-0.5">
                  {([0, -1] as const).map((offset) => {
                    const today = toLocalDateStr(new Date());
                    const t = partsOf(today);
                    const d = new Date(Date.UTC(t.year, t.month - 1 + offset, 1));
                    const y = d.getUTCFullYear();
                    const m = d.getUTCMonth() + 1;
                    const active = y === year && m === month;
                    return (
                      <li key={offset}>
                        <button
                          type="button"
                          className={cn(
                            PANEL_ITEM,
                            active ? 'font-medium text-gold' : 'text-text-primary hover:bg-surface-4',
                          )}
                          aria-pressed={active}
                          data-testid={offset === 0 ? 'period-month-this' : 'period-month-last'}
                          onClick={() => { setMonth(y, m); closeAndFocus(); }}
                        >
                          {offset === 0 ? 'This month' : 'Last month'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2.5 flex items-end gap-2 border-t border-border-muted pt-2.5">
                  <label className="flex flex-1 flex-col gap-1 text-xs text-text-muted">
                    Month
                    <select
                      className={cn(selectClassName, 'h-9 w-full')}
                      value={month}
                      aria-label="Select month"
                      onChange={(e) => setMonth(year, Number(e.target.value))}
                    >
                      {MONTH_NAMES.map((name, i) => (
                        <option key={name} value={i + 1}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-24 flex-col gap-1 text-xs text-text-muted">
                    Year
                    <Input
                      type="number"
                      className="h-9"
                      value={year}
                      min={2020}
                      max={2099}
                      aria-label="Select year"
                      onChange={(e) => {
                        const y = Number(e.target.value);
                        if (y >= 2020 && y <= 2099) setMonth(y, month);
                      }}
                    />
                  </label>
                </div>
              </>
            ) : variant === 'as-of' ? (
              <>
                <ul className="space-y-0.5">
                  {(['today', 'yesterday'] as const).map((p) => {
                    const r = presetRange(p, toLocalDateStr(new Date()));
                    const active = period.end === r.end;
                    return (
                      <li key={p}>
                        <button
                          type="button"
                          className={cn(
                            PANEL_ITEM,
                            active ? 'font-medium text-gold' : 'text-text-primary hover:bg-surface-4',
                          )}
                          aria-pressed={active}
                          data-testid={`period-asof-${p}`}
                          onClick={() => { period.setRange(r.end, r.end); closeAndFocus(); }}
                        >
                          {PRESET_LABELS[p]}
                        </button>
                      </li>
                    );
                  })}
                  {(() => {
                    const lm = presetRange('last-month', toLocalDateStr(new Date()));
                    const active = period.end === lm.end;
                    return (
                      <li>
                        <button
                          type="button"
                          className={cn(
                            PANEL_ITEM,
                            active ? 'font-medium text-gold' : 'text-text-primary hover:bg-surface-4',
                          )}
                          aria-pressed={active}
                          data-testid="period-asof-month-end"
                          onClick={() => { period.setRange(lm.end, lm.end); closeAndFocus(); }}
                        >
                          End of last month
                        </button>
                      </li>
                    );
                  })()}
                </ul>
                <div className="mt-2.5 border-t border-border-muted pt-2.5">
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    As of
                    <Input
                      type="date"
                      lang="id-ID"
                      className="h-9"
                      value={period.end}
                      aria-label="As-of date"
                      onChange={(e) => period.setRange(e.target.value, e.target.value)}
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <ul className="space-y-0.5">
                  {PRESET_ORDER.map((p) => {
                    const active = period.preset === p;
                    return (
                      <li key={p}>
                        <button
                          type="button"
                          className={cn(
                            PANEL_ITEM,
                            active
                              ? 'font-medium text-gold'
                              : 'text-text-primary hover:bg-surface-4',
                          )}
                          aria-pressed={active}
                          data-testid={`period-preset-${p}`}
                          onClick={() => { period.setPreset(p); closeAndFocus(); }}
                        >
                          {PRESET_LABELS[p]}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-2.5 border-t border-border-muted pt-2.5">
                  <div className="flex items-end gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-xs text-text-muted">
                      From
                      <Input
                        type="date"
                        lang="id-ID"
                        className="h-9"
                        value={period.start}
                        max={period.end}
                        aria-label="Start date"
                        onChange={(e) => period.setRange(e.target.value, period.end)}
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-xs text-text-muted">
                      To
                      <Input
                        type="date"
                        lang="id-ID"
                        className="h-9"
                        value={period.end}
                        min={period.start}
                        aria-label="End date"
                        onChange={(e) => period.setRange(period.start, e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {showCompare && (
        <button
          type="button"
          className={cn(
            TOOLBAR_BTN_SECONDARY,
            period.compare && 'border-gold text-gold',
          )}
          aria-pressed={period.compare}
          data-testid="compare-toggle"
          onClick={() => period.setCompare(!period.compare)}
        >
          <GitCompareArrows className={TOOLBAR_ICON} aria-hidden />
          Compare
        </button>
      )}
    </div>
  );
}
