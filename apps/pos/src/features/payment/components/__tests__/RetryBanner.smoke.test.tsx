import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RetryBanner } from '../RetryBanner';
import type { RetryClassification } from '@breakery/domain';

const retryable: RetryClassification = { kind: 'retryable', userMessage: 'try again' } as RetryClassification;
const alreadyPaid: RetryClassification = { kind: 'already_paid', userMessage: 'done' } as RetryClassification;

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
});
