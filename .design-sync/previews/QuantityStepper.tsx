import { QuantityStepper } from '@breakery/ui';

// Lignes de panier — quantités courantes, cibles rush 56 px.
export const LignesPanier = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-sm space-y-3 text-text-primary">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-text-primary">Croissant beurre</span>
        <QuantityStepper value={2} onChange={() => {}} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-text-primary">Pain au chocolat</span>
        <QuantityStepper value={12} onChange={() => {}} />
      </div>
    </div>
  </div>
);

// Bornes : min atteint (− désactivé) et max atteint (+ désactivé).
export const Bornes = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-sm space-y-3 text-text-primary">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-text-secondary">Au minimum (0)</span>
        <QuantityStepper value={0} onChange={() => {}} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-text-secondary">Au maximum (5 restants)</span>
        <QuantityStepper value={5} max={5} onChange={() => {}} />
      </div>
    </div>
  </div>
);
