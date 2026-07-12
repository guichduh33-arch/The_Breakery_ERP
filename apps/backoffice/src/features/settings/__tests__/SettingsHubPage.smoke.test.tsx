// apps/backoffice/src/features/settings/__tests__/SettingsHubPage.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the rebuilt categorized settings hub.
//
// S73 Lot 3 (Task 11) — hub cleanup: no more dead-end "(Soon)" tiles, and
// permission-gated tiles (Security) hide when the user lacks the route's
// permission.
//
// S75 Task 3 — Floor Plan shipped as a real linked+permission-gated tile
// (was `planned: true`).
// S75 Task 8 — KDS Configuration shipped as a real linked tile (was the
// last `planned: true` tile) — the hub now has ZERO planned tiles.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsHubPage from '@/pages/settings/SettingsHubPage.js';

let currentPerms = new Set<string>(['settings.security.manage', 'accounting.period.close', 'expenses.thresholds.read', 'tables.update']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsHubPage />
    </MemoryRouter>,
  );
}

describe('SettingsHubPage', () => {
  beforeEach(() => {
    cleanup();
    currentPerms = new Set(['settings.security.manage', 'accounting.period.close', 'expenses.thresholds.read', 'tables.update']);
  });

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

  it('no tile carries a literal "(Soon)" dead-end label', () => {
    renderPage();
    expect(screen.queryByText(/\(Soon\)/i)).not.toBeInTheDocument();
  });

  it('renders zero planned (dead-end) tiles — KDS Configuration is now linked', () => {
    renderPage();

    expect(screen.queryByText(/Planned — dedicated session/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^KDS Configuration$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/settings/kds');
  });

  it('Floor Plan is linked and permission-gated (tables.update) — S75 Task 3', () => {
    renderPage();
    expect(screen.getByText(/^Floor Plan$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/settings/floor-plan');
  });

  it('hides the Floor Plan tile when the user lacks tables.update', () => {
    currentPerms = new Set();
    renderPage();
    expect(screen.queryByText(/^Floor Plan$/i)).not.toBeInTheDocument();
  });

  it('POS Configuration, Product Categories, Product Types, Notifications, and Settings History are all linked (no more Soon)', () => {
    renderPage();
    expect(screen.getByText(/^POS Configuration$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/settings/pos');
    expect(screen.getByText(/^Product Categories$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/categories');
    expect(screen.getByText(/^Product Types$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/products');
    expect(screen.getByText(/^Notifications$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/settings/notifications');
    expect(screen.getByText(/^Settings History$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/reports/audit?action=setting.update');
  });

  it('hides the Security & PIN tile when the user lacks settings.security.manage', () => {
    currentPerms = new Set(); // no permissions granted
    renderPage();
    expect(screen.queryByText(/^Security & PIN$/i)).not.toBeInTheDocument();
  });

  it('shows the Security & PIN tile when the user has settings.security.manage', () => {
    renderPage();
    expect(screen.getByText(/^Security & PIN$/i)).toBeInTheDocument();
  });
});
