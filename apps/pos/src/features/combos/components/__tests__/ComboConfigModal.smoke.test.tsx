// apps/pos/src/features/combos/components/__tests__/ComboConfigModal.smoke.test.tsx
// Session 47 — smoke tests for ComboConfigModal.
//
// Tests:
//   T1: required single group enforced — Confirm disabled when nothing chosen
//   T2: multi group max_select — extra options disabled, Confirm disabled below min
//   T3: defaults pre-selected on open
//   T4: price summary reflects base + surcharge of chosen options
//   T5: Confirm emits exact {components, modifiers, unitPrice} shape
//
// `useComboConfig` is mocked so we don't hit Supabase.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComboDefinition } from '@breakery/domain';

// ---------------------------------------------------------------------------
// Fixed ComboDefinition fixture
// ---------------------------------------------------------------------------

// Two groups:
//  g1: single+required, "Choose a drink" — Americano (default, surcharge 0), Latte (surcharge 5000)
//  g2: multi, min=1, max=2, "Add-ons" — Cookie (default, surcharge 3000), Fruit Cup (surcharge 8000), Jam (surcharge 2000)
const MOCK_DEF: ComboDefinition = {
  combo_product_id: 'prod-combo-001',
  name: 'Breakfast Set',
  base_price: 50_000,
  groups: [
    {
      id: 'g1',
      name: 'Choose a drink',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 1,
      options: [
        {
          id: 'prod-amer',
          component_product_id: 'prod-amer',
          label: 'Americano',
          surcharge: 0,
          is_default: true,
          sort_order: 0,
        },
        {
          id: 'prod-latte',
          component_product_id: 'prod-latte',
          label: 'Latte',
          surcharge: 5_000,
          is_default: false,
          sort_order: 1,
        },
      ],
    },
    {
      id: 'g2',
      name: 'Add-ons',
      group_type: 'multi',
      is_required: true,
      min_select: 1,
      max_select: 2,
      sort_order: 2,
      options: [
        {
          id: 'prod-cookie',
          component_product_id: 'prod-cookie',
          label: 'Cookie',
          surcharge: 3_000,
          is_default: true,
          sort_order: 0,
        },
        {
          id: 'prod-fruit',
          component_product_id: 'prod-fruit',
          label: 'Fruit Cup',
          surcharge: 8_000,
          is_default: false,
          sort_order: 1,
        },
        {
          id: 'prod-jam',
          component_product_id: 'prod-jam',
          label: 'Jam',
          surcharge: 2_000,
          is_default: false,
          sort_order: 2,
        },
      ],
    },
  ],
};

