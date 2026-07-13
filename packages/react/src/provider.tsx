import type { Client } from '@phrasebook/core';
import type { ReactNode } from 'react';
import { PhrasebookContext } from './context';

export interface PhrasebookProviderProps {
  client: Client;
  locale: string;
  onLocaleChange?: (locale: string) => void;
  children: ReactNode;
}

type LoadState = Promise<void> | true;

/**
 * Per-client, per-locale load state, kept outside React state entirely.
 * "throw a promise from render, React shows the nearest Suspense fallback
 * until it resolves" is the classic Suspense-for-data-fetching pattern --
 * this cache is what makes a second render of the same locale a no-op
 * instead of re-suspending forever.
 */
const loadCache = new WeakMap<Client, Map<string, LoadState>>();

function suspendUntilLoaded(client: Client, locale: string): void {
  let clientCache = loadCache.get(client);
  if (!clientCache) {
    clientCache = new Map();
    loadCache.set(client, clientCache);
  }

  const state = clientCache.get(locale);
  if (state === true) return;
  if (state) throw state;

  const promise = client.load(locale).then(() => {
    clientCache?.set(locale, true);
  });
  clientCache.set(locale, promise);
  throw promise;
}

export function PhrasebookProvider({
  client,
  locale,
  onLocaleChange,
  children,
}: PhrasebookProviderProps) {
  suspendUntilLoaded(client, locale);

  return (
    <PhrasebookContext.Provider value={{ client, locale, onLocaleChange }}>
      {children}
    </PhrasebookContext.Provider>
  );
}
