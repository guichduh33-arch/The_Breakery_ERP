// apps/backoffice/src/features/reports/components/ReportFilterBar.tsx
//
// S3-22 — LA barre de filtres des rapports. Elle rend une liste déclarative de
// définitions (`useReportFilters`) : liste de choix = `Select` natif du kit,
// texte libre = `DebouncedInput` (commit différé, comme le filtre de table des
// commandes). La période et l'export restent dans le bandeau : la barre ne
// porte que ce qui RESTREINT le jeu de lignes.
//
// Accessibilité : chaque contrôle porte un libellé visible relié par
// `htmlFor`, l'anneau de focus est celui des primitives. « Clear filters »
// n'existe que si un filtre est actif ; comme il disparaît sous le doigt, le
// focus est rendu au premier contrôle — sinon il tomberait sur `<body>`.

import { useId, useRef, useState, type JSX, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Select, cn } from '@breakery/ui';
import { Button } from '@/components/BackofficeUi.js';
import { DebouncedInput } from '@/components/DebouncedInput.js';
import type { ReportFilterDef, ReportFiltersState } from '../hooks/useReportFilters.js';

export interface ReportFilterBarProps<K extends string> {
  defs:    readonly ReportFilterDef<K>[];
  filters: ReportFiltersState<K>;
  /** Réserve de lecture posée sous la barre (ex. effet d'un filtre actif). */
  note?:   ReactNode;
  testId?: string;
}

const LABEL = 'flex items-center gap-1.5 text-xs text-text-muted';

export function ReportFilterBar<K extends string>({
  defs, filters, note, testId = 'report-filter-bar',
}: ReportFilterBarProps<K>): JSX.Element {
  const baseId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  // Remonte les champs texte à l'effacement : une saisie pas encore commise
  // n'a jamais touché l'URL, donc l'URL vidée ne la « change » pas — sans ce
  // remontage, le brouillon resterait affiché et se commettrait 400 ms après.
  const [resetNonce, setResetNonce] = useState(0);

  const handleClear = (): void => {
    filters.clear();
    setResetNonce((n) => n + 1);
    groupRef.current?.querySelector<HTMLElement>('select, input')?.focus();
  };

  return (
    <div className="space-y-2">
      <div
        ref={groupRef}
        role="group"
        aria-label="Report filters"
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
        data-testid={testId}
      >
        {defs.map((def) => {
          const id = `${baseId}-${def.key}`;
          const value = filters.values[def.key];
          return (
            <label key={def.key} htmlFor={id} className={LABEL}>
              <span>{def.label}</span>
              {def.kind === 'select' ? (
                <Select
                  id={id}
                  value={value}
                  onChange={(e) => { filters.setValue(def.key, e.target.value); }}
                  className={cn('h-9', def.width ?? 'w-auto')}
                  data-testid={`filter-${def.key}`}
                >
                  <option value="">{def.allLabel}</option>
                  {def.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              ) : (
                <DebouncedInput
                  key={resetNonce}
                  id={id}
                  value={value}
                  onCommit={(next) => { filters.setValue(def.key, next); }}
                  placeholder={def.placeholder}
                  maxLength={def.maxLength}
                  className={cn('h-9', def.width ?? 'w-32')}
                  data-testid={`filter-${def.key}`}
                />
              )}
            </label>
          );
        })}
        {filters.hasActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            data-testid="filters-clear"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear filters
          </Button>
        )}
      </div>
      {note}
    </div>
  );
}
