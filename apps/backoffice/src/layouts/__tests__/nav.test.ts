// apps/backoffice/src/layouts/__tests__/nav.test.ts
//
// Refonte shell 2026-08-05 — le filet du modèle de navigation.
//
// Le test qui compte est le PREMIER : passer de 8 groupes accordéon à 7
// domaines a été une réécriture manuelle de ~85 entrées, et le mode d'échec
// coûteux n'est pas une couleur fausse, c'est une page qui n'est plus
// atteignable. On liste donc ici toutes les destinations que portait l'ancien
// Sidebar et on exige qu'aucune n'ait disparu.

import { describe, it, expect } from 'vitest';
import type { PermissionCode } from '@breakery/supabase';
import {
  NAV_DOMAINS,
  activeDomainId,
  flattenDestinations,
  routeMatches,
  visibleDomains,
} from '../nav.js';

/**
 * Les 85 destinations de l'ancien `GROUPS` (layouts/Sidebar.tsx, supprimé dans
 * ce même commit — relisible via `git show HEAD~1:...`). Ordre d'origine.
 */
const LEGACY_DESTINATIONS = [
  '/backoffice',
  // Sales
  '/backoffice/orders',
  '/backoffice/customers',
  '/backoffice/customers/categories',
  '/backoffice/b2b',
  '/backoffice/b2b/payments',
  '/backoffice/promotions',
  '/backoffice/loyalty',
  // Purchase
  '/backoffice/purchasing/purchase-orders',
  '/backoffice/suppliers',
  // Stock management
  '/backoffice/products',
  '/backoffice/products/combos',
  '/backoffice/categories',
  '/backoffice/inventory',
  '/backoffice/inventory/incoming',
  '/backoffice/inventory/production',
  '/backoffice/inventory/opname',
  '/backoffice/inventory/movements',
  '/backoffice/inventory/display',
  '/backoffice/inventory/alerts',
  '/backoffice/inventory/sections',
  // Finance
  '/backoffice/expenses',
  '/backoffice/accounting/chart-of-accounts',
  '/backoffice/accounting/journal-entries',
  '/backoffice/accounting/general-ledger',
  '/backoffice/accounting/cash',
  '/backoffice/accounting/trial-balance',
  '/backoffice/accounting/mappings',
  '/backoffice/cash-register/zreports',
  // Reports
  '/backoffice/reports',
  '/backoffice/reports/sales-by-hour',
  '/backoffice/reports/sales-by-category',
  '/backoffice/reports/sales-by-staff',
  '/backoffice/reports/cashier-variance',
  '/backoffice/reports/basket-analysis',
  '/backoffice/reports/daily-sales',
  '/backoffice/reports/staff-performance',
  '/backoffice/reports/payment-by-method',
  '/backoffice/reports/stock-variance',
  '/backoffice/reports/production-yield',
  '/backoffice/reports/stock-movements',
  '/backoffice/reports/wastage',
  '/backoffice/reports/recipe-cost',
  '/backoffice/inventory/production/margin-watch',
  '/backoffice/reports/production-report',
  '/backoffice/reports/production-efficiency',
  '/backoffice/reports/cost-spend',
  '/backoffice/reports/purchase-items',
  '/backoffice/reports/purchase-by-date',
  '/backoffice/reports/purchase-by-supplier',
  '/backoffice/reports/profit-loss',
  '/backoffice/reports/gross-margin',
  '/backoffice/reports/operating-expenses',
  '/backoffice/reports/balance-sheet',
  '/backoffice/reports/cash-flow',
  '/backoffice/reports/pb1',
  '/backoffice/marketing/cohort',
  '/backoffice/marketing/segments',
  '/backoffice/marketing/promo-roi',
  '/backoffice/marketing/birthday',
  '/backoffice/reports/audit',
  '/backoffice/reports/price-changes',
  '/backoffice/reports/permission-changes',
  // Settings
  '/backoffice/settings',
  '/backoffice/settings/general',
  '/backoffice/settings/holidays',
  '/backoffice/settings/pos',
  '/backoffice/settings/payment-methods',
  '/backoffice/settings/printing',
  '/backoffice/settings/floor-plan',
  '/backoffice/settings/kds',
  '/backoffice/settings/customer-display',
  '/backoffice/settings/inventory',
  '/backoffice/settings/notifications',
  '/backoffice/settings/templates/email',
  '/backoffice/settings/templates/receipt',
  '/backoffice/settings/accounting',
  '/backoffice/settings/expense-thresholds',
  '/backoffice/b2b/settings',
  '/backoffice/settings/security',
  '/backoffice/settings/permissions',
  '/backoffice/lan-devices',
  '/backoffice/users',
  '/backoffice/users/permissions',
];

const allowAll = () => true;
const allowNone = () => false;

