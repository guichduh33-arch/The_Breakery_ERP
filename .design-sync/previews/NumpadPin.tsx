import { NumpadPin } from '@breakery/ui';

// Saisie PIN manager (6 chiffres) — état initial, Verify désactivé.
// L'état interne n'est pas préremplissable : dots vides par construction.
export const Saisie = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-xs">
      <NumpadPin onSubmit={() => {}} />
    </div>
  </div>
);

// PIN refusé — message role=alert en rouge-texte sous le pavé.
export const Erreur = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-xs">
      <NumpadPin onSubmit={() => {}} error="PIN incorrect — 2 essais restants" />
    </div>
  </div>
);

// Vérification en cours — bouton gold en attente.
export const Verification = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-xs">
      <NumpadPin onSubmit={() => {}} isLoading />
    </div>
  </div>
);
