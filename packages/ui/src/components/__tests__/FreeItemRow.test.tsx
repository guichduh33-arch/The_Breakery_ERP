// packages/ui/src/components/__tests__/FreeItemRow.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeItemRow } from '../FreeItemRow.js';

describe('FreeItemRow', () => {
  it('renders product name + FREE badge + promo subtitle', () => {
    render(<FreeItemRow productName="Americano" promotionName="Free Americano on 100k+" />);
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('FREE')).toBeInTheDocument();
    expect(screen.getByText('Free Americano on 100k+')).toBeInTheDocument();
  });
});
