import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RetryBanner } from '../RetryBanner';
import type { RetryClassification } from '@breakery/domain';

const retryable: RetryClassification = { kind: 'retryable', userMessage: 'try again' } as RetryClassification;
const alreadyPaid: RetryClassification = { kind: 'already_paid', userMessage: 'done' } as RetryClassification;
const fatal: RetryClassification = { kind: 'fatal', userMessage: 'Discount needs a manager authorization.' };

describe('RetryBanner', () => {
  it('renders nothing when lastError is null', () => {
    const { container } = render(
      <RetryBanner lastError={null} checkoutPending={false} onRetry={vi.fn()} onDismissAlreadyPaid={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the retryable banner and fires onRetry', () => {
    const onRetry = vi.fn();
    render(<RetryBanner lastError={retryable} checkoutPending={false} onRetry={onRetry} onDismissAlreadyPaid={vi.fn()} />);
    expect(screen.getByTestId('payment-retry-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('payment-retry-button'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders the already-paid banner and fires onDismissAlreadyPaid', () => {
    const onDismiss = vi.fn();
    render(<RetryBanner lastError={alreadyPaid} checkoutPending={false} onRetry={vi.fn()} onDismissAlreadyPaid={onDismiss} />);
    expect(screen.getByTestId('payment-already-paid-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('payment-already-paid-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders a persistent banner for fatal errors (S43 P0-1b)', () => {
    render(<RetryBanner lastError={fatal} checkoutPending={false} onRetry={vi.fn()} onDismissAlreadyPaid={vi.fn()} />);
    const banner = screen.getByTestId('payment-fatal-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Discount needs a manager authorization.')).toBeInTheDocument();
    // No retry button — fatal errors must not be retried with the same key.
    expect(screen.queryByTestId('payment-retry-button')).not.toBeInTheDocument();
  });
});