describe('nav model', () => {
  it('ne perd aucune destination de l’ancien Sidebar', () => {
    const reachable = new Set(flattenDestinations(NAV_DOMAINS).map((d) => d.to));
    const missing = LEGACY_DESTINATIONS.filter((to) => !reachable.has(to));
    expect(missing).toEqual([]);
  });

  it('n’expose aucune destination en double', () => {
    const all = flattenDestinations(NAV_DOMAINS).map((d) => d.to);
    const duplicates = all.filter((to, i) => all.indexOf(to) !== i);
    expect(duplicates).toEqual([]);
  });

  it('déclare exactement les 7 domaines de la top bar', () => {
    expect(NAV_DOMAINS.map((d) => d.label)).toEqual([
      'Today', 'Sales', 'Stock', 'Purchase', 'Finance', 'Reports', 'Admin',
    ]);
  });

  it('Today est une destination directe, les six autres ont des colonnes', () => {
    const [today, ...rest] = NAV_DOMAINS;
    expect(today?.to).toBe('/backoffice');
    expect(today?.columns).toBeUndefined();
    for (const domain of rest) {
      expect(domain.columns?.length ?? 0).toBeGreaterThan(0);
      expect(domain.to).toBeUndefined();
    }
  });

  describe('visibleDomains', () => {
    it('garde tout le modèle pour un rôle omnipotent', () => {
      expect(visibleDomains(NAV_DOMAINS, allowAll)).toHaveLength(NAV_DOMAINS.length);
    });

    it('ne laisse que Today quand le rôle n’a aucun droit', () => {
      const visible = visibleDomains(NAV_DOMAINS, allowNone);
      expect(visible.map((d) => d.id)).toEqual(['today']);
    });

    it('vide la colonne puis le domaine en cascade', () => {
      // Seul `expenses.read` : Finance ne garde que la colonne Expenses,
      // Accounting et Closing disparaissent, et les autres domaines aussi.
      const only = (code: PermissionCode) => code === 'expenses.read';
      const visible = visibleDomains(NAV_DOMAINS, only);
      expect(visible.map((d) => d.id)).toEqual(['today', 'finance']);
      const finance = visible.find((d) => d.id === 'finance');
      expect(finance?.columns?.map((c) => c.label)).toEqual(['Expenses']);
    });
  });

  describe('activeDomainId', () => {
    it('résout la route d’accueil sur Today', () => {
      expect(activeDomainId(NAV_DOMAINS, '/backoffice')).toBe('today');
    });

    it('préfère le `to` le plus long — un lien profond ne retombe pas sur Today', () => {
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/inventory/opname')).toBe('stock');
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/reports/cash-flow')).toBe('reports');
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/settings/kds')).toBe('admin');
    });

    it('rattache une route enfant non listée à son domaine parent', () => {
      // /backoffice/orders/:id n'est pas dans le modèle, mais /backoffice/orders
      // l'est — et porte `end: true`, que activeDomainId doit ignorer.
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/orders/abc-123')).toBe('sales');
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/products/p-1/dashboard')).toBe('stock');
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/users/u-1')).toBe('admin');
    });

    it('tranche entre deux domaines par le préfixe le plus long', () => {
      // /backoffice/b2b est dans Sales, /backoffice/b2b/settings dans Admin.
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/b2b')).toBe('sales');
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/b2b/settings')).toBe('admin');
      // Les rapports d'achat ont migré de Reports vers Purchase.
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/reports/purchase-items')).toBe('purchase');
      expect(activeDomainId(NAV_DOMAINS, '/backoffice/reports/wastage')).toBe('reports');
    });

    it('renvoie null hors du périmètre connu', () => {
      expect(activeDomainId(NAV_DOMAINS, '/login')).toBeNull();
    });
  });

  describe('routeMatches', () => {
    it('exige l’égalité stricte quand `end` est vrai', () => {
      expect(routeMatches('/backoffice', true, '/backoffice')).toBe(true);
      expect(routeMatches('/backoffice', true, '/backoffice/products')).toBe(false);
    });

    it('accepte les descendants sinon — mais pas un préfixe de segment', () => {
      expect(routeMatches('/backoffice/b2b', undefined, '/backoffice/b2b/payments')).toBe(true);
      expect(routeMatches('/backoffice/b2b', undefined, '/backoffice/b2because')).toBe(false);
    });
  });

  describe('flattenDestinations', () => {
    it('porte le fil d’Ariane de chaque destination', () => {
      const flat = flattenDestinations(NAV_DOMAINS);
      const cashFlow = flat.find((d) => d.to === '/backoffice/reports/cash-flow');
      expect(cashFlow?.domainLabel).toBe('Reports');
      expect(cashFlow?.columnLabel).toBe('Financial');
    });
  });
});
