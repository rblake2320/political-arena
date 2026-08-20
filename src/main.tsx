import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Operator visibility: unhandled client errors become analytics events.
import * as apiClient from './api';
let reported = 0;
window.addEventListener('error', (e) => {
  if (reported++ > 5) return;
  void apiClient.trackEvent({ event_type: 'client_error', metadata: { message: String(e.message).slice(0, 300), source: String(e.filename || '').slice(0, 200), path: window.location.pathname } });
});
window.addEventListener('unhandledrejection', (e) => {
  if (reported++ > 5) return;
  void apiClient.trackEvent({ event_type: 'client_error', metadata: { message: String(e.reason?.message || e.reason).slice(0, 300), kind: 'unhandledrejection', path: window.location.pathname } });
});
