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
}

export interface CustomerSearchResult {
  customers: Customer[];
  total: number;
}
