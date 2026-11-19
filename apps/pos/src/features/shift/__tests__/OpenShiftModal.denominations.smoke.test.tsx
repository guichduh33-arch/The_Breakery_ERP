// apps/pos/src/features/shift/__tests__/OpenShiftModal.denominations.smoke.test.tsx
// S67 (12 D2.3) — flag ON : la grille remplace montant libre + quick amounts.
// S3-01 — le terminal de caisse est obligatoire à l'ouverture.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const openShiftMutation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDenomEnabled = vi.hoisted(() => vi.fn(() => true));
const mockDevices = vi.hoisted(() => vi.fn(() => ({ data: [] as unknown[], isSuccess: true })));
vi.mock('../hooks/useDenominationCountEnabled', () => ({
  useDenominationCountEnabled: mockDenomEnabled,
}));
vi.mock('../hooks/useShift', () => {
  class OpenShiftError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  }
  return {
    OpenShiftError,
    useOpenShift: () => ({ mutateAsync: openShiftMutation, isPending: false }),
  };
});
vi.mock('../hooks/useLanDevices', () => ({
  useLanDevices: mockDevices,
}));
vi.mock('@/features/settings/hooks/usePOSPresets', () => ({
  usePOSPresets: () => ({ presets: { openingCashPresets: [100000, 200000] } }),
}));

import { OpenShiftModal } from '../OpenShiftModal';
import { OpenShiftError } from '../hooks/useShift';

const POS1 = { id: 'term-1', code: 'POS1', name: 'Cashier', device_type: 'pos', is_active: true };
const POS2 = { id: 'term-2', code: 'POS2', name: 'Bar', device_type: 'pos', is_active: true };

/** Passer l'étape PIN via le numpad virtuel (pas de verifyPin → auto-submit à 6 chiffres). */
function passPinStep(): void {
  for (const ch of '123456') {
    fireEvent.click(screen.getByRole('button', { name: ch }));
  }
}

describe('OpenShiftModal — opening float', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDenomEnabled.mockReturnValue(true);
    mockDevices.mockReturnValue({ data: [POS1], isSuccess: true });
    openShiftMutation.mockReset().mockResolvedValue(undefined);
  });
  it('shows the grid instead of quick amounts on the cash step', () => {
    render(<OpenShiftModal open />);
    passPinStep();
    expect(screen.getByTestId('denomination-grid')).toBeInTheDocument();
    expect(screen.queryByText(/quick amounts/i)).not.toBeInTheDocument();
  });
  it('starts the free-amount opening at 500000 IDR from Small Money, on the only terminal', async () => {
    mockDenomEnabled.mockReturnValue(false);
    render(<OpenShiftModal open />);
    passPinStep();
    expect(screen.getByText(/500.000 from Small Money/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-shift-submit'));
    await waitFor(() => expect(openShiftMutation).toHaveBeenCalledWith({
      opening_cash: 500000, terminal_id: 'term-1',
    }));
  });
});

describe('OpenShiftModal — terminal is required (S3-01)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDenomEnabled.mockReturnValue(false);
    openShiftMutation.mockReset().mockResolvedValue(undefined);
  });
  it('blocks the opening when no terminal is chosen among several', () => {
    mockDevices.mockReturnValue({ data: [POS1, POS2], isSuccess: true });
    render(<OpenShiftModal open />);
    passPinStep();
    expect(screen.getByTestId('open-shift-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('shift-terminal'), { target: { value: 'term-2' } });
    expect(screen.getByTestId('open-shift-submit')).toBeEnabled();
  });
  it('ignores a remembered terminal that is no longer active', () => {
    localStorage.setItem('pos:last_terminal_id', 'gone');
    mockDevices.mockReturnValue({ data: [POS1, POS2], isSuccess: true });
    render(<OpenShiftModal open />);
    passPinStep();
    expect(screen.getByTestId('open-shift-submit')).toBeDisabled();
  });
  it('says so when no cash terminal exists', () => {
    mockDevices.mockReturnValue({ data: [], isSuccess: true });
    render(<OpenShiftModal open />);
    passPinStep();
    expect(screen.getByTestId('shift-terminal-none')).toBeInTheDocument();
    expect(screen.getByTestId('open-shift-submit')).toBeDisabled();
  });
  it('explains a terminal that already has an open shift', async () => {
    mockDevices.mockReturnValue({ data: [POS1], isSuccess: true });
    openShiftMutation.mockRejectedValue(new OpenShiftError('terminal_session_open', 'terminal_session_open'));
    render(<OpenShiftModal open />);
    passPinStep();
    fireEvent.click(screen.getByTestId('open-shift-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already open on this terminal/i);
  });
});
