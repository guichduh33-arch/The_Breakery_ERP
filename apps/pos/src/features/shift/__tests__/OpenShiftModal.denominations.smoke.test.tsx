// apps/pos/src/features/shift/__tests__/OpenShiftModal.denominations.smoke.test.tsx
// S67 (12 D2.3) — flag ON : la grille remplace montant libre + quick amounts.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockDenomEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('../hooks/useDenominationCountEnabled', () => ({
  useDenominationCountEnabled: mockDenomEnabled,
}));
vi.mock('../hooks/useShift', () => ({
  useOpenShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

describe('OpenShiftModal — denomination grid (flag on)', () => {
  it('shows the grid instead of quick amounts on the cash step', () => {
    render(<OpenShiftModal open />);
    passPinStep();
    expect(screen.getByTestId('denomination-grid')).toBeInTheDocument();
    expect(screen.queryByText(/quick amounts/i)).not.toBeInTheDocument();
  });
});
