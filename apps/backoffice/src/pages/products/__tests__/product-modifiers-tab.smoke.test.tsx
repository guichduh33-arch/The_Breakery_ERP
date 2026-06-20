import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ProductDetailTabs } from '@/features/products/components/ProductDetailTabs.js';

afterEach(cleanup);

describe('ProductDetailTabs — Modifiers tab', () => {
  it('renders a Modifiers tab', () => {
    render(<ProductDetailTabs active="general" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /modifiers/i })).toBeInTheDocument();
  });

  it('marks the Modifiers tab selected when active', () => {
    render(<ProductDetailTabs active="modifiers" onChange={() => {}} />);
    const tab = screen.getByRole('tab', { name: /modifiers/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});
