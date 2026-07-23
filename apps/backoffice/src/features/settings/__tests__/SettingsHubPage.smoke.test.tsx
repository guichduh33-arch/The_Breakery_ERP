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
let currentRole = 'ADMIN';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean; user: { role_code: string } }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p), user: { role_code: currentRole } }),
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
    currentRole = 'ADMIN';
  });

  it('renders the Settings title with subtitle from the screenshot', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /^Settings$/i })).toBeInTheDocument();
    expect(screen.getByText(/Configure your business, POS, and system preferences/i)).toBeInTheDocument();
  });

  it('renders all 7 feature-group section labels (ADR-006 décision 8)', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 2, name: /^Business$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^POS & Sales$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Inventory$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Notifications & Templates$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Finance$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Security & Access$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Network$/i })).toBeInTheDocument();
  });

  it('carries no off-module tiles — those live in their own modules (ADR-006 décision 8)', () => {
    renderPage();
    expect(screen.queryByText(/^Loyalty Program$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Product Categories$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Product Types$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Audit Log$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Sections$/i)).not.toBeInTheDocument();
  });

  it('Holidays tile links to the holidays page (no more misleading "Business Hours" label)', () => {
    renderPage();
    expect(screen.queryByText(/^Business Hours$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Holidays$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/settings/holidays');
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

  it('POS Configuration, Notifications, and Settings History are all linked (no more Soon)', () => {
    renderPage();
    expect(screen.getByText(/^POS Configuration$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/settings/pos');
    expect(screen.getByText(/^Notifications$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/settings/notifications');
    // ADR-006 déc. 9 — dedicated page, no longer the pre-filtered AuditPage deep-link.
    expect(screen.getByText(/^Settings History$/i).closest('a')?.getAttribute('href')).toBe('/backoffice/settings/history');
  });

  it('hides the Settings History tile for non-admin roles (admin-only strict)', () => {
    currentRole = 'MANAGER';
    renderPage();
    expect(screen.queryByText(/^Settings History$/i)).not.toBeInTheDocument();
  });

  it('shows the Settings History tile for SUPER_ADMIN', () => {
    currentRole = 'SUPER_ADMIN';
    renderPage();
    expect(screen.getByText(/^Settings History$/i)).toBeInTheDocument();
  });

  it('hides the Session Timeouts tile when the user lacks settings.security.manage', () => {
    currentPerms = new Set(); // no permissions granted
    renderPage();
    expect(screen.queryByText(/^Session Timeouts$/i)).not.toBeInTheDocument();
  });

  it('shows the Session Timeouts tile when the user has settings.security.manage', () => {
    renderPage();
    expect(screen.getByText(/^Session Timeouts$/i)).toBeInTheDocument();
  });
});
