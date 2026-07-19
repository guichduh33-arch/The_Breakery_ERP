// Contexte non sécurisé (LAN http) : DOIT rester le premier import.
import './lib/secureContextPolyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSentry } from './lib/sentry';
import './index.css';
import '@fontsource/playfair-display/400-italic.css';

initSentry();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
