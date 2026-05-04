import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Separator } from '../Separator.js';

describe('Separator', () => {
  it('renders as horizontal separator', () => {
    const { container } = render(<Separator />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
