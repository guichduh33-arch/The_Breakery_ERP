// apps/pos/src/features/settings/__tests__/POSSettingsPage.test.tsx
//
// Session 14 — Phase 2.D smoke for the POS Settings page. The page is a
// presentational shell (no data hooks) ; we only need to exercise the role
// gate, the top-tab + sub-tab toggles, and the back-nav handler.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSSettingsPage from '../POSSettingsPage';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const authState = { current: { canEdit: true } };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: () => authState.current.canEdit }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <POSSettingsPage />
    </MemoryRouter>,
  );
}

describe('POSSettingsPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    authState.current = { canEdit: true };
  });

  it('renders the header, all top tabs, and the default POS Configuration section', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /pos settings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^pos$/i, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /printing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /kds & display/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /devices/i })).toBeInTheDocument();
    expect(screen.getByText(/pos configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/quick payment amounts/i)).toBeInTheDocument();
  });

  it('shows the Read only badge when the user lacks settings.update', () => {
    authState.current = { canEdit: false };
    renderPage();
    expect(screen.getByText(/read only/i)).toBeInTheDocument();
  });

  it('switches to Printing placeholder when the Printing tab is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /printing/i }));
    expect(screen.queryByText(/quick payment amounts/i)).toBeNull();
    expect(screen.getAllByText(/printing/i).length).toBeGreaterThan(0);
  });

  it('switches between Configuration sub-tabs (General → Automation)', () => {
    renderPage();
    expect(screen.getByText(/quick payment amounts/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^automation$/i }));
    expect(screen.queryByText(/quick payment amounts/i)).toBeNull();
  });

  it('navigates back to /pos when the back button is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pos-settings-back'));
    expect(navigateMock).toHaveBeenCalledWith('/pos');
  });
});
