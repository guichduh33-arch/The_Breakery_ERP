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
import { Input, cn } from '@breakery/ui';
import { TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import {
  PRESET_LABELS, type PeriodPreset, type ReportPeriod,
} from '../hooks/useReportPeriod.js';
import { useDismissablePanel } from './useDismissablePanel.js';

/** « 5 Aug » — la date métier est un YYYY-MM-DD : on formate en UTC pour ne
 *  pas la décaler d'un jour sous un fuseau navigateur négatif. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function buttonLabel(period: ReportPeriod): string {
  if (period.preset !== 'custom') return PRESET_LABELS[period.preset];
  if (period.start === period.end) return shortDate(period.start);
  return `${shortDate(period.start)} – ${shortDate(period.end)}`;
}

const PRESET_ORDER = Object.keys(PRESET_LABELS) as Exclude<PeriodPreset, 'custom'>[];

export interface PeriodControlProps {
  period: ReportPeriod;
  /** Affiche le bouton « Compare » (période précédente symétrique). */
  showCompare?: boolean;
}

export function PeriodControl({ period, showCompare = false }: PeriodControlProps): JSX.Element {
  const { open, setOpen, rootRef, triggerRef } = useDismissablePanel<HTMLDivElement>();

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
          {buttonLabel(period)}
          <ChevronDown className="h-3 w-3 text-text-inert" aria-hidden />
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Report period"
            data-testid="period-panel"
            className="absolute right-0 z-40 mt-1.5 w-64 rounded-xl border border-border-subtle bg-surface-3 p-3 shadow-xl"
          >
            <ul className="space-y-0.5">
              {PRESET_ORDER.map((p) => {
                const active = period.preset === p;
                return (
                  <li key={p}>
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded-sm px-2 py-1.5 text-left text-sm',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                        active
                          ? 'font-medium text-gold'
                          : 'text-text-primary hover:bg-surface-4',
                      )}
                      aria-pressed={active}
                      data-testid={`period-preset-${p}`}
                      onClick={() => {
                        period.setPreset(p);
                        setOpen(false);
                        triggerRef.current?.focus();
                      }}
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
