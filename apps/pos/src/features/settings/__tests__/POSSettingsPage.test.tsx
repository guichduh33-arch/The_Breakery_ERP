// apps/pos/src/features/settings/__tests__/POSSettingsPage.test.tsx
//
// Session 14 — Phase 2.D smoke for the POS Settings page.
// Reviewer follow-up #18 — page is now wired to usePOSPresets ; we mock
// the hook with realistic data + no-op mutators and assert that the
// preset rows render and the +/- buttons call the right mutator with
// the new array.

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

const presetState = {
  current: {
    presets: {
      quickPayments: [50_000, 100_000, 150_000],
      openingCashPresets: [200_000, 300_000],
      discountPresets: [
        { value: 5, name: '5%' },
        { value: 10, name: 'Tens' },
      ],
    },
    isLoading: false,
    error: null as Error | null,
  },
  mutateQuickPayments: vi.fn(),
  mutateOpeningCash: vi.fn(),
  mutateDiscountPresets: vi.fn(),
};

vi.mock('../hooks/usePOSPresets', () => ({
  usePOSPresets: () => ({
    presets: presetState.current.presets,
    isLoading: presetState.current.isLoading,
    error: presetState.current.error,
    mutateQuickPayments: { mutate: presetState.mutateQuickPayments, isPending: false },
    mutateOpeningCash: { mutate: presetState.mutateOpeningCash, isPending: false },
    mutateDiscountPresets: { mutate: presetState.mutateDiscountPresets, isPending: false },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../hooks/useOrgDisplaySettings', () => ({
  useOrgDisplaySettings: vi.fn(() => ({
    displayFooterMessage: '',
    displaySlogan: '',
    autoPrint: true,
    autoOpenDrawer: true,
    isLoading: false,
  })),
  useSetOrgDisplaySetting: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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
    presetState.mutateQuickPayments.mockReset();
    presetState.mutateOpeningCash.mockReset();
    presetState.mutateDiscountPresets.mockReset();
    authState.current = { canEdit: true };
    presetState.current.isLoading = false;
    presetState.current.error = null;
  });

  it('renders the header, all top tabs, and the default POS Configuration section', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /pos settings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^pos$/i, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /printing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /customer display/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /devices/i })).toBeInTheDocument();
    expect(screen.getByText(/pos configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/quick payment amounts/i)).toBeInTheDocument();
  });

  it('shows the Read only badge when the user lacks settings.update', () => {
    authState.current = { canEdit: false };
    renderPage();
    expect(screen.getByText(/read only/i)).toBeInTheDocument();
  });

  it('switches to the Printing settings tab when the Printing tab is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /printing/i }));
    expect(screen.queryByText(/quick payment amounts/i)).toBeNull();
    expect(screen.getByLabelText(/print server url/i)).toBeInTheDocument();
  });

  it('has no Automation sub-tab (S73 A4 — toggles live on Printing)', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /automation/i })).not.toBeInTheDocument();
  });

  it('labels the display top-tab "Customer Display" and scopes General as org', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /customer display/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /kds/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('Établissement').length).toBeGreaterThan(0);
  });

  it('switches between Configuration sub-tabs (General → Advanced)', () => {
    renderPage();
    expect(screen.getByText(/quick payment amounts/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^advanced$/i }));
    expect(screen.queryByText(/quick payment amounts/i)).toBeNull();
    expect(screen.getByRole('button', { name: /reset terminal settings/i })).toBeInTheDocument();
  });

  it('navigates back to /pos when the back button is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('pos-settings-back'));
    expect(navigateMock).toHaveBeenCalledWith('/pos');
  });

  it('renders mocked preset values from usePOSPresets', () => {
    renderPage();
    // Quick payments amounts (3 chips)
    expect(screen.getByText(/Rp\s*50,000/)).toBeInTheDocument();
    expect(screen.getByText(/Rp\s*100,000/)).toBeInTheDocument();
    expect(screen.getByText(/Rp\s*150,000/)).toBeInTheDocument();
    // Opening cash presets (2 chips)
    expect(screen.getByText(/Rp\s*200,000/)).toBeInTheDocument();
    expect(screen.getByText(/Rp\s*300,000/)).toBeInTheDocument();
    // Discount presets (2 rows)
    expect(screen.getByText('Tens')).toBeInTheDocument();
  });

  it('renders the loading skeleton while presets are loading', () => {
    presetState.current.isLoading = true;
    renderPage();
    expect(screen.getByTestId('pos-presets-loading')).toBeInTheDocument();
    expect(screen.queryByText(/quick payment amounts/i)).toBeNull();
  });

  it('renders an error card when usePOSPresets returns an error', () => {
    presetState.current.error = new Error('boom');
    renderPage();
    expect(screen.getByTestId('pos-presets-error')).toBeInTheDocument();
  });

  it('removes a quick payment preset when its trash button is clicked', () => {
    renderPage();
    // The first chip's "Remove" button — there are several Remove buttons across
    // chips/rows; index 0 is the first quick-payment chip (50,000).
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[0]!);
    expect(presetState.mutateQuickPayments).toHaveBeenCalledTimes(1);
    const arg = presetState.mutateQuickPayments.mock.calls[0]![0];
    expect(arg).toEqual([100_000, 150_000]);
  });

  it('reorders quick payments when the Move down button is clicked', () => {
    renderPage();
    const moveDownButtons = screen.getAllByRole('button', { name: 'Move down' });
    fireEvent.click(moveDownButtons[0]!);
    expect(presetState.mutateQuickPayments).toHaveBeenCalledTimes(1);
    const arg = presetState.mutateQuickPayments.mock.calls[0]![0];
    expect(arg).toEqual([100_000, 50_000, 150_000]);
  });

  it('adds a new opening-cash preset when the Add button is clicked with a valid amount', () => {
    renderPage();
    const input = screen.getByLabelText('New Shift Opening Cash Presets preset') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500000' } });
    // The "Add" button in the opening-cash section (second one on the page).
    const addButtons = screen.getAllByRole('button', { name: /add/i });
    // Quick Payments Add is index 0, Opening Cash Add is index 1, Discount Add is index 2.
    fireEvent.click(addButtons[1]!);
    expect(presetState.mutateOpeningCash).toHaveBeenCalledTimes(1);
    const arg = presetState.mutateOpeningCash.mock.calls[0]![0];
    expect(arg).toEqual([200_000, 300_000, 500_000]);
  });

  it('removes a discount preset when its row trash button is clicked', () => {
    renderPage();
    const removeButton = screen.getByRole('button', { name: 'Remove Tens' });
    fireEvent.click(removeButton);
    expect(presetState.mutateDiscountPresets).toHaveBeenCalledTimes(1);
    const arg = presetState.mutateDiscountPresets.mock.calls[0]![0];
    expect(arg).toEqual([{ value: 5, name: '5%' }]);
  });
});
