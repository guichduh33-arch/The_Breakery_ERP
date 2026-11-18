// Vérifier l'accès par URL, même si la session Admin porte tous les droits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';

const state = vi.hoisted(() => {
  const user: { role_code: string | undefined } = { role_code: 'ADMIN' };
  return {
    isAuthenticated: true,
    user,
    hasPermission: vi.fn((_code: string) => true),
    reportMounted: vi.fn(),
  };
});
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('@/layouts/BackofficeLayout.js', () => ({
  BackofficeLayout: () => <div><nav data-testid="shell-nav" /><Outlet /></div>,
}));
vi.mock('@/pages/reports/GrossMarginPage.js', () => ({
  default: () => { state.reportMounted(); return <div>Protected report</div>; },
}));
vi.mock('@/pages/reports/PaymentByMethodPage.js', () => ({
  default: () => { state.reportMounted(); return <div>Protected report</div>; },
}));
vi.mock('@/pages/reports/Pb1ReportPage.js', () => ({
  default: () => { state.reportMounted(); return <div>Protected report</div>; },
}));
import { AppRoutes } from '@/routes/index.js';

function openReport(report: string) {
  render(<MemoryRouter initialEntries={[`/backoffice/reports/${report}`]}><AppRoutes /></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.user.role_code = 'ADMIN';
  state.hasPermission.mockReturnValue(true);
});
afterEach(cleanup);

// ADR-039 (S1-08) : les états financiers suivent `reports.statements.read`,
// donnée au seul propriétaire à la livraison, et non plus le rôle.
describe.each(['gross-margin', 'pb1'])('%s access', (report) => {
  it.each(['ADMIN', 'MANAGER', undefined])('denies role %s without the statements permission', async (role) => {
    state.user.role_code = role;
    state.hasPermission.mockImplementation((code: string) => code !== 'reports.statements.read');
    openReport(report);
    expect(await screen.findByTestId('route-denied')).toHaveTextContent('reports.statements.read');
    expect(screen.getByTestId('shell-nav')).toBeInTheDocument();
    expect(state.reportMounted).not.toHaveBeenCalled();
  });
  it('allows a delegate holding the statements permission to mount the report', async () => {
    state.user.role_code = 'ADMIN';
    openReport(report);
    expect(await screen.findByText('Protected report')).toBeInTheDocument();
    expect(screen.queryByTestId('route-denied')).not.toBeInTheDocument();
  });
  it('retains the financial permission check', async () => {
    state.hasPermission.mockImplementation((code: string) => code !== 'reports.financial.read');
    openReport(report);
    expect(await screen.findByTestId('route-denied')).toHaveTextContent('reports.financial.read');
    expect(state.reportMounted).not.toHaveBeenCalled();
  });
});

// Les paiements par méthode relèvent de la confidentialité de la journée :
// ils restent réservés au rôle propriétaire.
describe.each(['payment-by-method'])('%s access', (report) => {
  it.each(['ADMIN', 'MANAGER', undefined])('denies role %s before mounting the report', async (role) => {
    state.user.role_code = role;
    openReport(report);
    expect(await screen.findByTestId('route-denied')).toHaveTextContent('Super admin');
    expect(screen.getByTestId('shell-nav')).toBeInTheDocument();
    expect(state.reportMounted).not.toHaveBeenCalled();
  });
  it('allows the Owner to mount the report', async () => {
    state.user.role_code = 'SUPER_ADMIN';
    openReport(report);
    expect(await screen.findByText('Protected report')).toBeInTheDocument();
    expect(screen.queryByTestId('route-denied')).not.toBeInTheDocument();
  });
  it('retains the financial permission check', async () => {
    state.user.role_code = 'SUPER_ADMIN';
    state.hasPermission.mockReturnValue(false);
    openReport(report);
    expect(await screen.findByTestId('route-denied')).toHaveTextContent('reports.financial.read');
    expect(state.reportMounted).not.toHaveBeenCalled();
  });
});
