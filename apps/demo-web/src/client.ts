import { createClient } from '@phrasebook/core';

export const ENDPOINT = import.meta.env.VITE_API_ENDPOINT ?? 'http://localhost:3000';
export const PROJECT = 'demo';
export const NAMESPACE = 'common';

export const client = createClient({
  endpoint: ENDPOINT,
  project: PROJECT,
  namespaces: [NAMESPACE],
  defaultLocale: 'en',
  dev: import.meta.env.DEV,
});
