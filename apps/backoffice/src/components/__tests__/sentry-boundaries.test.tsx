import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { captureException } from '@sentry/react';
import { AppErrorBoundary } from '../AppErrorBoundary.js';
import { RouteErrorBoundary } from '../RouteErrorBoundary.js';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Caught render errors reach Sentry', () => {
  it.each([
    [AppErrorBoundary, 'The app stopped working'],
    [RouteErrorBoundary, 'This page stopped working'],
  ] as const)('reports an error through %s', (Boundary, title) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('synthetic render failure');
    function Broken(): never { throw error; }
    render(<MemoryRouter><Boundary><Broken /></Boundary></MemoryRouter>);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(error);
  });
});
