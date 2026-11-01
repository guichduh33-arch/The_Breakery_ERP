import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { DeviceSyncMount } from '../DeviceSyncMount';

const auto = vi.hoisted(() => vi.fn());
vi.mock('../useAutoDeviceSync', () => ({ useAutoDeviceSync: auto }));

beforeEach(() => {
  auto.mockClear();
  useAuthStore.setState({ isAuthenticated: true, bootstrapStatus: 'ready', cloudValidated: true, isLocked: false });
});
afterEach(cleanup);

describe('device sync session boundary', () => {
  it.each(['/pos', '/tablet/order', '/kds', '/display?source=checkout'])('active la lecture automatique sur %s', (route) => {
    render(<MemoryRouter initialEntries={[route]}><DeviceSyncMount /></MemoryRouter>);
    expect(auto).toHaveBeenLastCalledWith(true);
  });

  it.each(['/display', '/login'])('ne suppose pas une session PIN sur %s', (route) => {
    render(<MemoryRouter initialEntries={[route]}><DeviceSyncMount /></MemoryRouter>);
    expect(auto).toHaveBeenLastCalledWith(false);
  });

  it('ne rafraîchit pas les données protégées lorsque le terminal est verrouillé', () => {
    useAuthStore.setState({ isLocked: true });
    render(<MemoryRouter initialEntries={['/tablet/order']}><DeviceSyncMount /></MemoryRouter>);
    expect(auto).toHaveBeenLastCalledWith(false);
  });
});
