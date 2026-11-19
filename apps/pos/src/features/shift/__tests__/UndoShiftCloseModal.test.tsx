// S3-03 — le modal d'annulation de clôture recueille le PIN du propriétaire.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as UndoHook from '../hooks/useUndoShiftClose';

const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useUndoShiftClose', async (orig) => {
  const real = await orig<typeof UndoHook>();
  return { ...real, useUndoShiftClose: () => ({ mutateAsync, isPending: false }) };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { UndoShiftCloseModal } from '../components/UndoShiftCloseModal';
import { UndoShiftCloseError } from '../hooks/useUndoShiftClose';

function typePin(pin: string): void {
  for (const ch of pin) fireEvent.click(screen.getByRole('button', { name: ch }));
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('UndoShiftCloseModal (S3-03)', () => {
  // Accolades : une fonction rendue par beforeEach serait appelée au nettoyage.
  beforeEach(() => { mutateAsync.mockReset(); });

  it('sends the session, the PIN and the reason, then closes', async () => {
    mutateAsync.mockResolvedValue({ sessionId: 's1' });
    const onClose = vi.fn();
    render(<UndoShiftCloseModal open sessionId="s1" cashierName="Cashier B" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Recount' } });
    typePin('246810');
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ sessionId: 's1', managerPin: '246810', reason: 'Recount' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows why the server refused and stays open', async () => {
    mutateAsync.mockImplementation(() => Promise.reject(new UndoShiftCloseError('zreport_not_draft', 'zreport_not_draft')));
    const onClose = vi.fn();
    render(<UndoShiftCloseModal open sessionId="s1" cashierName="Cashier B" onClose={onClose} />);
    typePin('246810');
    expect(await screen.findByRole('alert')).toHaveTextContent(/signed/i);
    expect(onClose).not.toHaveBeenCalled();
  });
});
