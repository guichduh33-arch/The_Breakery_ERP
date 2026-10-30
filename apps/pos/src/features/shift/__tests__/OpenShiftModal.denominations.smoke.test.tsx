// apps/pos/src/features/shift/__tests__/OpenShiftModal.denominations.smoke.test.tsx
// S67 (12 D2.3) — flag ON : la grille remplace montant libre + quick amounts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const openShiftMutation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDenomEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('../hooks/useDenominationCountEnabled', () => ({
  useDenominationCountEnabled: mockDenomEnabled,
}));
vi.mock('../hooks/useShift', () => ({
  useOpenShift: () => ({ mutateAsync: openShiftMutation, isPending: false }),
}));
vi.mock('../hooks/useLanDevices', () => ({
  useLanDevices: () => ({ data: [] }),
}));
vi.mock('@/features/settings/hooks/usePOSPresets', () => ({
  usePOSPresets: () => ({ presets: { openingCashPresets: [100000, 200000] } }),
}));

import { OpenShiftModal } from '../OpenShiftModal';

/** Passer l'étape PIN via le numpad virtuel (pas de verifyPin → auto-submit à 6 chiffres). */
function passPinStep(): void {
  for (const ch of '123456') {
    fireEvent.click(screen.getByRole('button', { name: ch }));
  }
}

describe('OpenShiftModal — opening float', () => {
  beforeEach(() => { mockDenomEnabled.mockReturnValue(true); openShiftMutation.mockClear(); });
  it('shows the grid instead of quick amounts on the cash step', () => {
    render(<OpenShiftModal open />);
    passPinStep();
    expect(screen.getByTestId('denomination-grid')).toBeInTheDocument();
    expect(screen.queryByText(/quick amounts/i)).not.toBeInTheDocument();
  });
  it('starts the free-amount opening at 500000 IDR from Small Money', async () => {
    mockDenomEnabled.mockReturnValue(false);
    render(<OpenShiftModal open />);
    passPinStep();
    expect(screen.getByText(/500.000 from Small Money/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-shift-submit'));
    await waitFor(() => expect(openShiftMutation).toHaveBeenCalledWith({ opening_cash: 500000 }));
  });
});
