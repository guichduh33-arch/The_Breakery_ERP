// apps/pos/src/features/display/__tests__/CustomerDisplayView.test.tsx
//
// Session 14 / Wave 3 / Phase 3.B — smoke tests for the rebuilt
// CustomerDisplayView. Pure presentational view → no Supabase, no
// realtime, no router. Mocked nothing — feeds the view shaped props
// and asserts the two render branches.

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import {
  CustomerDisplayView,
  type CustomerDisplayLine,
} from '../CustomerDisplayView';

const SAMPLE_LINES: CustomerDisplayLine[] = [
  {
    id: 'line-1',
    product_id: 'prod-bagel',
    name: 'Sesame Bagel',
    quantity: 2,
    unit_price: 25_000,
    line_total: 50_000,
    image_url: 'https://cdn.test/bagel.jpg',
  },
  {
    id: 'line-2',
    product_id: 'prod-coffee',
    name: 'Flat White',
    quantity: 1,
    unit_price: 35_000,
    line_total: 35_000,
    image_url: null,
  },
];

describe('CustomerDisplayView', () => {
  it('renders the branded empty state with a BrandMark when items is empty', () => {
    render(<CustomerDisplayView items={[]} />);

    // Branded shell — header chrome from BrandedLayout. The split-brand
    // redesign adds a second "French Bakery & Pastry" occurrence (the brand
    // panel slogan), hence getAllByText.
    expect(screen.getByText('The Breakery')).toBeInTheDocument();
    expect(screen.getAllByText(/French Bakery/i).length).toBeGreaterThanOrEqual(1);

    // Split-brand redesign — the left half is always the brand panel
    // (logo + slogan).
    expect(screen.getByTestId('cd-brand-panel')).toBeInTheDocument();
    expect(screen.getByTestId('cd-brand-slogan')).toHaveTextContent(/French Bakery/i);

    // EmptyState v2 (branded tone) — Playfair italic title + BrandMark "B".
    const emptyView = screen.getByTestId('display-view-empty');
    expect(emptyView).toBeInTheDocument();
    expect(within(emptyView).getByText('Welcome to The Breakery')).toBeInTheDocument();
    // BrandMark renders an svg with role="img" and aria-label="The Breakery".
    expect(within(emptyView).getByRole('img', { name: 'The Breakery' })).toBeInTheDocument();

    // Active list must NOT mount when there are no items.
    expect(screen.queryByTestId('display-view-active')).not.toBeInTheDocument();
    expect(screen.queryByTestId('display-totals-band')).not.toBeInTheDocument();
  });

  it('renders product names, photo + fallback, and a per-line total', () => {
    render(
      <CustomerDisplayView
        items={SAMPLE_LINES}
        totals={{ subtotal: 85_000, total: 85_000, item_count: 3 }}
        orderLabel="Table 4"
      />,
    );

    // Order label slot.
    expect(screen.getByTestId('display-order-label')).toHaveTextContent('Table 4');

    // Product name rows.
    expect(screen.getByText('Sesame Bagel')).toBeInTheDocument();
    expect(screen.getByText('Flat White')).toBeInTheDocument();

    // Photo present for line 1; BrandMark fallback for line 2.
    const rows = screen.getAllByTestId('display-line-row');
    expect(rows).toHaveLength(2);

    // Line 1: real <img> tag (hidden from a11y tree because alt="").
    const photo = rows[0]!.querySelector('img');
    expect(photo).not.toBeNull();
    expect(photo!.getAttribute('src')).toBe('https://cdn.test/bagel.jpg');
    // No BrandMark fallback in line 1.
    expect(within(rows[0]!).queryByRole('img', { name: 'The Breakery' })).toBeNull();

    // Line 2: no <img>; BrandMark fallback (span[role=img] under aria-hidden).
    // The parent thumbnail wrapper is aria-hidden, so we query by role with
    // hidden:true to traverse the hidden subtree.
    expect(rows[1]!.querySelector('img')).toBeNull();
    expect(
      within(rows[1]!).getByRole('img', { hidden: true, name: 'The Breakery' }),
    ).toBeInTheDocument();

    // Per-line totals rendered in mono via Currency.
    const lineTotals = screen.getAllByTestId('display-line-total');
    expect(lineTotals[0]!.textContent).toMatch(/50/); // 50,000
    expect(lineTotals[1]!.textContent).toMatch(/35/); // 35,000
    // Mono font class is applied by Currency.
    expect(lineTotals[0]!.querySelector('.font-mono')).not.toBeNull();
  });

  it('renders subtotal + grand total (gold mono) in the totals band', () => {
    render(
      <CustomerDisplayView
        items={SAMPLE_LINES}
        totals={{ subtotal: 85_000, total: 85_000, item_count: 3 }}
      />,
    );

    const band = screen.getByTestId('display-totals-band');
    expect(band).toBeInTheDocument();

    // Both subtotal and grand total render in mono via Currency.
    const subtotal = screen.getByTestId('display-subtotal');
    const grandTotal = screen.getByTestId('display-grand-total');
    expect(subtotal.textContent).toMatch(/85/);
    expect(grandTotal.textContent).toMatch(/85/);

    // Grand total uses the gold emphasis token.
    expect(grandTotal.querySelector('.text-gold')).not.toBeNull();
    // Both numeric figures use the mono font.
    expect(subtotal.querySelector('.font-mono')).not.toBeNull();
    expect(grandTotal.querySelector('.font-mono')).not.toBeNull();

    // Item count summary.
    expect(within(band).getByText(/3 items/i)).toBeInTheDocument();
  });

  it('renders the modifier detail (label + price adjustment) under the line', () => {
    render(
      <CustomerDisplayView
        items={[
          {
            id: 'line-mod',
            product_id: 'prod-latte',
            name: 'Latte',
            quantity: 1,
            unit_price: 35_000,
            line_total: 40_000,
            image_url: null,
            modifiers: [
              { label: 'Extra shot', price_adjustment: 5_000 },
              { label: 'Oat milk', price_adjustment: 0 },
            ],
          },
        ]}
        totals={{ subtotal: 40_000, total: 40_000, item_count: 1 }}
      />,
    );

    const mods = screen.getAllByTestId('display-line-modifier');
    expect(mods).toHaveLength(2);
    // Priced modifier shows its delta; free modifier shows the label alone.
    expect(mods[0]!).toHaveTextContent('Extra shot');
    expect(mods[0]!.textContent).toMatch(/5.?000/);
    expect(mods[1]!).toHaveTextContent('Oat milk');
    expect(mods[1]!.textContent).not.toMatch(/Rp/);
  });

  it('renders the "Tax included" line when totals carry a tax_amount', () => {
    render(
      <CustomerDisplayView
        items={SAMPLE_LINES}
        totals={{ subtotal: 85_000, total: 85_000, tax_amount: 7_727, item_count: 3 }}
      />,
    );

    const tax = screen.getByTestId('display-tax-included');
    expect(tax).toHaveTextContent(/tax included/i);
    expect(tax.textContent).toMatch(/7.?727/);
  });

  it('omits the "Tax included" line when tax_amount is absent or zero', () => {
    render(
      <CustomerDisplayView
        items={SAMPLE_LINES}
        totals={{ subtotal: 85_000, total: 85_000, tax_amount: 0, item_count: 3 }}
      />,
    );
    expect(screen.queryByTestId('display-tax-included')).toBeNull();
  });

  it('flags promo-gift and cancelled lines with badges', () => {
    render(
      <CustomerDisplayView
        items={[
          {
            id: 'line-promo',
            product_id: 'prod-croissant',
            name: 'Free Croissant',
            quantity: 1,
            unit_price: 0,
            line_total: 0,
            image_url: null,
            is_promo_gift: true,
          },
          {
            id: 'line-cancel',
            product_id: 'prod-latte',
            name: 'Latte',
            quantity: 1,
            unit_price: 30_000,
            line_total: 30_000,
            image_url: null,
            is_cancelled: true,
          },
        ]}
        totals={{ subtotal: 0, total: 0, item_count: 1 }}
      />,
    );

    expect(screen.getByTestId('display-line-promo-badge')).toHaveTextContent(/promo/i);
    expect(screen.getByTestId('display-line-cancelled-badge')).toHaveTextContent(
      /cancelled/i,
    );
  });
});
