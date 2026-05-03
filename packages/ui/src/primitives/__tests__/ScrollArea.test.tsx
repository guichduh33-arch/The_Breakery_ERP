import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScrollArea } from '../ScrollArea.js';

describe('ScrollArea', () => {
  it('renders children', () => {
    render(<ScrollArea><p>Scrollable content</p></ScrollArea>);
    expect(screen.getByText('Scrollable content')).toBeInTheDocument();
  });
});
