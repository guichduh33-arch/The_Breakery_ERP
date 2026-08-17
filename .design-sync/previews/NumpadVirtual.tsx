import { NumpadVirtual } from '@breakery/ui';

// Mode PIN — 3 chiffres saisis sur 6 (initialValue), Cancel présent.
export const PinPartiel = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-xs">
      <NumpadVirtual mode="pin" initialValue="482" onSubmit={() => {}} onCancel={() => {}} />
    </div>
  </div>
);

// Mode cash — ouverture de shift, montant affiché, touche décimale.
export const Cash = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-xs">
      <NumpadVirtual mode="cash" initialValue="500000" onSubmit={() => {}} onCancel={() => {}} />
    </div>
  </div>
);

// Mode numérique — saisie de quantité (opname), erreur affichée.
export const NumeriqueErreur = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-xs">
      <NumpadVirtual
        mode="numeric"
        initialValue="1200"
        onSubmit={() => {}}
        error="Quantité au-dessus du stock théorique"
      />
    </div>
  </div>
);
