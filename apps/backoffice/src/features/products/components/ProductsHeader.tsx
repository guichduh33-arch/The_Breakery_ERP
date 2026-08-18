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
// vient. Il dit « Stock › Products » — DOMAINE puis PAGE, la forme de toute la
// flotte (« Sales › Orders », « Sales › Customers », « B2B › Orders »). Il
// disait « Stock › Catalogue » : trois mots pour deux niveaux, dont aucun ne
// nommait la page où l'on se trouve, et dont le premier était un `<Link>` vers
// `/backoffice/products` — c'est-à-dire vers la page courante. Un fil d'Ariane
// qui renvoie sur lui-même n'est pas un chemin. « Catalogue » est le titre
// d'une COLONNE du méga-menu, pas une page : le segment de domaine reste un
// `<span>`, parce qu'aucun domaine du back-office n'a d'écran d'accueil.
//
// Les actions gatées se DÉSACTIVENT et disent pourquoi, elles ne disparaissent
// plus. Masquer un contrôle laisse croire que la fonction n'existe pas ; le
// désactiver nomme la règle (même arbitrage qu'`ExportMenu`, et exigence déjà
// écrite dans DESIGN.md pour l'archétype Bulk entry). La raison est portée deux
// fois : `title` pour la souris, `aria-describedby` vers un texte `sr-only` pour
// les technologies d'assistance — un bouton désactivé n'étant pas focalisable,
// le `title` seul n'atteint personne.

import { type JSX } from 'react';
import { BookOpen, ChevronRight, Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader.js';
import {
  TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON,
} from '@/components/toolbarButton.js';

const NEW_REASON    = 'Requires the products.create permission.';
const IMPORT_REASON = 'Requires the catalog.import permission.';

interface Props {
  /** Nombre d'articles au catalogue — le sous-titre le dit, la table le filtre. */
  count: number;
  isLoading?: boolean;
  onNew?:     (() => void) | undefined;
  onImport?:  (() => void) | undefined;
  onRecipes?: (() => void) | undefined;
  /** `products.create`. Faux = bouton rendu, désactivé, et disant pourquoi. */
  canCreate?: boolean;
  /** `catalog.import`. Même contrat. */
  canImport?: boolean;
}

export function ProductsHeader({
  count, isLoading = false, onNew, onImport, onRecipes,
  canCreate = true, canImport = true,
}: Props): JSX.Element {
  return (
    <div className="space-y-2">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Stock</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Products</span>
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
            <button
              type="button"
              onClick={onImport}
              className={TOOLBAR_BTN_SECONDARY}
              disabled={!canImport}
              {...(canImport ? {} : { title: IMPORT_REASON, 'aria-describedby': 'products-import-reason' })}
            >
              <Upload className={TOOLBAR_ICON} aria-hidden />
              Import
            </button>
            {!canImport && <span id="products-import-reason" className="sr-only">{IMPORT_REASON}</span>}
            <button type="button" onClick={onRecipes} className={TOOLBAR_BTN_SECONDARY}>
              <BookOpen className={TOOLBAR_ICON} aria-hidden />
              Recipes
            </button>
            <button
              type="button"
              onClick={onNew}
              className={TOOLBAR_BTN_PRIMARY}
              disabled={!canCreate}
              {...(canCreate ? {} : { title: NEW_REASON, 'aria-describedby': 'products-new-reason' })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New product
            </button>
            {!canCreate && <span id="products-new-reason" className="sr-only">{NEW_REASON}</span>}
          </>
        }
      />
    </div>
  );
}
