import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input.js';

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="type" />);
    expect(screen.getByPlaceholderText('type')).toBeInTheDocument();
  });
});
