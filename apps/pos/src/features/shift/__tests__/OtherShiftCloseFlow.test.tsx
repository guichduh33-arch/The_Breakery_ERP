// S3-01 — un manager clôture la session d'un autre caissier.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

interface SummaryState { data: Record<string, number> | undefined; isError: boolean; refetch: () => void }
const summary = vi.hoisted(() => {
  const current: SummaryState = { data: undefined, isError: false, refetch: () => undefined };
  return { current };
});
vi.mock('../hooks/useShiftCloseSummary', () => ({ useShiftCloseSummary: () => summary.current }));
vi.mock('../components/CloseShiftModal', () => ({
  CloseShiftModal: ({ sessionId, expectedCash }: { sessionId: string; expectedCash: number }) =>
    <div data-testid="close-modal">{sessionId}:{expectedCash}</div>,
}));
import { OtherShiftCloseFlow } from '../components/OtherShiftCloseFlow';

describe('OtherShiftCloseFlow (S3-01)', () => {
  beforeEach(() => { summary.current = { data: undefined, isError: false, refetch: vi.fn() }; });

  it('waits for the summary of the other cashier\'s shift', () => {
    render(<OtherShiftCloseFlow sessionId="s9" cashierName="Cashier A" onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Cashier A/);
  });

  it('opens the usual close screen on that session', () => {
    summary.current = { ...summary.current, data: { expectedCash: 150000, thresholdAbs: 1, thresholdPct: 1, pinThresholdAbs: 1, pinThresholdPct: 1 } };
    render(<OtherShiftCloseFlow sessionId="s9" cashierName="Cashier A" onClose={vi.fn()} />);
    expect(screen.getByTestId('close-modal')).toHaveTextContent('s9:150000');
  });
});
