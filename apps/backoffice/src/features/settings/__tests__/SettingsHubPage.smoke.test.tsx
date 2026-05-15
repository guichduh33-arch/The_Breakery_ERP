// apps/backoffice/src/features/settings/__tests__/SettingsHubPage.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the rebuilt categorized settings hub.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsHubPage from '@/pages/settings/SettingsHubPage.js';

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsHubPage />
    </MemoryRouter>,
  );
}

describe('SettingsHubPage', () => {
  beforeEach(() => { cleanup(); });

  it('renders the Settings title with subtitle from the screenshot', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /^Settings$/i })).toBeInTheDocument();
    expect(screen.getByText(/Configure your business, POS, and system preferences/i)).toBeInTheDocument();
  });

  it('renders all 6 section labels', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 2, name: /^General$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Sales/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Operations$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Commerce/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^System$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Layout/i })).toBeInTheDocument();
  });

  it('Company tile links to the General settings page', () => {
    renderPage();
    const companyLink = screen.getByText(/^Company$/i).closest('a');
    expect(companyLink).not.toBeNull();
    expect(companyLink?.getAttribute('href')).toBe('/backoffice/settings/general');
  });
});
