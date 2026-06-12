// apps/backoffice/src/features/inventory-production/__tests__/production-section-required.test.tsx
// Audit C4 — section is REQUIRED for production_* movements (DB CHECK
// chk_stock_movements_section_required). The UI must enforce this before
// submitting so the user gets a clear field-level message instead of a
// cryptic 22P02 / 23514 from the DB.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductionForm from '../components/ProductionForm.js';
import BatchProductionPage from '@/pages/inventory/BatchProductionPage.js';

// ---------- shared mocks ----------

const mockRpc = vi.fn();
const mockFromSelect = vi.fn();

let currentPerms = new Set<string>(['inventory.read', 'inventory.production.create']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const SECTION_ROW = { id: 's-1', code: 'KIT', name: 'Kitchen', kind: 'kitchen', display_order: 1 };
const PRODUCT_ROW = { id: 'bag-1', sku: 'BAG-1', name: 'Test Baguette', unit: 'pcs', current_stock: 10, cost_price: 1500 };

interface RpcResult { data: unknown; error: { message: string; details?: string } | null }
interface ChainResult { data: unknown; error: unknown }

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string) {
    // Queries have different terminal calls:
    // useSections         → ...order('display_order')         [terminal]
    // useFinishedProducts → ...order('name').limit(500)       [terminal = limit]
    // useFinishedProducts → ...recipes...limit(2000)          [terminal = limit]
    // business_config     → ...limit(1)                      [terminal = limit]
    // useRecipes          → ...eq().order()                   [terminal = order]
    //
    // Strategy: build a Promise-like chain where both order() and limit()
    // resolve BUT also continue to return a chain so chaining after either works.
    const result = mockFromSelect(table) as ChainResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const makeResolvable = (): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p: any = Promise.resolve(result);
      // Attach chain methods on the Promise so callers can continue chaining
      p.select = () => p;
      p.eq     = () => p;
      p.is     = () => p;
      p.in     = () => Promise.resolve(result);
      p.order  = () => makeResolvable();
      p.limit  = () => Promise.resolve(result);
      return p;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      in:     () => Promise.resolve(result),
      order:  () => makeResolvable(),   // useSections / useRecipes terminal
      limit:  () => Promise.resolve(result),   // business_config terminal
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        if (out !== undefined) return Promise.resolve(out);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

if (typeof crypto.randomUUID !== 'function') {
  let counter = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => `00000000-0000-0000-0000-${String(++counter).padStart(12, '0')}`,
  });
}

function defaultMockFrom(table: string): ChainResult {
  if (table === 'sections')        return { data: [SECTION_ROW], error: null };
  if (table === 'products')        return { data: [PRODUCT_ROW], error: null };
  if (table === 'recipes')         return { data: [{ product_id: 'bag-1' }], error: null };
  if (table === 'business_config') return { data: [{ production_yield_variance_threshold_pct: 0.15 }], error: null };
  return { data: [], error: null };
}

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

// ─────────────────────────────────────────────────────────────────────────────
// ProductionForm — section required
// ─────────────────────────────────────────────────────────────────────────────

describe('ProductionForm — section required (audit C4)', () => {
  beforeEach(() => {
    currentPerms = new Set(['inventory.read', 'inventory.production.create']);
    mockRpc.mockReset();
    mockFromSelect.mockReset();
    mockFromSelect.mockImplementation(defaultMockFrom);
  });

  it('Section label does not contain "(optional)"', async () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <ProductionForm />
      </QueryClientProvider>,
    );
    await waitFor(() => screen.getByText(/Finished product/i));
    // The section label must NOT say "(optional)"
    const labels = Array.from(document.querySelectorAll('label'));
    const sectionLabel = labels.find((l) => /section/i.test(l.textContent ?? ''));
    expect(sectionLabel, 'Section label not found in DOM').toBeTruthy();
    expect(sectionLabel!.textContent).not.toMatch(/optional/i);
  });

  it('submit button stays disabled when product+yields filled but section is empty', async () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <ProductionForm />
      </QueryClientProvider>,
    );

    // Wait for async data (products + sections) to load
    await waitFor(() => {
      // sections loaded → "Kitchen" option should appear
      expect(screen.getByText('Kitchen')).toBeInTheDocument();
    });

    // ProductionForm has 2 <select>s: product (first) and section (second)
    const allSelects = Array.from(document.querySelectorAll('select'));
    expect(allSelects.length).toBeGreaterThanOrEqual(2);
    const [productSel, sectionSel] = allSelects as [HTMLSelectElement, HTMLSelectElement];

    // Select a product
    fireEvent.change(productSel, { target: { value: 'bag-1' } });

    // Fill expected + actual yields (first two number inputs)
    const numberInputs = Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    fireEvent.change(numberInputs[0]!, { target: { value: '5' } });
    fireEvent.change(numberInputs[1]!, { target: { value: '5' } });

    // Section is still '' — confirm it
    expect(sectionSel.value).toBe('');

    const btn = screen.getByRole('button', { name: /Record production/i });
    // The submit button MUST be disabled when section is empty
    expect(btn).toBeDisabled();
  });

  it('submit button becomes enabled once a section is selected', async () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <ProductionForm />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Kitchen')).toBeInTheDocument();
    });

    const allSelects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    const [productSel, sectionSel] = allSelects;

    fireEvent.change(productSel!, { target: { value: 'bag-1' } });

    const numberInputs = Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    fireEvent.change(numberInputs[0]!, { target: { value: '5' } });
    fireEvent.change(numberInputs[1]!, { target: { value: '5' } });

    // Now select the section
    fireEvent.change(sectionSel!, { target: { value: 's-1' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Record production/i })).not.toBeDisabled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BatchProductionPage — section required
// ─────────────────────────────────────────────────────────────────────────────

describe('BatchProductionPage — section required (audit C4)', () => {
  beforeEach(() => {
    currentPerms = new Set(['inventory.read', 'inventory.production.create']);
    mockRpc.mockReset();
    mockFromSelect.mockReset();
    mockFromSelect.mockImplementation(defaultMockFrom);
  });

  it('Record batch button is disabled when section is empty (baseline gate)', async () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <BatchProductionPage />
      </QueryClientProvider>,
    );
    // Button is disabled on initial render (no items filled + no section)
    const btn = screen.getByRole('button', { name: /Record batch/i });
    expect(btn).toBeDisabled();
  });

  it('Section label does not contain "(optional)" in BatchProductionPage', async () => {
    render(
      <QueryClientProvider client={makeQC()}>
        <BatchProductionPage />
      </QueryClientProvider>,
    );
    await waitFor(() => screen.getByRole('heading', { name: /Batch production/i }));
    const labels = Array.from(document.querySelectorAll('label'));
    // The section label is exactly "Section" (no "(optional)")
    const sectionLabel = labels.find((l) => /^section$/i.test(l.textContent?.trim() ?? ''));
    expect(sectionLabel, 'Section label "Section" not found — was it removed or renamed?').toBeTruthy();
    expect(sectionLabel!.textContent?.trim()).not.toMatch(/optional/i);
  });
});
