// packages/domain/src/reports/aggregations.ts
//
// Pure-TS aggregation helpers used by the BO reports module as both
//   (a) display-side transforms after RPC calls (e.g. fill missing hours),
//   (b) offline fallback / unit-test spec for the SQL RPCs.
//
// IO-free, no React, no Supabase.

export interface SalesHourBucket {
  hour:        number;   // 0..23 in the business timezone
  total:       number;   // sum of order.total
  order_count: number;
}

export interface OrderForHour {
  paid_at_local_hour: number;  // 0..23 already converted to bc.timezone by caller
  total:              number;
}

/**
 * Build a complete 24-bucket array (one per hour 0..23) from a list of paid
 * orders that already carry their local hour. Missing hours are zero-filled
 * so the chart axis is always 0..23.
 */
export function sumByHour(orders: OrderForHour[]): SalesHourBucket[] {
  const buckets: SalesHourBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h, total: 0, order_count: 0,
  }));
  for (const o of orders) {
    if (o.paid_at_local_hour < 0 || o.paid_at_local_hour > 23) continue;
    const b = buckets[o.paid_at_local_hour];
    if (b === undefined) continue;
    b.total       += Number(o.total) || 0;
    b.order_count += 1;
  }
  return buckets;
}

export interface CategoryLine {
  category_id:   string;
  category_name: string;
  line_total:    number;
  quantity:      number;
}

export interface CategoryBucket {
  category_id:   string;
  category_name: string;
  total:         number;
  qty:           number;
}

export function sumByCategory(lines: CategoryLine[]): CategoryBucket[] {
  const map = new Map<string, CategoryBucket>();
  for (const l of lines) {
    const existing = map.get(l.category_id);
    if (existing) {
      existing.total += Number(l.line_total) || 0;
      existing.qty   += Number(l.quantity) || 0;
    } else {
      map.set(l.category_id, {
        category_id:   l.category_id,
        category_name: l.category_name,
        total:         Number(l.line_total) || 0,
        qty:           Number(l.quantity)   || 0,
      });
    }
  }
  // Sort by total desc for stable rendering.
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export interface StaffOrder {
  staff_id:   string;
  staff_name: string;
  total:      number;
}

export interface StaffBucket {
  staff_id:    string;
  staff_name:  string;
  total:       number;
  order_count: number;
  avg_basket:  number;
}

export function sumByStaff(orders: StaffOrder[]): StaffBucket[] {
  const map = new Map<string, StaffBucket>();
  for (const o of orders) {
    const existing = map.get(o.staff_id);
    if (existing) {
      existing.total       += Number(o.total) || 0;
      existing.order_count += 1;
    } else {
      map.set(o.staff_id, {
        staff_id:    o.staff_id,
        staff_name:  o.staff_name,
        total:       Number(o.total) || 0,
        order_count: 1,
        avg_basket:  0,
      });
    }
  }
  // Compute avg_basket in a second pass.
  for (const b of map.values()) {
    b.avg_basket = b.order_count > 0 ? b.total / b.order_count : 0;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export interface StockMovementLite {
  product_id:    string;
  product_name:  string;
  movement_type: string; // 'opening'|'sale'|'adjustment'|'purchase'|'waste'|...
  quantity:      number; // signed
  current_qty:   number; // from products.current_stock or section_stock
}

export interface StockVarianceRow {
  product_id:   string;
  product_name: string;
  opened:       number;
  sold:         number;
  adjusted:     number;
  current_qty:  number;
  expected:     number;
  variance:     number;
  variance_pct: number;
}

/**
 * Compute (opened + delta movements) = expected, then variance = current - expected.
 * Used as both the offline fallback and a deterministic spec for the SQL RPC.
 */
export function computeStockVariance(rows: StockMovementLite[]): StockVarianceRow[] {
  const map = new Map<string, StockVarianceRow>();
  for (const r of rows) {
    let acc = map.get(r.product_id);
    if (!acc) {
      acc = {
        product_id:   r.product_id,
        product_name: r.product_name,
        opened:       0,
        sold:         0,
        adjusted:     0,
        current_qty:  Number(r.current_qty) || 0,
        expected:     0,
        variance:     0,
        variance_pct: 0,
      };
      map.set(r.product_id, acc);
    }
    const q = Number(r.quantity) || 0;
    if (r.movement_type === 'opening' || r.movement_type === 'purchase' || r.movement_type === 'incoming') {
      acc.opened += q;
    } else if (r.movement_type === 'sale' || r.movement_type === 'sale_refund') {
      acc.sold += q; // q is negative for sale
    } else if (r.movement_type === 'adjustment' || r.movement_type === 'waste') {
      acc.adjusted += q;
    }
    // Capture latest current_qty (assumes caller groups by product).
    if (Number.isFinite(r.current_qty)) acc.current_qty = Number(r.current_qty);
  }
  for (const acc of map.values()) {
    acc.expected = acc.opened + acc.sold + acc.adjusted;
    acc.variance = acc.current_qty - acc.expected;
    acc.variance_pct = acc.expected !== 0
      ? (acc.variance / acc.expected) * 100
      : 0;
  }
  return Array.from(map.values()).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}
