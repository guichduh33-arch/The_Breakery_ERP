import { Currency, Numpad } from '@breakery/ui';

// Pavé de saisie en contexte : comptage d'ouverture de caisse, montant en cours.
export const SaisieMontant = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-xs space-y-4">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-text-secondary">Fonds de caisse</p>
        <Currency amount={500000} emphasis="large" className="text-text-primary" />
      </div>
      <Numpad value="500000" onChange={() => {}} />
    </div>
  </div>
);

// Le pavé seul — les 12 touches : chiffres, C destructif, backspace neutre.
export const PaveSeul = () => (
  <div className="bg-bg-base p-6">
    <Numpad value="" onChange={() => {}} className="mx-auto max-w-xs" />
  </div>
);
