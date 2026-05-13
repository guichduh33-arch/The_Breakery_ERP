import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { SkipToContent, Toaster } from '@breakery/ui';
import { queryClient } from './lib/queryClient.js';
import { AppRoutes } from './routes/index.js';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* a11y: keyboard users tab here first to jump past nav chrome. */}
        <SkipToContent />
        <AppRoutes />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