// ComboDefinition with no default in the single group — so Confirm starts disabled
const DEF_NO_DEFAULT: ComboDefinition = {
  combo_product_id: 'prod-combo-002',
  name: 'Test Set',
  base_price: 40_000,
  groups: [
    {
      id: 'g-single',
      name: 'Choose a size',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 1,
      options: [
        {
          id: 'opt-small',
          component_product_id: 'opt-small',
          label: 'Small',
          surcharge: 0,
          is_default: false,
          sort_order: 0,
        },
        {
          id: 'opt-large',
          component_product_id: 'opt-large',
          label: 'Large',
          surcharge: 5_000,
          is_default: false,
          sort_order: 1,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock useComboConfig — vi.mock is hoisted; we swap the return value per test
// ---------------------------------------------------------------------------

// We need a mutable ref to switch fixtures per test without re-mocking.
const mockQueryResult = vi.hoisted(() => ({
  isLoading: false,
  isSuccess: true,
  data: undefined as ComboDefinition | undefined,
}));

vi.mock('@/features/combos/hooks/useComboConfig', () => ({
  useComboConfig: (_id: string) => mockQueryResult,
}));

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComboConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: full fixture
    mockQueryResult.isLoading = false;
    mockQueryResult.isSuccess = true;
    mockQueryResult.data = MOCK_DEF;
  });

  it('T2: multi group — 3rd option disabled when max_select (2) reached; Confirm disabled when below min', async () => {
    const { ComboConfigModal } = await import('../ComboConfigModal');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <ComboConfigModal
          open={true}
          product={{ id: 'prod-combo-001', name: 'Breakfast Set' }}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </Wrapper>,
    );

    // Default state: Cookie is pre-checked (is_default), Americano is pre-selected.
    // Cookie is already the 1 selection in multi group.
    // Now also select Fruit Cup — that's 2 = max_select.
    const fruitCupCheckbox = screen.getByRole('checkbox', { name: /fruit cup/i });
    fireEvent.click(fruitCupCheckbox);

    // Now 2 are selected (Cookie + Fruit Cup), so Jam should be disabled.
    const jamCheckbox = screen.getByRole('checkbox', { name: /jam/i });
    expect(jamCheckbox).toBeDisabled();

    // Confirm should be enabled (g1 = 1 selected, g2 = 2 selected, both valid)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    expect(confirmBtn).not.toBeDisabled();

    // Uncheck Cookie — now 1 selected in g2, still >= min_select=1, still valid.
    // Uncheck Fruit Cup — now 0 selected in g2, below min_select=1, confirm disabled.
    fireEvent.click(fruitCupCheckbox);
    // Now back to 1 selected (Cookie)
    const cookieCheckbox = screen.getByRole('checkbox', { name: /cookie/i });
    fireEvent.click(cookieCheckbox); // uncheck Cookie → 0 selected
    expect(confirmBtn).toBeDisabled();
  });

  it('T3: defaults pre-selected on open', async () => {
    const { ComboConfigModal } = await import('../ComboConfigModal');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <ComboConfigModal
          open={true}
          product={{ id: 'prod-combo-001', name: 'Breakfast Set' }}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </Wrapper>,
    );

    // g1: Americano is default → radio selected
    const americanoRadio = screen.getByRole('radio', { name: /americano/i });
    expect(americanoRadio).toBeChecked();

    // g2: Cookie is default → checkbox checked
    const cookieCheckbox = screen.getByRole('checkbox', { name: /cookie/i });
    expect(cookieCheckbox).toBeChecked();

    // Latte is not default → not checked
    const latteRadio = screen.getByRole('radio', { name: /latte/i });
    expect(latteRadio).not.toBeChecked();
  });

  it('T4: price summary shows base + surcharge of chosen options', async () => {
    const { ComboConfigModal } = await import('../ComboConfigModal');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <ComboConfigModal
          open={true}
          product={{ id: 'prod-combo-001', name: 'Breakfast Set' }}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </Wrapper>,
    );

    // Initial: Americano (surcharge 0) + Cookie (surcharge 3000) → total = 50000 + 0 + 3000 = 53000
    expect(screen.getByText(/rp 53,000/i)).toBeInTheDocument();

    // Pick Latte instead of Americano (surcharge 5000)
    const latteRadio = screen.getByRole('radio', { name: /latte/i });
    fireEvent.click(latteRadio);

    // total = 50000 + 5000 + 3000 = 58000
    expect(screen.getByText(/rp 58,000/i)).toBeInTheDocument();
  });

  it('T5: Confirm emits exact {components, modifiers, unitPrice} shape', async () => {
    const { ComboConfigModal } = await import('../ComboConfigModal');
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <ComboConfigModal
          open={true}
          product={{ id: 'prod-combo-001', name: 'Breakfast Set' }}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </Wrapper>,
    );

    // Default selection: Americano (g1) + Cookie (g2)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]![0];

    // unitPrice === base_price (surcharges ride as modifiers)
    expect(result.unitPrice).toBe(50_000);

    // components: one entry per chosen option
    expect(result.components).toContainEqual({ product_id: 'prod-amer', quantity: 1 });
    expect(result.components).toContainEqual({ product_id: 'prod-cookie', quantity: 1 });
    expect(result.components).toHaveLength(2);

    // modifiers: one entry per chosen option
    expect(result.modifiers).toContainEqual({
      group_name: 'Choose a drink',
      option_label: 'Americano',
      price_adjustment: 0,
    });
    expect(result.modifiers).toContainEqual({
      group_name: 'Add-ons',
      option_label: 'Cookie',
      price_adjustment: 3_000,
    });
    expect(result.modifiers).toHaveLength(2);

    // onClose called after confirm
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('T1: Confirm disabled when required single group has no selection', async () => {
    // This test uses a fixture with no defaults so the required single group
    // starts with 0 selections, making validateSelection fail → Confirm disabled.
    // Placed last to avoid cold-start timeout on Windows jsdom.
    mockQueryResult.data = DEF_NO_DEFAULT;

    const { ComboConfigModal } = await import('../ComboConfigModal');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <ComboConfigModal
          open={true}
          product={{ id: 'prod-combo-002', name: 'Test Set' }}
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      </Wrapper>,
    );

    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
  });
});
