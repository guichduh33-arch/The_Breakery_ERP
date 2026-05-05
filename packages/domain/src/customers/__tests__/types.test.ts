import { describe, it, expect } from 'vitest';
import type { Customer, CustomerSearchResult } from '../types';

describe('Customer type', () => {
  it('constructs a valid Customer object', () => {
    const customer: Customer = {
      id: 'abc-123',
      name: 'Alice',
      phone: '+62811111111',
      email: null,
      customer_type: 'retail',
      loyalty_points: 120,
      lifetime_points: 500,
      total_spent: 350000,
      total_visits: 5,
      last_visit_at: '2026-01-01T10:00:00Z',
    };
    expect(customer.customer_type).toBe('retail');
    expect(customer.loyalty_points).toBe(120);
    expect(customer.lifetime_points).toBe(500);
  });

  it('allows null optional fields', () => {
    const customer: Customer = {
      id: 'xyz',
      name: 'Bob',
      phone: null,
      email: null,
      customer_type: 'retail',
      loyalty_points: 0,
      lifetime_points: 0,
      total_spent: 0,
      total_visits: 0,
      last_visit_at: null,
    };
    expect(customer.phone).toBeNull();
    expect(customer.last_visit_at).toBeNull();
  });

  it('constructs a valid CustomerSearchResult', () => {
    const result: CustomerSearchResult = {
      customers: [],
      total: 0,
    };
    expect(result.customers).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('CustomerSearchResult with multiple customers', () => {
    const c1: Customer = {
      id: '1', name: 'Alice', phone: null, email: null,
      customer_type: 'retail', loyalty_points: 0, lifetime_points: 0,
      total_spent: 0, total_visits: 0, last_visit_at: null,
    };
    const result: CustomerSearchResult = { customers: [c1], total: 1 };
    expect(result.total).toBe(1);
    expect(result.customers[0]?.name).toBe('Alice');
  });
});
