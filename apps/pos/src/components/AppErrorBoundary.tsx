import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureException } from '@sentry/react';
import { Button } from '@breakery/ui';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('POS render failed', error, info.componentStack);
    captureException(error, { extra: { componentStack: info.componentStack } });
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <main className="theme-pos min-h-dvh bg-bg-base text-text-primary grid place-items-center p-6">
      <div className="max-w-md space-y-4" role="alert">
        <h1 className="text-2xl font-semibold">This screen could not be loaded</h1>
        <p className="text-text-secondary">Reload to recover your saved order. A payment awaiting confirmation will keep its original reference.</p>
        <Button variant="secondary" onClick={() => window.location.reload()}>Reload safely</Button>
      </div>
    </main>;
  }
}
