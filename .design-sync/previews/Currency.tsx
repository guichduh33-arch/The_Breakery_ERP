import { Currency } from '@breakery/ui';

// Montants réels id-ID (« Rp 36.000 » depuis l'arbitrage 2026-08-13), négatif inclus.
export const Montants = () => (
  <div className="bg-bg-base p-6">
    <ul className="mx-auto max-w-xs space-y-2 text-sm text-text-secondary">
      <li className="flex justify-between">
        <span>2 × Croissant beurre</span>
        <Currency amount={36000} className="text-text-primary" />
      </li>
      <li className="flex justify-between">
        <span>Chiffre du jour</span>
        <Currency amount={4850000} className="text-text-primary" />
      </li>
      <li className="flex justify-between">
        <span>Remboursement QRIS</span>
        <Currency amount={-52000} className="text-red-as-text" />
      </li>
    </ul>
  </div>
);

// Les emphases : normal / gold / large — le total à encaisser en gold + large.
export const Emphases = () => (
  <div className="bg-bg-base p-6">
    <div className="mx-auto flex max-w-xs flex-col items-center gap-3">
      <Currency amount={68000} className="text-text-primary" />
      <Currency amount={68000} emphasis="gold" />
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-text-secondary">Total à payer</p>
        <Currency amount={68000} emphasis="large" className="text-gold" />
      </div>
    </div>
  </div>
);
