import { OrderTypeTabs } from '@breakery/ui';

// Sélecteur du type de commande — Dine In actif (gold-soft + bordure gold).
export const Selection = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-sm">
      <OrderTypeTabs value="dine_in" onChange={() => {}} />
    </div>
  </div>
);

// Les trois états actifs possibles, empilés.
export const Etats = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto max-w-sm space-y-3">
      <OrderTypeTabs value="dine_in" onChange={() => {}} />
      <OrderTypeTabs value="take_out" onChange={() => {}} />
      <OrderTypeTabs value="delivery" onChange={() => {}} />
    </div>
  </div>
);
