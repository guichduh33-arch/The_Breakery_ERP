import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

interface StockItem { product_id: string; quantity: number }

export const B2B_STOCK_AVAILABILITY_KEY = ['b2b-stock-availability'] as const;
export const B2B_STOCK_CHECK_TIMEOUT_MS = 3000;

function normalizeItems(items: StockItem[]) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    // Décaler en décimal avant l'arrondi : chaque ligne suit numeric(10,3),
    // puis l'agrégation additionne des milli-unités entières, sans résidu flottant.
    const [significand, exponent = '0'] = String(item.quantity).split('e');
    const milliQuantity = Math.round(Number(`${significand}e${Number(exponent) + 3}`));
    quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + milliQuantity);
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b))
    .map(([product_id, milliQuantity]) => ({ product_id, quantity: milliQuantity / 1000 }));
}

export async function checkB2bStockAvailability(items: StockItem[]): Promise<boolean | null> {
  const basket = normalizeItems(items);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, B2B_STOCK_CHECK_TIMEOUT_MS);
  });
  const request = Promise.resolve().then(async () => {
    const { data, error } = await supabase.rpc('check_b2b_stock_availability_v1', { p_items: basket })
      .abortSignal(controller.signal);
    if (error || typeof data !== 'object' || data === null || Array.isArray(data)
      || !('available' in data) || typeof data.available !== 'boolean') return null;
    return data.available;
  }).catch(() => null);
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function useB2bStockAvailability(items: StockItem[], enabled: boolean) {
  const basket = normalizeItems(items);
  return useQuery({
    queryKey: [...B2B_STOCK_AVAILABILITY_KEY, basket],
    enabled: enabled && basket.length > 0,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const available = await checkB2bStockAvailability(basket);
      if (available === null) throw new Error('Stock availability could not be checked.');
      return available;
    },
  });
}
