import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Toaster } from '../Toast.js';

describe('Toaster', () => {
  it('renders without crashing', () => {
    const { container } = render(<Toaster />);
    expect(container).toBeInTheDocument();
  });
});
