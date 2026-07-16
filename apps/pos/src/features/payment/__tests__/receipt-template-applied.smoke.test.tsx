// apps/pos/src/features/payment/__tests__/receipt-template-applied.smoke.test.tsx
//
// Settings §6.A — the default receipt template (receipt_templates) and the
// business identity (business_config) flow into the printed payload: footer
// and header come from the template, show_qr is forwarded, and the identity
// block carries name/address/phone/tax_id (NPWP).
//
// Under VITE_PRINT_MOCK=1, printReceipt pushes to the mock buffer instead of a
// network call (harness mirrors receipt-payment-method.smoke.test.tsx).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import {
  getMockPrintBuffer,
  clearMockPrintBuffer,
} from '@/services/print/printService';
import type { ReceiptPayload } from '@/services/print/printService';
import type { SuccessModalProps } from '../SuccessModal';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({
    data: new Map([['cashier', { ip_address: '192.168.1.10', port: 9100, name: 'Cashier' }]]),
  }),
}));

vi.mock('@/features/settings/hooks/useReceiptTemplate', () => ({
  useReceiptTemplate: () => ({
    template: {
      header: 'Lombok, Indonesia\nOpen 7am — 7pm',
      footer: 'Terima kasih!\nWiFi: breakery-guest',
      show_qr: true,
      show_logo: true,
      paper_size: '80mm',
    },
    isLoading: false,
  }),
}));
vi.mock('@/features/settings/hooks/useBusinessIdentity', () => ({
  useBusinessIdentity: () => ({
    name: 'The Breakery',
    address: 'Kuta, Lombok Tengah',
    phone: '+62-370-000000',
    taxId: '01.234.567.8-901.000',
    isLoading: false,
  }),
}));
vi.mock('@/features/settings/hooks/useOrgDisplaySettings', () => ({
  useOrgDisplaySettings: () => ({
    displayFooterMessage: '',
    displaySlogan: '',
    autoPrint: true,
    autoOpenDrawer: true,
    isLoading: false,
  }),
}));

const originalFetch = globalThis.fetch;

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function buildProps(): SuccessModalProps {
  return {
    open: true,
    orderNumber: 'ORD-778',
    total: 25_000,
    changeGiven: 0,
    pointsEarned: 0,
    cashReceived: 25_000,
    cashierName: 'Test Cashier',
    cart: {
      items: [
        { id: 'line-1', product_id: 'p1', name: 'Espresso', unit_price: 25_000, quantity: 1, modifiers: [] },
      ],
      order_type: 'dine_in',
    },
    paymentMethod: 'cash',
    onNewOrder: vi.fn(),
  };
}

describe('SuccessModal — receipt template + identity applied to the payload', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
      printedItemIds: [],
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
      isOffline: false,
    });
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'EMP1' },
      sessionToken: 'tok',
      permissions: [],
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('carries template footer/header/show_qr and the configured identity (incl. NPWP)', async () => {
    const { SuccessModal } = await import('../SuccessModal');
    render(withQuery(<SuccessModal {...buildProps()} />));
    await waitFor(() => {
      expect(getMockPrintBuffer().some((e) => e.kind === 'receipt')).toBe(true);
    });
    const payload = getMockPrintBuffer().find((e) => e.kind === 'receipt')!.payload as ReceiptPayload;

    expect(payload.footer).toBe('Terima kasih!\nWiFi: breakery-guest');
    expect(payload.template).toEqual({ header: 'Lombok, Indonesia\nOpen 7am — 7pm', show_qr: true });
    expect(payload.business).toEqual({
      name: 'The Breakery',
      address: 'Kuta, Lombok Tengah',
      phone: '+62-370-000000',
      tax_id: '01.234.567.8-901.000',
    });
  });
});
