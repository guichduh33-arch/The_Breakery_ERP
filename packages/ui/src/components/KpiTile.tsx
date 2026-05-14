// packages/ui/src/components/KpiTile.tsx
//
// KpiTile — the bordered KPI tile from the Backoffice Dashboard screenshots
// (TODAY'S REVENUE / ORDERS / ITEMS SOLD / AVG BASKET / CUSTOMERS).
//
// Structure (top-to-bottom in the tile):
//   1. Optional Lucide icon (top-left, gold)
//   2. SectionLabel xs uppercase (the label)
//   3. Big value in Fraunces / JetBrains Mono (depending on format)
//   4. Optional delta indicator (▲ green / ▼ red / · neutral)
//
// `valueFormat`:
//   - 'currency' formats with formatIdr (Rp prefix). Renders in JetBrains
//     Mono for tabular alignment.
//   - 'percent'  appends '%' suffix. Mono.
//   - 'number'   raw locale-formatted. Fraunces serif (data viz).

import { formatIdr } from '@breakery/utils';
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Card } from '../primitives/Card.js';
import { SectionLabel } from './SectionLabel.js';

export type KpiValueFormat = 'currency' | 'percent' | 'number';
export type KpiDeltaDirection = 'up' | 'down' | 'neutral';

export interface KpiDelta {
  /** Delta value (already signed if direction is computed externally). */
  value: number | string;
  /** Direction — colors the indicator. Default 'neutral'. */
  direction?: KpiDeltaDirection;
  /** Optional context, e.g. "vs last week". */
  hint?: string;
}

export interface KpiTileProps {
  /** Uppercase label rendered as SectionLabel. */
  label: string;
  /** Primary value. Number formatted per `valueFormat`; string rendered as-is. */
  value: number | string;
  /** How to format the value. Default 'number'. */
  valueFormat?: KpiValueFormat;
  /** Optional Lucide icon shown top-left. */
  icon?: LucideIcon;
  /** Optional delta block. */
  delta?: KpiDelta;
  /** Optional footer slot (e.g. small description). */
  footer?: ReactNode;
  className?: string;
}

function formatValue(value: number | string, format: KpiValueFormat): string {
  if (typeof value === 'string') return value;
  if (format === 'currency') return formatIdr(value);
  if (format === 'percent') return `${value.toLocaleString()}%`;
  return value.toLocaleString();
}

function DeltaPill({ delta }: { delta: KpiDelta }): JSX.Element {
  const direction = delta.direction ?? 'neutral';
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium tabular-nums',
        direction === 'up' && 'text-success',
        direction === 'down' && 'text-danger',
        direction === 'neutral' && 'text-text-secondary',
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      <span>{typeof delta.value === 'number' ? delta.value.toLocaleString() : delta.value}</span>
      {delta.hint !== undefined && (
        <span className="text-text-muted">{delta.hint}</span>
      )}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  valueFormat = 'number',
  icon: Icon,
  delta,
  footer,
  className,
}: KpiTileProps): JSX.Element {
  const isMono = valueFormat === 'currency' || valueFormat === 'percent';
  return (
    <Card variant="default" padding="md" className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-start justify-between">
        {Icon !== undefined && (
          <div
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-soft text-gold"
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        {delta !== undefined && <DeltaPill delta={delta} />}
      </div>
      <div className="flex flex-col gap-1">
        <SectionLabel as="div" size="xs">{label}</SectionLabel>
        <div
          className={cn(
            'leading-tight text-text-primary text-3xl font-semibold',
            isMono ? 'font-mono tabular-nums' : 'font-data',
          )}
        >
          {formatValue(value, valueFormat)}
        </div>
      </div>
      {footer !== undefined && <div className="text-xs text-text-muted">{footer}</div>}
    </Card>
  );
}
