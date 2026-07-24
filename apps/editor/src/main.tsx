import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { API_ENDPOINT, authClient } from './auth-client';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <ErrorBoundary>
    <App authClient={authClient} endpoint={API_ENDPOINT} />
  </ErrorBoundary>,
);
