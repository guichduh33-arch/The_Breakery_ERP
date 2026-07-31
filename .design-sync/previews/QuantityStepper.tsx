import { QuantityStepper } from '@breakery/ui';

// Cart-row stepper — 56px rush-action touch targets, mono count between.
export const InCartRow = () => (
  <div className="bg-bg-base p-6 rounded-lg w-96 flex items-center justify-between gap-4 text-text-primary">
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text-primary">Croissant au beurre</span>
      <span className="text-xs text-text-muted font-mono tabular-nums">Rp 28,000</span>
    </div>
    <QuantityStepper value={2} onChange={() => {}} />
  </div>
);

// Clamp states — at min (decrement disabled) and at max (increment disabled).
// Stepper icons + count inherit color — envelope provides text-text-primary.
export const ClampStates = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-4 text-text-primary">
    <div className="flex items-center justify-between gap-4 w-80">
      <span className="text-xs text-text-muted">At min (0)</span>
      <QuantityStepper value={0} onChange={() => {}} />
    </div>
    <div className="flex items-center justify-between gap-4 w-80">
      <span className="text-xs text-text-muted">At max (10)</span>
      <QuantityStepper value={10} max={10} onChange={() => {}} />
    </div>
  </div>
);
