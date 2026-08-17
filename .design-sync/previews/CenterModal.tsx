import { Button, CenterModal } from '@breakery/ui';
import { Minus, Plus, X } from 'lucide-react';

// Modale centrée compacte — le composant n'injecte PAS de bouton de fermeture :
// l'appelant rend son propre en-tête avec la croix (contrat du primitif).
// Contenu façon « ajuster la vitrine » (AdjustDisplayModal du POS).
export const Open = () => (
  <div className="fixed inset-0 bg-bg-base">
    <CenterModal
      open
      onOpenChange={() => {}}
      title="Ajuster la vitrine"
      description="Corriger la quantité affichée en vitrine."
    >
      <header className="flex items-center justify-between border-b border-border-subtle px-5 pb-3 pt-5">
        <div>
          <h2 className="font-display text-xl text-text-primary">Ajuster la vitrine</h2>
          <p className="text-xs text-text-secondary">Pain au chocolat — vitrine principale</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-md text-text-secondary hover:bg-bg-input hover:text-text-primary"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>
      <div className="flex items-center justify-center gap-8 px-5 py-8">
        <Button variant="secondary" size="icon" aria-label="Retirer">
          <Minus className="h-5 w-5" aria-hidden />
        </Button>
        <div className="text-center">
          <p className="font-mono text-5xl font-bold tabular-nums text-text-primary">9</p>
          <p className="mt-1 text-xs text-text-secondary">en vitrine — 12 ce matin</p>
        </div>
        <Button variant="secondary" size="icon" aria-label="Ajouter">
          <Plus className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      <footer className="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
        <Button variant="secondary">Annuler</Button>
        <Button variant="primary">Valider</Button>
      </footer>
    </CenterModal>
  </div>
);
