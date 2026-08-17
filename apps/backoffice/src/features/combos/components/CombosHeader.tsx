// apps/backoffice/src/features/combos/components/CombosHeader.tsx
//
// Session 47 — Header strip on the Combo Management page.
// "Create New Combo" gated on combos.create; navigates to /combos/new.

import { Plus } from 'lucide-react';
import type { JSX } from 'react';
import { PageHeader } from '@/components/PageHeader.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';

interface Props {
  /** Provided when the user has combos.create permission. */
  onCreate?: () => void;
}

// Trois corrections d'un coup (campagne design, lot B2) :
//   · le `<h1>` était recopié à la main — DESIGN.md § Do's fait de `PageHeader`
//     la source unique du bandeau de titre. La pastille d'icône décorative part
//     avec : le composant partagé n'a pas de fente pour elle, et une frise
//     d'icônes est précisément ce que la direction a retiré.
//   · le bouton était un APLAT D'OR (The Ink-Not-Gold Rule). C'est le bouton
//     QUI CRÉE, sur un bandeau de page : c'est le cas d'école de l'encre.
//   · `rounded-full` violait The Tight-Corner Rule (6 px au maximum) ;
//     `TOOLBAR_BTN_PRIMARY` porte le rayon de 3 px du système.
export function CombosHeader({ onCreate }: Props): JSX.Element {
  return (
    <PageHeader
      className="items-center"
      title="Combo Management"
      subtitle="Create artisan bundles and curated sets at premium value"
      actions={
        onCreate !== undefined ? (
          <button
            type="button"
            onClick={onCreate}
            className={TOOLBAR_BTN_PRIMARY}
            data-testid="create-combo-btn"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create New Combo
          </button>
        ) : undefined
      }
    />
  );
}
