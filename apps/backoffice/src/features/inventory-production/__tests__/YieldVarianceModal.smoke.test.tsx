// apps/backoffice/src/features/inventory-production/__tests__/YieldVarianceModal.smoke.test.tsx
// Session 15 — Phase 2.B — YieldVarianceModal render + interaction smoke.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YieldVarianceModal } from '../components/YieldVarianceModal.js';

function renderModal(overrides: Partial<{
  expectedQty: number; actualQty: number; thresholdPct: number;
  onCancel: () => void; onConfirm: (r: string) => void;
}> = {}) {
  const onCancel  = overrides.onCancel  ?? vi.fn();
  const onConfirm = overrides.onConfirm ?? vi.fn();
  render(
    <YieldVarianceModal
      expectedQty={overrides.expectedQty ?? 10}
      actualQty={overrides.actualQty ?? 5}
      thresholdPct={overrides.thresholdPct ?? 15}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm };
}

describe('YieldVarianceModal smoke', () => {
  it('shows the computed variance percentage', () => {
    renderModal({ expectedQty: 10, actualQty: 5, thresholdPct: 15 });
    // (5-10)/10*100 = -50.0%
    expect(screen.getByTestId('variance-pct').textContent).toMatch(/-50\.0%/);
  });

  it('disables Confirm until the reason has ≥ 5 chars and enables after', () => {
    renderModal({ expectedQty: 10, actualQty: 5, thresholdPct: 15 });
    const confirm = screen.getByRole('button', { name: /Confirm with reason/i });
    expect(confirm).toBeDisabled();

    const textarea = screen.getByLabelText(/Reason/i);
    fireEvent.change(textarea, { target: { value: 'abc' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'oven failure today' } });
    expect(confirm).toBeEnabled();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const { onCancel } = renderModal({ expectedQty: 10, actualQty: 5, thresholdPct: 15 });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onConfirm with the trimmed reason on submit', () => {
    const { onConfirm } = renderModal({ expectedQty: 10, actualQty: 5, thresholdPct: 15 });
    const textarea = screen.getByLabelText(/Reason/i);
    fireEvent.change(textarea, { target: { value: '  short staffing  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm with reason/i }));
    expect(onConfirm).toHaveBeenCalledWith('short staffing');
  });
});
