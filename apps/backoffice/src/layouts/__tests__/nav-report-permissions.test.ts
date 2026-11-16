import { describe, expect, it } from 'vitest';
import type { PermissionCode } from '@breakery/supabase';
import { NAV_DOMAINS, flattenDestinations, visibleDomains } from '../nav.js';

describe('droits des liens de rapports', () => {
  it.each([
    ['sales-by-product', 'reports.sales.read', 'reports.product_sales.read'],
    ['cashier-variance', 'reports.financial.read', 'reports.read'],
    ['off-hours-sales', 'reports.audit.read', 'reports.sales.read'],
    ['production-yield', 'reports.inventory.read', 'inventory.read'],
    ['production-vs-sales', 'reports.inventory.read', 'reports.sales.read'],
  ] as const)('%s suit le droit exigé par sa page', (path, required, insufficient) => {
    const to = `/backoffice/reports/${path}`;
    const destinations = (allowed: PermissionCode) => flattenDestinations(
      visibleDomains(NAV_DOMAINS, (permission) => permission === allowed),
    ).map((link) => link.to);
    expect(destinations(required)).toContain(to);
    expect(destinations(insufficient)).not.toContain(to);
  });
});
