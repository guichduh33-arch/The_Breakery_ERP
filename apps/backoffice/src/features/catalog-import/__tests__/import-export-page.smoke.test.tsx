// apps/backoffice/src/features/catalog-import/__tests__/import-export-page.smoke.test.tsx
// S41 — Task 13 — smoke tests for ProductsImportExportPage (3 cases).
//
// IMPORTANT (DEV-S39-B1-01): all mock data objects defined via vi.hoisted() so they
// have stable object references across renders — avoids infinite render loop / OOM.
//
// Case 1: page renders the 3 zones (Template / Export / Import).
// Case 2: dry-run with errors → confirm-import button disabled.
// Case 3: dry-run valid → click confirm-import → importMutation called with
//         dryRun:false and a non-null idempotency key (UUID).
//
// Approach: ImportDropzone is mocked to expose a test-only "Upload" button that
// calls props.onFile(buf, filename) synchronously — avoids File.arrayBuffer()
// async complexity in jsdom while still testing the page state-machine faithfully.
// parseCatalogWorkbook is also mocked to intercept the dynamic import from the page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// ── Hoisted stable refs (DEV-S39-B1-01) ──────────────────────────────────────

const { importMutateAsync, mockImportState, VALID_PAYLOAD, VALID_REPORT, ERRORS_REPORT, EMPTY_ROWMAPS } =
  vi.hoisted(() => {
    const importMutateAsync = vi.fn();
    const mockImportState = { isPending: false };

    const EMPTY_ROWMAPS = {
      categories: [], ingredients: [], products: [2],
      units: [], variants: [], recipes: [],
    };

    // Stable CatalogPayload fixture
    const VALID_PAYLOAD = {
      categories:  [],
      ingredients: [],
      products:    [
        {
          sku: 'PRD-SMOKE', name: 'Smoke Croissant', category: 'Test',
          unit: 'pcs', retail_price: 25000,
          wholesale_price: null, description: null, image_url: null,
          visible_on_pos: true, is_favorite: false, shelf_life_hours: null,
          purchase_unit: null, recipe_unit: null, opname_unit: null, sales_unit: null,
        },
      ],
      units: [], variants: [], recipes: [],
    };

    const BASE_SUMMARY = {
      categories:  { create: 0, update: 0 },
      ingredients: { create: 0, update: 0 },
      products:    { create: 1, update: 0 },
      units:       { replace_products: 0 },
      variants:    { create: 0, update: 0 },
      recipes:     { products_replaced: 0 },
    };

    const VALID_REPORT = {
      valid: true, errors: [], summary: BASE_SUMMARY, idempotent_replay: false,
    };

    const ERRORS_REPORT = {
      valid:  false,
      errors: [
        { sheet: 'Products', row: 2, sku: 'PRD-BAD', code: 'missing_category', message: 'category is required' },
      ],
      summary:           BASE_SUMMARY,
      idempotent_replay: false,
    };

    return { importMutateAsync, mockImportState, VALID_PAYLOAD, VALID_REPORT, ERRORS_REPORT, EMPTY_ROWMAPS };
  });

// ── Module mocks ──────────────────────────────────────────────────────────────

// supabase client stub — satisfies the module graph (hooks are mocked above).
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: vi.fn() },
}));

// authStore: grant all permissions.
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (_: string) => boolean }) => unknown) =>
    selector({ hasPermission: (_code: string) => true }),
}));

// parseCatalogWorkbook — intercepted for both static and dynamic imports.
// Returns VALID_PAYLOAD by default; individual tests override via mockReturnValueOnce.
vi.mock('@/features/catalog-import/parseCatalogWorkbook.js', () => ({
  parseCatalogWorkbook: vi.fn(() => ({ payload: VALID_PAYLOAD, errors: [], rowMaps: EMPTY_ROWMAPS })),
}));

// useImportCatalog — controls the mutation.
vi.mock('@/features/catalog-import/hooks/useImportCatalog.js', () => ({
  useImportCatalog: () => ({
    mutateAsync: importMutateAsync,
    isPending:   mockImportState.isPending,
    reset:       vi.fn(),
  }),
}));

// useExportCatalog — not the focus of these smoke tests.
vi.mock('@/features/catalog-import/hooks/useExportCatalog.js', () => ({
  useExportCatalog: () => ({
    mutateAsync: vi.fn().mockResolvedValue(VALID_PAYLOAD),
    isPending:   false,
  }),
}));

// ProductsPageTabs — stub (no router wiring needed).
vi.mock('@/features/products/components/ProductsPageTabs.js', () => ({
  ProductsPageTabs: () => <nav aria-label="Products sections" />,
}));

