import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { invalidateStockQueries } from '../invalidateStockQueries.js';

it('marks cached stock projections stale while preserving unrelated queries', async () => {
  const client = new QueryClient();
  const keys = [['stock-levels', 'counters'], ['stock-ledger', 'range'], ['low-stock-v2'],
    ['products-typeahead', 'flour'], ['product-dashboard', 'flour'], ['movement-aggregates', {}]];
  for (const key of [...keys, ['customers']]) client.setQueryData(key, [1]);
  await invalidateStockQueries(client);
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(['customers'])?.isInvalidated).toBe(false);
});
