import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardContent } from '../Card.js';

describe('Card', () => {
  it('renders card with title and content', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
        </CardHeader>
        <CardContent>Card body</CardContent>
      </Card>,
    );
    expect(screen.getByText('Card Title')).toBeInTheDocument();
    expect(screen.getByText('Card body')).toBeInTheDocument();
  });

  it('applies default variant + padding=none by default', () => {
    render(<Card data-testid="c">x</Card>);
    const el = screen.getByTestId('c');
    expect(el.className).toMatch(/bg-bg-elevated/);
    expect(el.className).toMatch(/border-border-subtle/);
    expect(el.className).toMatch(/shadow-sm/);
    // No padding utility (padding=none).
    expect(el.className).not.toMatch(/(?:^|\s)p-/);
  });

  it('applies elevated variant', () => {
    render(<Card variant="elevated" data-testid="c">x</Card>);
    expect(screen.getByTestId('c').className).toMatch(/shadow-md/);
  });

  it('applies inset variant', () => {
    render(<Card variant="inset" data-testid="c">x</Card>);
    const cls = screen.getByTestId('c').className;
    expect(cls).toMatch(/bg-bg-base/);
    expect(cls).toMatch(/shadow-inset-sm/);
  });

  it('applies padding token', () => {
    render(<Card padding="md" data-testid="c">x</Card>);
    expect(screen.getByTestId('c').className).toMatch(/p-6/);
  });

  it('merges custom className', () => {
    render(<Card className="custom-extra" data-testid="c">x</Card>);
    expect(screen.getByTestId('c').className).toMatch(/custom-extra/);
  });
});
