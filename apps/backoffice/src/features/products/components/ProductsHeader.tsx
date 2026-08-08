// apps/backoffice/src/features/products/components/ProductsHeader.tsx
//
// Écran 2a — bandeau de la page Products.
//
// La carte d'en-tête a disparu, avec elle la pastille d'icône or, le sous-titre
// en italique et les pilules rondes. Une carte autour d'un titre de page ne
// contient rien : elle encadre du vide et repousse la table de 100 px vers le
// bas. Le titre s'écrit à même la page, comme sur toutes les autres.
//
// Le fil d'Ariane remplace ce que le rail de 240 px disait : depuis que la
// navigation tient dans une top bar, la page doit dire elle-même d'où elle
// vient.

import { type JSX } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader.js';
import {
  TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON,
} from '@/components/toolbarButton.js';

interface Props {
  /** Nombre d'articles au catalogue — le sous-titre le dit, la table le filtre. */
  count: number;
  isLoading?: boolean;
  onNew?:     (() => void) | undefined;
  onImport?:  (() => void) | undefined;
  onRecipes?: (() => void) | undefined;
}

export function ProductsHeader({
  count, isLoading = false, onNew, onImport, onRecipes,
}: Props): JSX.Element {
  return (
    <div className="space-y-2">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <Link to="/backoffice/products" className="hover:text-text-secondary">Stock</Link>
        <ChevronRight className="h-3 w-3 text-border-strong" aria-hidden />
        <span className="text-text-secondary">Catalogue</span>
      </nav>

      <PageHeader
        title="Products"
        subtitle={
          isLoading
            ? 'Loading the catalogue…'
            : `${count.toLocaleString('id-ID')} items · prices and customer-category pricing`
        }
        actions={
          <>
            {onImport !== undefined && (
              <button type="button" onClick={onImport} className={TOOLBAR_BTN_SECONDARY}>
                <Upload className={TOOLBAR_ICON} aria-hidden />
                Import
              </button>
            )}
            <button type="button" onClick={onRecipes} className={TOOLBAR_BTN_SECONDARY}>
              <BookOpen className={TOOLBAR_ICON} aria-hidden />
              Recipes
            </button>
            {onNew !== undefined && (
              <button type="button" onClick={onNew} className={TOOLBAR_BTN_PRIMARY}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                New product
              </button>
            )}
          </>
        }
      />
    </div>
  );
}
