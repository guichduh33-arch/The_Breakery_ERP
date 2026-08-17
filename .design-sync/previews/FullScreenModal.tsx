import { Button, FullScreenModal } from '@breakery/ui';
import { X } from 'lucide-react';

// Coquille plein écran canonique — l'appelant compose header / corps / footer
// (contenu façon « Cash in / out » du POS). Le Content est un flex-col plein
// viewport sur fond bg-base.
export const CashInOut = () => (
  <FullScreenModal
    open
    onOpenChange={() => {}}
    accessibleTitle="Cash in / out"
    description="Enregistrer une entrée ou sortie de caisse."
  >
    <header className="flex h-14 items-center justify-between border-b border-border-subtle bg-bg-elevated px-6">
      <h2 className="font-serif text-xl">Cash in / out</h2>
      <Button variant="ghost" size="icon" aria-label="Close">
        <X className="h-5 w-5" aria-hidden />
      </Button>
    </header>

    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div role="group" aria-label="Direction" className="inline-flex h-10 items-center justify-center rounded-md bg-bg-input p-1">
        <button
          type="button"
          aria-pressed="true"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-sm border border-gold bg-gold-soft px-3 py-1.5 text-sm font-medium text-gold shadow-sm"
        >
          Cash in
        </button>
        <button
          type="button"
          aria-pressed="false"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium text-text-secondary"
        >
          Cash out
        </button>
      </div>

      <div className="text-center">
        <p className="mb-1 text-xs uppercase tracking-widest text-text-secondary">Montant (IDR)</p>
        <p className="font-mono text-4xl font-bold tabular-nums text-text-primary">Rp 200,000</p>
      </div>

      <div className="w-full max-w-md space-y-1">
        <label htmlFor="fsm-reason" className="text-xs uppercase tracking-widest text-text-secondary">
          Motif
        </label>
        <textarea
          id="fsm-reason"
          rows={2}
          value="Fond de caisse — appoint monnaie du matin"
          onChange={() => {}}
          className="w-full resize-none rounded-md border border-border-subtle bg-bg-input p-3 text-sm text-text-primary focus:border-gold focus:outline-none"
        />
      </div>
    </div>

    <footer className="flex justify-end gap-3 border-t border-border-subtle bg-bg-elevated px-6 py-4">
      <Button variant="secondary" size="lg">Annuler</Button>
      <Button variant="primary" size="lg">Confirmer</Button>
    </footer>
  </FullScreenModal>
);
