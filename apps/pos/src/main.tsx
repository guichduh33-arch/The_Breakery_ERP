// Contexte non sécurisé (LAN http) : DOIT rester le premier import.
import './lib/secureContextPolyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSentry } from './lib/sentry';
import './index.css';
// Playfair Display — l'italique 400 (marque, `font-display italic`) ET les
// romaines : `font-display` sans `italic` est majoritaire dans le POS, et sans
// face romaine chargée le navigateur retombait sur Times New Roman.
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';

initSentry();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
