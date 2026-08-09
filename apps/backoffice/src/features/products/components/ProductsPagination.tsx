// apps/backoffice/src/features/products/components/ProductsPagination.tsx
//
// Le pied de pagination du catalogue, partagé par la table ET la grille.
//
// Il vit à part parce que les deux vues du catalogue paginaient différemment :
// `ProductsTable` recevait `page` et découpait, `ProductsGrid` recevait tout le
// résultat filtré et rendait les 373 cartes d'un coup (8 236 nœuds DOM contre
// 911 en vue table). Un même écran ne peut pas avoir deux comportements de
// pagination selon le bouton de vue.
//
// Le sélecteur de lignes s'appuie sur le primitif `Select` plutôt que sur un
// <select> fait main : `cn` étant tailwind-merge, les classes de pied écrasent
// la hauteur tactile et la largeur pleine du primitif sans lui retirer sa
// bordure, son fond ni son anneau de focus or.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { Select } from '@breakery/ui';

export const PRODUCTS_PAGE_SIZES = [15, 50, 100] as const;
export const PRODUCTS_PAGE_SIZE_DEFAULT = 15;

/** Borne une taille lue d'une source non fiable (URL) sur les valeurs offertes. */
export function coercePageSize(raw: string | number | null | undefined): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw ?? NaN;
  return (PRODUCTS_PAGE_SIZES as readonly number[]).includes(n)
    ? n
    : PRODUCTS_PAGE_SIZE_DEFAULT;
}

/** Découpe partagée : la table et la grille doivent montrer la même tranche. */
export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number): {
  pageRows: readonly T[];
  current: number;
  pageCount: number;
  start: number;
} {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // Une page hors bornes n'affiche pas du vide qu'on croirait cassé : elle se
  // ramène à la dernière page réelle.
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), current, pageCount, start };
}

interface Props {
  total: number;
  page: number;
  pageSize: number;
  onPage?: (next: number) => void;
  onPageSize?: (next: number) => void;
  /** Rendu à gauche du compteur — les actions groupées de la table. */
  leading?: ReactNode;
}

export function ProductsPagination({
  total, page, pageSize, onPage, onPageSize, leading,
}: Props): JSX.Element {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + pageSize, total);

  return (
    <div className="flex flex-wrap items-center gap-3.5">
      {leading}
      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
          <span>Rows</span>
          <Select
            value={String(pageSize)}
            onChange={(e) => { onPageSize?.(coercePageSize(e.target.value)); }}
            aria-label="Rows per page"
            data-testid="products-page-size"
            className="h-6 w-auto rounded-sm px-1.5 py-0 font-data text-[11.5px]"
          >
            {PRODUCTS_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </label>
        <span
          className="font-data text-[11.5px] tabular-nums text-text-muted"
          data-testid="products-page-range"
        >
          {from}–{to} of {total.toLocaleString('en-US')}
        </span>
        <div className="flex items-center gap-1">
          <PageButton label="Previous page" disabled={current <= 1} onClick={() => { onPage?.(current - 1); }}>
            <ChevronLeft className="h-[15px] w-[15px]" aria-hidden />
          </PageButton>
          <PageButton label="Next page" disabled={current >= pageCount} onClick={() => { onPage?.(current + 1); }}>
            <ChevronRight className="h-[15px] w-[15px]" aria-hidden />
          </PageButton>
        </div>
      </div>
    </div>
  );
}

function PageButton({
  label, disabled, onClick, children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-4 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
