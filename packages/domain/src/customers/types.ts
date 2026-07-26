export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  customer_type: 'retail';
  loyalty_points: number;
  lifetime_points: number;
  total_spent: number;
  total_visits: number;
  last_visit_at: string | null;
  // ADR-013 Lot 4 — optionnel : les snapshots persistés (cartStore) antérieurs
  // à search_customers_v4 n'ont pas le champ.
  store_credit_balance?: number;
}

export interface CustomerSearchResult {
  customers: Customer[];
  total: number;
}
