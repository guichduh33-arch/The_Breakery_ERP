// apps/backoffice/src/features/customers/hooks/useCustomerDetail.ts
//
// Session 31 / Wave 2.A — Read-only customer detail for /backoffice/customers/:id.
// Aggregates : customer row + orders count + 10 recent orders.
// PostgREST direct SELECT — no new RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type CustomerType = 'retail' | 'b2b';

export type PriceModifierType =
  | 'retail'
  | 'wholesale'
  | 'discount_percentage'
  | 'custom';

export interface CustomerCategorySummary {
  id: string;
  name: string;
  slug: string;
  price_modifier_type: PriceModifierType;
  discount_percentage: number;
  points_multiplier: number;
  loyalty_enabled: boolean;
}

export interface CustomerDetailRow {
  id: string;
  name: string;
  customer_type: CustomerType;
  email: string | null;
  phone: string | null;
  category_id: string | null;
  category: CustomerCategorySummary | null;
  loyalty_points: number;
  lifetime_points: number;
  total_spent: number;
  total_visits: number;
  last_visit_at: string | null;
  birth_date: string | null;
  marketing_consent: boolean;
  deleted_at: string | null;
  b2b_company_name: string | null;
  b2b_tax_id: string | null;
  b2b_payment_terms_days: number | null;
  b2b_credit_limit: number | null;
  b2b_current_balance: number;
  created_at: string;
}

export interface RecentOrder {
  id: string;
  order_number: string;
  created_at: string;
  total: number;
  status: string;
  order_type: string;
  items_count: number;
}

export interface CustomerDetail {
  customer: CustomerDetailRow;
  orders_count: number;
  recent_orders: RecentOrder[];
}

export function useCustomerDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['customer-detail', id],
    enabled: !!id,
    queryFn: async (): Promise<CustomerDetail> => {
      if (!id) throw new Error('id required');
      const { data: customer, error } = await supabase
        .from('customers')
        .select(
          'id, name, customer_type, email, phone, category_id, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at, birth_date, marketing_consent, deleted_at, b2b_company_name, b2b_tax_id, b2b_payment_terms_days, b2b_credit_limit, b2b_current_balance, created_at, ' +
            'category:customer_categories(id, name, slug, price_modifier_type, discount_percentage, points_multiplier, loyalty_enabled)',
        )
        .eq('id', id)
        .single();
      if (error) throw error;

      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', id);

      const { data: recent } = await supabase
        .from('orders')
        .select('id, order_number, created_at, total, status, order_type, order_items(count)')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(25);

      const recentOrders: RecentOrder[] = (recent ?? []).map((o) => {
        const rawItems = (o as Record<string, unknown>).order_items;
        const itemsCount = Array.isArray(rawItems)
          ? Number((rawItems[0] as { count?: number } | undefined)?.count ?? 0)
          : 0;
        return {
          id: o.id,
          order_number: o.order_number,
          created_at: o.created_at,
          total: Number(o.total),
          status: o.status,
          order_type: o.order_type,
          items_count: itemsCount,
        };
      });

      // PostgREST may return the embedded to-one relation as an object or a
      // single-element array depending on FK detection — normalise to object.
      const rawCat = (customer as unknown as Record<string, unknown>).category;
      const category = (Array.isArray(rawCat) ? rawCat[0] : rawCat) ?? null;

      return {
        customer: { ...(customer as unknown as CustomerDetailRow), category } as CustomerDetailRow,
        orders_count: count ?? 0,
        recent_orders: recentOrders,
      };
    },
  });
}
