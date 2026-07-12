// Smoke for the permission-filtered tab strip: the Margin tab requires
// reports.financial.read; every other tab stays visible without it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSReportsLayout } from '../components/POSReportsLayout';

const perms = { current: new Set<string>(['reports.financial.read']) };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: (code: string) => perms.current.has(code) }),
}));

function renderLayout() {
  return render(
    <MemoryRouter>
      <POSReportsLayout activeTab="overview">{() => <div>content</div>}</POSReportsLayout>
    </MemoryRouter>,
  );
}

describe('POSReportsLayout', () => {
  beforeEach(() => {
    perms.current = new Set(['reports.financial.read']);
  });

  it('shows the Margin tab when the user holds reports.financial.read', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: /margin/i })).toBeInTheDocument();
  });

  it('hides ONLY the Margin tab without reports.financial.read', () => {
    perms.current = new Set();
    renderLayout();
    expect(screen.queryByRole('button', { name: /margin/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /products/i })).toBeInTheDocument();
  });
});
