// apps/backoffice/src/features/reports/components/BreakdownCard.tsx
//
// Lot B (campagne Reports 2026-08-15) — la carte de VENTILATION de l'archétype
// Report (maquette 4c) : des lignes « part + valeur », une piste de 9 px ou une
// rangée basse, et un TOTAL DÉRIVÉ au-dessus d'un filet — jamais une simple
// liste. Patron repris de RevenueShareCard (dashboard). La barre de partage
// segmentée (« By order type ») et le pied d'état opérationnel sont des slots.
//
// Data-viz : les pistes ne sont PAS un graphique — chaque ligne est étiquetée
// en direct (libellé, part, montant), donc l'identité ne repose jamais sur la
// couleur seule, et les tons pâles de la rampe restent légaux ici.

import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SectionLabel, cn } from '@breakery/ui';
import { PanelCard } from '@/components/PanelCard.js';
import { formatIdrCompact, formatIdrFull } from '../utils/chartColors.js';

export interface BreakdownRow {
  key:   string;
  label: string;
  /** Montant IDR — rendu compact, montant exact en infobulle. */
  amount: number;
  /** Part 0-100. Requise en variant `track` (elle EST la piste). */
  sharePct?: number;
  /** Compteur secondaire (« ×86 », « 4 tickets ») rendu en mono discret. */
  count?: string;
  /** Couleur de piste/pastille — un cran de rampe, jamais `cat-*`. */
  color?: string;
  /** Destination de drill-down du libellé. */
  to?: string;
}

export interface ShareSegment {
  label: string;
  pct:   number;
  color: string;
}

export interface BreakdownCardProps {
  title: string;
  aside?: ReactNode;
  subtitle?: ReactNode;
  isLoading?: boolean;
  isRestricted?: boolean;
  error?: Error | null;
  rows: BreakdownRow[];
  /** `track` = piste 9 px (part visuelle) · `plain` = rangée basse. */
  variant?: 'track' | 'plain';
  /**
   * `derived` somme les montants des lignes sous un filet ; un objet pose un
   * total nommé (ex. « Total collected » venu du serveur).
   */
  total?: 'derived' | { label: string; amount: number };
  /**
   * Barre de partage segmentée + légende à pastilles (ex. « By order type »).
   * `title` pose le sous-libellé de section de la maquette 4c — la barre y est
   * une SECONDE lecture des mêmes lignes, pas un ornement du tableau au-dessus.
   */
  shareBar?: { ariaLabel: string; segments: ShareSegment[]; title?: string };
  /**
   * Où poser la barre de partage. La maquette 4c totalise d'abord les lignes,
   * PUIS ouvre la section de partage sous un filet : un total qui vient après
   * la barre se lit comme le total de la barre, ce qu'il n'est pas.
   */
  shareBarPlacement?: 'before-total' | 'after-total';
  /** Pied d'état opérationnel, séparé par un filet (alerte + lien). */
  footer?: ReactNode;
  emptyText?: string;
  testId?: string;
}

const DEFAULT_TRACK_COLOR = 'var(--chart-1)';

function RowLabel({ row }: { row: BreakdownRow }): JSX.Element {
  if (row.to !== undefined) {
    return (
      <Link
        to={row.to}
        className="truncate text-text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        {row.label}
      </Link>
    );
  }
  return <span className="truncate text-text-primary">{row.label}</span>;
}

export function BreakdownCard({
  title, aside, subtitle,
  isLoading = false, isRestricted = false, error = null,
  rows, variant = 'plain', total, shareBar, shareBarPlacement = 'before-total', footer,
  emptyText = 'No data for this period.',
  testId,
}: BreakdownCardProps): JSX.Element {
  const totalLine = total === 'derived'
    ? { label: 'Total', amount: rows.reduce((s, r) => s + r.amount, 0) }
    : total;

  const shareBarBlock = shareBar !== undefined && shareBar.segments.length > 0 ? (
    <div
      className={shareBarPlacement === 'after-total'
        ? 'mt-3 border-t border-border-muted pt-2.5'
        : undefined}
      data-testid="breakdown-sharebar"
    >
      {shareBar.title !== undefined && (
        <SectionLabel as="h3" className="font-data text-xs font-semibold text-text-primary">
          {shareBar.title}
        </SectionLabel>
      )}
      <div
        className={cn(
          'flex h-2.5 overflow-hidden rounded-[2px] bg-surface-4',
          shareBar.title !== undefined ? 'mt-2.5' : 'mt-3',
        )}
        role="img"
        aria-label={shareBar.ariaLabel}
      >
        {shareBar.segments.map((s) => (
          <div key={s.label} style={{ width: `${s.pct}%`, background: s.color }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {shareBar.segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />
            {s.label}
            <span className="font-data tabular-nums text-text-muted">{Math.round(s.pct)}%</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <PanelCard
      title={title}
      {...(aside !== undefined ? { aside } : {})}
      {...(subtitle !== undefined ? { subtitle } : {})}
      isLoading={isLoading}
      isRestricted={isRestricted}
      error={error}
      {...(testId !== undefined ? { testId } : {})}
    >
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-text-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-xs">
              {variant === 'track' ? (
                <>
                  <span className="w-24 shrink-0 truncate">
                    <RowLabel row={row} />
                  </span>
                  <span className="h-[9px] flex-1 overflow-hidden rounded-[2px] bg-surface-0" aria-hidden>
                    <span
                      className="block h-full"
                      style={{
                        width: `${Math.max(0, Math.min(100, row.sharePct ?? 0))}%`,
                        background: row.color ?? DEFAULT_TRACK_COLOR,
                      }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right font-data tabular-nums text-text-muted">
                    {row.sharePct !== undefined ? `${Math.round(row.sharePct)}%` : '—'}
                  </span>
                  <span
                    className="w-16 shrink-0 whitespace-nowrap text-right font-data tabular-nums text-text-primary"
                    title={formatIdrFull(row.amount)}
                  >
                    {formatIdrCompact(row.amount)}
                  </span>
                </>
              ) : (
                <>
                  {row.color !== undefined && (
                    <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: row.color }} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <RowLabel row={row} />
                  </span>
                  {row.count !== undefined && (
                    <span className="shrink-0 font-data tabular-nums text-text-muted">{row.count}</span>
                  )}
                  {row.sharePct !== undefined && (
                    <span className="shrink-0 font-data tabular-nums text-text-muted">
                      {Math.round(row.sharePct)}%
                    </span>
                  )}
                  <span
                    className="shrink-0 whitespace-nowrap font-data tabular-nums text-text-primary"
                    title={formatIdrFull(row.amount)}
                  >
                    {formatIdrCompact(row.amount)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {shareBarPlacement === 'before-total' && shareBarBlock}

      {totalLine !== undefined && rows.length > 0 && (
        <div className="mt-3 border-t border-border-muted pt-2.5 text-xs">
          <div className="flex items-baseline justify-between">
            <span className="font-medium text-text-primary">{totalLine.label}</span>
            <span
              className="font-data font-semibold tabular-nums text-text-primary"
              title={formatIdrFull(totalLine.amount)}
            >
              {formatIdrCompact(totalLine.amount)}
            </span>
          </div>
        </div>
      )}

      {shareBarPlacement === 'after-total' && shareBarBlock}

      {footer !== undefined && (
        <div className={cn('mt-3 flex items-center gap-2 border-t border-border-muted pt-2.5 text-xs')}>
          {footer}
        </div>
      )}
    </PanelCard>
  );
}
