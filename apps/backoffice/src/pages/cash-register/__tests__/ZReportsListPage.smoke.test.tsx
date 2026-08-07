import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

const fromSpy = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: (...a: unknown[]) => fromSpy(...a),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        ['zreports.read', 'zreports.sign', 'zreports.void'].includes(p),
    }),
}));

// ── useGenerateZReportPdf mock ─────────────────────────────────────────────
// Using the absolute path resolved by Vitest alias so it works regardless of
// the test file's location relative to the feature folder.
let mutateAsyncImpl: (args: { zreportId: string }) => Promise<unknown> = vi.fn().mockResolvedValue({
  signed_url: 'https://example.com/pdf',
  storage_path: 'zreports/z1.pdf',
  expires_at: '2026-05-25T00:00:00Z',
  status: 'draft',
  idempotent_replay: false,
});

vi.mock('@/features/cash-register/hooks/useGenerateZReportPdf.js', () => ({
  useGenerateZReportPdf: () => ({
    mutateAsync: (args: { zreportId: string }) => mutateAsyncImpl(args),
    isPending: false,
    resetIdempotency: vi.fn(),
  }),
}));

import ZReportsListPage from '../ZReportsListPage.js';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function makeChain(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    gte:    vi.fn().mockReturnThis(),
    lte:    vi.fn().mockReturnThis(),
    then: (
      onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
    ) =>
      Promise.resolve({ data: rows, error: null }).then(onFulfilled),
  };
}

const ROW_Z1 = {
  id:               'z1',
  shift_id:         's1',
  generated_at:     '2026-05-24T10:00:00Z',
  signed_at:        null,
  signed_by:        null,
  voided_at:        null,
  voided_by:        null,
  void_reason:      null,
  pdf_storage_path: null,
  status:           'draft',
  signed_by_profile: null,
};
const ROW_Z2 = { ...ROW_Z1, id: 'z2', shift_id: 's2', generated_at: '2026-05-25T10:00:00Z' };

describe('ZReportsListPage', () => {
  beforeEach(() => {
    fromSpy.mockReset();
    // default: 1 row
    fromSpy.mockReturnValue(makeChain([ROW_Z1]));
    // default mutateAsync resolves immediately
    mutateAsyncImpl = vi.fn().mockResolvedValue({
      signed_url: 'https://example.com/pdf',
      storage_path: 'zreports/z1.pdf',
      expires_at: '2026-05-25T00:00:00Z',
      status: 'draft',
      idempotent_replay: false,
    });
  });

  it('T1 renders 1 Z-Report row with Sign + Void actions visible (perms granted)', async () => {
    render(wrap(<ZReportsListPage />));
    await waitFor(() => expect(screen.getByTestId('sign-z1')).toBeInTheDocument());
    expect(screen.getByTestId('void-z1')).toBeInTheDocument();
    expect(screen.getByTestId('view-pdf-z1')).toBeInTheDocument();
  });

  it('T2 the counters are the status filter — selecting one narrows the rows', async () => {
    fromSpy.mockReturnValue(makeChain([ROW_Z1, { ...ROW_Z2, status: 'signed' }]));
    render(wrap(<ZReportsListPage />));

    // Les deux lignes sont là au départ, un statut chacune.
    await waitFor(() => expect(screen.getByTestId('view-pdf-z1')).toBeInTheDocument());
    expect(screen.getByTestId('view-pdf-z2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('counter-signed'));

    // z1 (draft) sort, z2 (signed) reste, et le compteur cliqué est marqué actif.
    await waitFor(() => expect(screen.queryByTestId('view-pdf-z1')).not.toBeInTheDocument());
    expect(screen.getByTestId('view-pdf-z2')).toBeInTheDocument();
    expect(screen.getByTestId('counter-signed')).toHaveAttribute('aria-pressed', 'true');
  });

  it('T4 an unsigned report shows its cash variance before it can be signed', async () => {
    // La session rattachée est jointe par la liste : attendu 1 000 000,
    // compté 940 000, donc un manque de 60 000 qui doit se lire AVANT la
    // signature — c'est la raison d'être de la colonne.
    fromSpy.mockReturnValue(makeChain([
      {
        ...ROW_Z1,
        shift: { expected_cash: 1_000_000, closing_cash: 940_000, variance_total: -60_000 },
      },
    ]));
    render(wrap(<ZReportsListPage />));

    await waitFor(() => expect(screen.getByTestId('sign-z1')).toBeInTheDocument());
    expect(screen.getByText('-Rp 60,000')).toBeInTheDocument();
    expect(screen.getByText('Rp 1,000,000')).toBeInTheDocument();

    // Le compteur d'alerte le recense — un brouillon qui porte un écart.
    const counter = screen.getByTestId('counter-unresolved');
    expect(counter).toHaveTextContent('1');
  });

  it('T5 a report whose shift is not readable shows a dash, never a zero', async () => {
    // RLS peut masquer la session ; un écart inconnu n'est pas un écart nul.
    render(wrap(<ZReportsListPage />));
    await waitFor(() => expect(screen.getByTestId('sign-z1')).toBeInTheDocument());
    expect(screen.getByTestId('counter-unresolved')).toHaveTextContent('0');
  });

  it('T3 (C3/BO-05) only the active row PDF button is disabled during generation — other rows stay enabled', async () => {
    // Two rows
    fromSpy.mockReturnValue(makeChain([ROW_Z1, ROW_Z2]));

    // Make z1 PDF generation hang (never resolves) to observe the pending state
    // We use a holder object to avoid TypeScript narrowing resolveZ1 to never.
    const holder: { resolve: (() => void) | null } = { resolve: null };
    mutateAsyncImpl = vi.fn().mockImplementation(({ zreportId }: { zreportId: string }) => {
      if (zreportId === 'z1') {
        return new Promise<unknown>((resolve) => { holder.resolve = () => resolve({ signed_url: null, storage_path: '', expires_at: '', status: 'draft', idempotent_replay: false }); });
      }
      return Promise.resolve({ signed_url: null, storage_path: '', expires_at: '', status: 'draft', idempotent_replay: false });
    });

    render(wrap(<ZReportsListPage />));

    const pdfZ1 = await screen.findByTestId('view-pdf-z1');
    const pdfZ2 = await screen.findByTestId('view-pdf-z2');

    // Both enabled before any action
    expect(pdfZ1).not.toBeDisabled();
    expect(pdfZ2).not.toBeDisabled();

    // Click PDF on z1 — it will hang in the pending state
    fireEvent.click(pdfZ1);

    // z1 should be disabled; z2 should remain enabled
    await waitFor(() => expect(pdfZ1).toBeDisabled());
    expect(pdfZ2).not.toBeDisabled();

    // Resolve z1 to clean up the hanging promise
    holder.resolve?.();
    await waitFor(() => expect(pdfZ1).not.toBeDisabled());
  });
});
