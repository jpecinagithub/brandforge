import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import './i18n';
import './index.css';
import { App } from './App';
import { PwaUpdatedNotice } from './components/PwaUpdatedNotice';
import { registerPwaUpdates } from './pwa';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

registerPwaUpdates();

createRoot(rootEl).render(
  <StrictMode>
    <App />
    <PwaUpdatedNotice />
    <Analytics />
  </StrictMode>,
);
