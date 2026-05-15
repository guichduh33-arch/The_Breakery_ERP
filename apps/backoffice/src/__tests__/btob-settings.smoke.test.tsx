// apps/backoffice/src/__tests__/btob-settings.smoke.test.tsx
//
// Session 14 / Phase 5.B — smoke for the read-only B2B Settings page.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import B2BSettingsPage from '@/pages/btob/B2BSettingsPage.js';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => p === 'settings.read' }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <B2BSettingsPage />
    </MemoryRouter>,
  );
}

describe('B2BSettingsPage', () => {
  it('renders default term selector + 5 seed terms + 3 aging buckets', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /b2b settings/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/default payment terms/i)).toHaveValue('net_30');
    expect(screen.getByText('cod')).toBeInTheDocument();
    expect(screen.getByText('net_30')).toBeInTheDocument();
    // Three aging buckets seeded
    expect(screen.getByLabelText(/current label/i)).toHaveValue('Current');
    expect(screen.getByLabelText(/overdue label/i)).toHaveValue('Overdue');
    expect(screen.getByLabelText(/critical label/i)).toHaveValue('Critical');
  });

  it('lets the user add and remove a payment term locally', () => {
    renderPage();
    const input = screen.getByLabelText(/new payment term/i);
    fireEvent.change(input, { target: { value: 'net_45' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByText('net_45')).toBeInTheDocument();
    // Remove it
    fireEvent.click(screen.getByRole('button', { name: /remove net_45/i }));
    expect(screen.queryByText('net_45')).toBeNull();
  });
});
