// apps/backoffice/src/features/products/components/ProductDetailHeader.tsx
//
// Bandeau de la fiche produit.
//
// Polish — la fiche n'avait pas suivi la refonte du 2026-08-05 : elle gardait le
// bouton or plein en pilule, la pastille de SKU dorée, un bouton de retour
// circulaire et un `<h1>` recopié à la main. Trois conséquences, toutes
// réparées ici : l'or a cessé d'être un remplissage (il est encre de sens —
// nav active, lien, prix), le bandeau de page a une source unique
// (`PageHeader` + `TOOLBAR_BTN_*`), et la page dit d'où elle vient par un fil
// d'Ariane au lieu d'une flèche ronde.
//
// Le fil d'Ariane nomme le domaine et la colonne de navigation qui mènent ici.
// « Stock » et « Catalogue » ne sont PAS des liens : un domaine ouvre un panneau,
// il n'a pas de route. Seul « Products » en est un.

import { ChevronRight, Save } from 'lucide-react';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';

interface Props {
  name:      string;
  sku:       string;
  isDirty?:  boolean | undefined;
  isSaving?: boolean | undefined;
  onSave?:   (() => void) | undefined;
}

export function ProductDetailHeader({
  name, sku, isDirty = false, isSaving = false, onSave,
}: Props): JSX.Element {
  return (
    <div className="space-y-2">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Stock</span>
        <ChevronRight className="h-3 w-3 text-border-strong" aria-hidden />
        <span>Catalogue</span>
        <ChevronRight className="h-3 w-3 text-border-strong" aria-hidden />
        <Link to="/backoffice/products" className="hover:text-text-secondary">Products</Link>
      </nav>

      <PageHeader
        title={name}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            SKU
            <span className="font-mono font-semibold text-text-primary">{sku}</span>
          </span>
        }
        actions={
          <button
            type="button"
            onClick={onSave}
            disabled={!isDirty || isSaving || onSave === undefined}
            data-testid="product-detail-save"
            className={TOOLBAR_BTN_PRIMARY}
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        }
      />
    </div>
  );
}
