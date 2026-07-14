import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ENDPOINT, NAMESPACE, PROJECT, client } from './client';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <App client={client} endpoint={ENDPOINT} project={PROJECT} namespace={NAMESPACE} />,
);