// ImportDropzone — mock exposes a test-only "Upload" button that calls onFile() directly.
// This avoids File.arrayBuffer() async complexity in jsdom while faithfully testing the
// page's state machine (parse → dry-run → confirm).
vi.mock('@/features/catalog-import/components/ImportDropzone.js', () => ({
  ImportDropzone: ({
    onFile,
    disabled,
  }: {
    onFile: (buf: ArrayBuffer, name: string) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="import-dropzone">
      <button
        data-testid="test-upload-trigger"
        disabled={disabled}
        onClick={() => onFile(new ArrayBuffer(8), 'test-catalog.xlsx')}
      >
        Upload test file
      </button>
    </div>
  ),
}));

// ── Import page AFTER mocks ───────────────────────────────────────────────────
import ProductsImportExportPage from '@/pages/products/ProductsImportExportPage.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProductsImportExportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Triggers the upload pipeline (parse → dry-run) and waits for stage change. */
async function triggerUpload(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('test-upload-trigger'));
    // Flush the async handleFile chain (parseCatalogWorkbook + mutateAsync)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProductsImportExportPage [S41 smoke]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImportState.isPending = false;
  });

  // ── Case 1: page renders all 3 zones ─────────────────────────────────────

  it('T1: renders the 3 main zones (Template / Export / Import)', () => {
    renderPage();

    // Template card
    expect(screen.getByText(/Download empty template/i)).toBeInTheDocument();

    // Export card
    expect(screen.getByText(/Export full catalog/i)).toBeInTheDocument();

    // Import card: dropzone stub rendered
    expect(screen.getByTestId('import-dropzone')).toBeInTheDocument();
  });

  // ── Case 2: dry-run with errors → confirm-import disabled ────────────────

  it('T2: dry-run returning errors → confirm-import is disabled', async () => {
    // Dry-run returns an invalid report.
    importMutateAsync.mockResolvedValueOnce(ERRORS_REPORT);

    renderPage();
    await triggerUpload();

    // Stage should reach 'previewed'
    await waitFor(() => {
      expect(screen.getByTestId('confirm-import')).toBeInTheDocument();
    });

    expect(screen.getByTestId('confirm-import')).toBeDisabled();

    // Errors table visible
    expect(screen.getByTestId('import-errors-table')).toBeInTheDocument();
  });

  // ── Case 3: dry-run valid → commit call with dryRun:false + key ──────────

  it('T3: dry-run valid → confirm-import → mutation called with dryRun:false and non-null UUID key', async () => {
    // First call: dry-run → valid
    importMutateAsync.mockResolvedValueOnce(VALID_REPORT);
    // Second call: commit → success
    importMutateAsync.mockResolvedValueOnce(VALID_REPORT);

    renderPage();
    await triggerUpload();

    // Wait for 'previewed' state
    await waitFor(() => {
      expect(screen.getByTestId('confirm-import')).toBeInTheDocument();
    });

    const confirmBtn = screen.getByTestId('confirm-import');
    expect(confirmBtn).not.toBeDisabled();

    // Click confirm
    await act(async () => {
      fireEvent.click(confirmBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Mutation must have been called twice (1× dry-run + 1× commit)
    await waitFor(() => {
      expect(importMutateAsync).toHaveBeenCalledTimes(2);
    });

    // Second call must have dryRun:false and a non-null idempotency key
    const secondCallArgs = importMutateAsync.mock.calls[1] as [
      { payload: unknown; dryRun: boolean; idempotencyKey: string }
    ];
    expect(secondCallArgs[0].dryRun).toBe(false);
    expect(secondCallArgs[0].idempotencyKey).toBeTruthy();
    // Must look like a UUID (any version)
    expect(secondCallArgs[0].idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  // ── Case 5 (review residual): commit resolving valid:false stays in preview ──

  it('T5: commit returning valid:false → stays in preview with errors, no "Import complete"', async () => {
    importMutateAsync.mockResolvedValueOnce(VALID_REPORT);  // dry-run OK
    importMutateAsync.mockResolvedValueOnce(ERRORS_REPORT); // commit re-validates → invalid

    renderPage();
    await triggerUpload();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-import')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-import'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Still in preview: confirm button present (now disabled), errors visible,
    // and NOT the success state.
    expect(screen.getByTestId('confirm-import')).toBeDisabled();
    expect(screen.getByTestId('import-errors-table')).toBeInTheDocument();
    expect(screen.queryByText(/Import complete/i)).not.toBeInTheDocument();
  });

  // ── Case 4 (review I-1): dry-run rejection returns to idle ────────────────

  it('T4: dry-run RPC rejection → back to idle, dropzone reappears (no dead-end)', async () => {
    importMutateAsync.mockRejectedValueOnce(new Error('network down'));

    renderPage();
    await triggerUpload();

    // The page must fall back to idle: dropzone visible again, no preview UI.
    await waitFor(() => {
      expect(screen.getByTestId('import-dropzone')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('confirm-import')).not.toBeInTheDocument();
    expect(screen.queryByText(/Validating/i)).not.toBeInTheDocument();
  });
});
