import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { pairKiosk } = vi.hoisted(() => ({ pairKiosk: vi.fn() }));
vi.mock('@/lib/kioskAuth', () => ({ pairKiosk }));
import { PairDevicePrompt } from '../components/PairDevicePrompt';
beforeEach(() => vi.clearAllMocks());
describe('activation de l’écran', () => {
  it('ne termine pas un appairage refusé par le serveur', async () => {
    pairKiosk.mockRejectedValue(new Error('rejected'));
    const done = vi.fn(); render(<PairDevicePrompt onPaired={done} />);
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'abcd-ef01-2345-6789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair display' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pairing failed');
    expect(done).not.toHaveBeenCalled();
  });
  it('termine uniquement après la réponse autorisée', async () => {
    pairKiosk.mockResolvedValue(undefined);
    const done = vi.fn(); render(<PairDevicePrompt onPaired={done} />);
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'abcd-ef01-2345-6789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair display' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
  });
});
