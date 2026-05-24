// apps/backoffice/src/features/products/__tests__/convert-to-parent-dialog.smoke.test.tsx
//
// Session 27c — Wave 6.D — ConvertToParentDialog smoke.
//
// Asserts:
//   1. Submit button is disabled while label is empty (blocking RPC).
//   2. Filling the label + clicking submit calls the RPC with the right shape.
//
// Note on plan deviation:
//   The plan's first assert clicks the submit button on an empty label and
//   expects `convert-dialog-error` to appear. The actual component disables
//   submit while `label.trim().length === 0`, so the onClick never fires
//   (fireEvent.click on a disabled button is a no-op). The "blocked submit"
//   behavior is preserved — we just probe it via the disabled attr instead
//   of the error banner.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConvertToParentDialog } from '../components/ConvertToParentDialog.js';

const mutateAsync = vi.fn().mockResolvedValue('parent-1');
vi.mock('@/features/products/hooks/useConvertProductToParent.js', () => ({
  useConvertProductToParent: () => ({ mutateAsync, isPending: false }),
}));

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConvertToParentDialog
        open
        onOpenChange={() => {}}
        productId="prod-1"
        productName="Croissant"
      />
    </QueryClientProvider>,
  );
}

describe('ConvertToParentDialog [S27c W6.D]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue('parent-1');
  });

  it('disables submit and blocks the RPC while label is empty', () => {
    renderDialog();
    const submit = screen.getByTestId('convert-dialog-submit');
    expect(submit).toBeDisabled();
    fireEvent.click(submit); // no-op on disabled button — sanity-check
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('calls RPC with correct shape on valid submit', async () => {
    renderDialog();
    const labelInput = screen.getByTestId('first-variant-label');
    fireEvent.change(labelInput, { target: { value: 'Nature' } });
    const submit = screen.getByTestId('convert-dialog-submit');
    fireEvent.click(submit);
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        productId: 'prod-1',
        firstVariantLabel: 'Nature',
        variantAxis: 'flavor',
        firstVariantName: null,
      });
    });
  });
});
