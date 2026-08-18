// apps/backoffice/src/features/combos/components/CombosHeader.tsx
//
// Session 47 — Header strip on the Combo Management page.
// "Create New Combo" gated on combos.create; navigates to /combos/new.

import { Plus } from 'lucide-react';
import type { JSX } from 'react';
import { PageHeader } from '@/components/PageHeader.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';

interface Props {
  onCreate?: (() => void) | undefined;
  /** `combos.create`. Faux = bouton RENDU, désactivé, et disant pourquoi. */
  canCreate?: boolean;
}

const CREATE_REASON = 'You need the combos.create permission to build a combo.';

// Trois corrections d'un coup (campagne design, lot B2) :
//   · le `<h1>` était recopié à la main — DESIGN.md § Do's fait de `PageHeader`
//     la source unique du bandeau de titre. La pastille d'icône décorative part
//     avec : le composant partagé n'a pas de fente pour elle, et une frise
//     d'icônes est précisément ce que la direction a retiré.
//   · le bouton était un APLAT D'OR (The Ink-Not-Gold Rule). C'est le bouton
//     QUI CRÉE, sur un bandeau de page : c'est le cas d'école de l'encre.
//   · `rounded-full` violait The Tight-Corner Rule (6 px au maximum) ;
//     `TOOLBAR_BTN_PRIMARY` porte le rayon de 3 px du système.
//
// Quatrième correction (2026-08-18) : le bouton était MASQUÉ quand la permission
// manquait. La doctrine du dépôt — celle que `ProductsHeader` et `B2BOrdersPage`
// tiennent — est de le RENDRE, désactivé, en disant pourquoi : un bouton absent
// se lit « cette page ne sait pas créer de combo », un bouton grisé assorti de sa
// raison se lit « demande ce droit ». Un bouton désactivé n'étant pas focalisable,
// le `title` seul n'atteindrait ni le clavier ni le lecteur d'écran : la raison
// est aussi un texte `sr-only` référencé par `aria-describedby`.
export function CombosHeader({ onCreate, canCreate = true }: Props): JSX.Element {
  return (
    <PageHeader
      className="items-center"
      title="Combo Management"
      subtitle="Create artisan bundles and curated sets at premium value"
      actions={
        <>
          <button
            type="button"
            onClick={onCreate}
            className={TOOLBAR_BTN_PRIMARY}
            disabled={!canCreate}
            {...(canCreate ? {} : { title: CREATE_REASON, 'aria-describedby': 'combos-create-reason' })}
            data-testid="create-combo-btn"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create New Combo
          </button>
          {!canCreate && <span id="combos-create-reason" className="sr-only">{CREATE_REASON}</span>}
        </>
      }
    />
  );
}
