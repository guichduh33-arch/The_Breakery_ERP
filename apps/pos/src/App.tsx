import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { SkipToContent } from '@breakery/ui';
import { queryClient } from './lib/queryClient';
import { AppRoutes } from './routes';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* a11y: keyboard users tab here first to jump past nav chrome. */}
        <SkipToContent />
        <AppRoutes />
        <Toaster theme="dark" position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
