import { Numpad } from '@breakery/ui';

const noop = () => {};

// The canonical POS pad — 3×4 grid, destructive-red Clear, neutral Backspace
// icon key. Purely presentational in capture (value drives no visual state).
export const PosPad = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <Numpad value="" onChange={noop} />
  </div>
);

// In context — cash-received entry: mono amount display above the pad, the
// way PaymentTerminal and DiscountModal compose it.
export const CashEntry = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80 flex flex-col gap-5">
    <div className="text-center">
      <p className="text-xs uppercase tracking-widest text-text-secondary mb-1">Cash received</p>
      <p className="font-mono text-4xl font-bold text-text-primary">100,000</p>
    </div>
    <Numpad value="100000" onChange={noop} maxLength={9} />
  </div>
);
